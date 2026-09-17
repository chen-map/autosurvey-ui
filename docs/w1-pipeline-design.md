# W1 固定工作流执行器设计（skill 形态 → 确定性流水线）

> 背景与决策：现有后端以 skill 形态实现（Agent 读 SKILL.md/WORKFLOW_GUIDE 后即兴编排执行），存在不稳定问题。本文档给出把 **Workflow 1（语料库构建）** 固化为确定性流水线的设计——它是全流水线中脚本最完整的 workflow，最适合第一个固化，并直接对接前端 B3 流水线监控与 B4 语料库页。

## 1. 不稳定的根因分析

| # | 根因 | 证据 |
|---|---|---|
| 1 | **编排不确定**：执行顺序、是否跳步由 Agent 读文档后即兴决定 | W1 无任何 runner 脚本；GUIDE 只是文档 |
| 2 | **判断不确定**：六阶段筛选的 decision/reason 列由当次 LLM 会话自由填写——无固定 prompt、无 temperature 控制、无缓存 | `screening_manager.py` 自述 "LLM reads the input and writes decisions back"；它是纯状态追踪器（448 行，无 LLM 调用代码） |
| 3 | **无状态机**：Phase 完成与否在 Agent 的上下文里，断点恢复靠记性 | 各脚本虽有 --skip-existing 等，但 phase 级状态无落盘 |

## 2. 核心结论：脚本已齐，缺的只是"执行器"

W1 七个 Phase 全部有真实可复用的脚本，**无需重写任何筛选/检索逻辑**：

| Phase | 脚本 | 确定性 |
|---|---|---|
| P1 Golden Set | `extract_seed_metadata.py` + `keyword_analyzer.py`（TF-IDF） | ✅ 确定性 |
| P2 七库检索 | `search_databases.py --query-file --start-year --end-year --max-results --output` | ✅ 确定性（同 query 同结果） |
| P3 归一去重 | `normalize_and_dedup.py --title-threshold` | ✅ 确定性 |
| P4 六阶段筛选 | `screening_manager.py --stage N --workspace`（状态机） | ⚠️ 决策列依赖 LLM（P4 是唯一不确定点） |
| P5 滚雪球 | `snowball_search.py --direction --merge` | ✅ 确定性 |
| P6 下载 | `download_papers.py --unpaywall-email --sci-hub-mirrors --delay` | ✅ 确定性 |
| P7 本地合并 | `merge_local_papers.py --local-dir --corpus-dir` | ✅ 确定性 |

## 3. 执行器设计 `w1_pipeline.py`（~300 行）

```python
PHASES = [
  {"id": "W1-P1", "script": "golden_set_builder/...", "outputs": ["golden_set/seed_papers.csv", "golden_set/search_strings.md"]},
  {"id": "W1-P2", "script": "multi_database_searcher/search_databases.py", "outputs": ["raw_results/"]},
  {"id": "W1-P3", "script": "record_normalizer/normalize_and_dedup.py", "outputs": ["normalized/unified_records.csv"]},
  {"id": "W1-P4", "script": "screening/runner", "outputs": ["screening/stage6_final.csv", "screening/screening_log.md"]},
  {"id": "W1-P5", "script": "snowball_searcher/snowball_search.py", "outputs": ["snowball/FINAL_INCLUDED_PAPERS.csv"]},
  {"id": "W1-P6", "script": "paper_downloader/download_papers.py", "outputs": ["papers/download_report.md"]},
  {"id": "W1-P7", "script": "local_paper_merger/merge_local_papers.py", "outputs": ["corpus/CORPUS_PAPERS.csv"]},
]
```

- **状态机**：顺序执行；每 Phase 结束写 `w1_state.json`（`phases: [{id, name, status, started_at, ended_at, duration_sec, outputs, rc}]` + `current` + `logs_path`）——**结构与前端 B3 页的 phase_states 一一对应**
- **CWD 纪律**：所有存量脚本以 `workspace` 为工作目录执行（GUIDE 的 `retrieval_workspace/...` 相对路径布局成立的前提）——测试中发现的首个真实缺陷
- **断点恢复**：`--resume` 跳过已有 done 标记的 Phase；`--from W1-P4` / `--only W1-P2` 单点重跑
- **失败策略**：默认 fail-fast；Phase 内部已有降级（如 P6 六级下载降级、占位 txt）
- **现有脚本零改动**：执行器只做子进程调起 + 参数渲染 + 产物校验

## 4. LLM 判断收敛（P4 专属层 `llm_screen.py`，~200 行）

把"Agent 自由发挥的筛选判断"收敛为受控步骤：

1. **固定 prompt 模板**（每阶段一个，版本号入库 `screening/prompts.v{n}.json`）
2. **temperature=0** + 批量调用（每批 20 条记录）
3. **缓存**：`hash(阶段输入+prompt版本)` 未变则直接复用上次决策，不重复调用
4. **启发式兜底**：Stage 1 标题筛选先用关键词规则打分，只把边界样本交给 LLM；Stage 3 可获取性是纯确定性检查（DOI 解析 / 文件存在）
5. **可回溯**：每批 raw LLM 响应存 `screening/raw_llm/` 供答辩回溯

## 5. 配置桥（createProject 载荷 → `w1_config.json`）

前端 `POST /projects` 载荷直接生成 runner 配置：

```json
{
  "project_id": "proj-xxx",
  "topic": "…", "domain_tags": ["LLM 安全", "智能体"],
  "platforms": ["Semantic Scholar", "arXiv"],
  "search_cap": 2000, "corpus_cap": 500,
  "prescore": 0.25, "year_range": [2018, 2026],
  "seed_dir": "uploads/…/seed", "local_dir": "uploads/…/local",
  "criteria": "向导确认页保存的纳排标准"
}
```

映射：`search_cap` → P2 `--max-results`；`year_range` → `--start/end-year`；`corpus_cap` → Stage 6 截断；`prescore` → W2 预留（本轮不用）；`platforms` → `--db` 子集（付费平台需 Key，见个人中心 BYO Key）。

## 6. API 包装（前端 B3/B4 零改动接入）

| 接口 | 实现 |
|---|---|
| `POST /projects` | 建 `wm/{id}/w1/` + 写 `w1_config.json` + 后台 spawn `w1_pipeline.py` |
| `GET /projects/:id/run` | 直读 `w1_state.json` → 前端 phase_states |
| `POST …/phases/:pid/retry` | 清除该 phase 状态 + 重跑 |
| B4 漏斗数据 | 直读 `screening/screening_log.md` + 各 stage CSV 行数 |

前端 B3 页的状态机（pending/running/done/failed/checkpoint + 重跑按钮）已按此设计，零改动。

## 7. 残余不确定性与验收标准

- LLM 判断的残余不确定 → 缓解：固定 prompt + temperature=0 + 缓存 + raw 响应可回溯
- **验收标准**：同一 config 跑两遍——P1/3/5/6/7（本地文件处理）产物逐字节一致；**P2（外部数据库检索）只验字段结构一致 + 数量级稳定**（外部内容随时间漂移，逐字节一致不可能）
- 达标后按同一模式固化 W2（脚本同样齐全：run_pipeline.py 一条命令含全部 4 Phase）

## 8. 工作量与顺序

| 项 | 量 | 顺序 |
|---|---|---|
| `w1_pipeline.py` 执行器 | ~300 行 | ①（纯确定性，最快见效） |
| `llm_screen.py` 收敛层 | ~200 行 | ② |
| FastAPI 包装（status/retry/create） | ~150 行 | ③（与 api-contract.md 同步定稿） |
| W2 同模式固化 | 复用执行器 | ④ |

## 9. W1 现有代码评审结论（2026-09-12，3605 行全读）

**总评**：研究原型水准之上——结构清晰、降级设计到位（六级下载+magic bytes 校验）、去重有 blocking+richness 保留策略+置信度分级、PRISMA 日志规范。作为商业化后端需按以下清单整改：

| 优先级 | 问题 | 位置 | 整改 |
|---|---|---|---|
| **P0 合规** | Sci-Hub 镜像抓取集成，且默认启用 | `download_papers.py` L43-45/L329 | 默认禁用（--no-scihub 反转）；商用版移除，改"请求机构访问"提示 |
| **P0 正确性** | rapidfuzz 缺失时静默跳过模糊去重 → 语料库带重不报错 | `normalize_and_dedup.py` L196-200 | 进 requirements；缺失时非零退出 |
| **P1 安全** | IEEE API key 明文提交在 key_settings.py | `key_settings.py` | 重置该 key；keys 迁移 env/.env（不入库） |
| **P1 确定性** | Google Scholar 依赖非官方爬虫（自述不稳定） | GUIDE Phase 2 | 固定 workflow 中 GS 设为可选、失败不阻塞 |
| **P2 工程** | 全部 print 无 logging；无 --quiet/--verbose | 全部脚本 | 执行器层统一捕获 stdout 重定向日志文件（脚本可不动） |
| **P2 健壮性** | 裸 `except Exception` 静默吞错（PDF 解析等） | extract_seed_metadata / search_databases | 记日志（含 paper_id）再继续 |
| **P3 测试** | 零单元测试——固化验收（双跑一致）目前只能人工 | 全部 | 最小集：normalize/dedup 纯函数测试（最易测最值得） |
| P3 性能 | 去重 `df.loc` 逐对访问 O(n²)（blocking 已缓解） | normalize_and_dedup L230+ | 500 篇可接受；2000+ 时改向量化 |

**与执行器的关系**：以上均为脚本级整改，不改 w1_pipeline 执行器设计；P0 两项应在执行器联调前完成。
