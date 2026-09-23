# 后端任务清单（前端蓝图之外，交由后端角色确认与实现）

> 本文件由变更协议跨栈评估产生：前端侧已用 mock/localStorage 先行，后端就绪后按契约替换。创建日期：2026-09-12
>
> **⭐ 优先项：Workflow 1 固定工作流执行器**——skill 形态不稳定（Agent 即兴编排 + LLM 自由填写筛选决策），已产出确定性流水线设计文档 **[w1-pipeline-design.md](w1-pipeline-design.md)**：现有 7 个 W1 脚本零改动，新增 ~300 行执行器 + LLM 判断收敛层即可，直接对接前端 B3/B4。建议后端接入的第一个任务。

## 1. 知识库持久化（对应前端 F16 知识库）

前端类型：`src/store/library.ts` 的 `LibraryItem`

| 接口 | 说明 |
|---|---|
| `GET /library` | 当前用户收藏列表（含 collection 分类） |
| `POST /library` | 收藏论文（paperIdx 换成真实论文 ID） |
| `DELETE /library/:key` | 移除收藏 |
| `PATCH /library/:key` | 移动分类 |

存储建议：用户维度一张收藏表（user_id, paper_id, collection, saved_at）+ 分类表。前端 localStorage 键 `as.library-items` / `as.library-collections`。

## 2. 研究方向库持久化（对应前端 B13 研究方向库）

前端类型：`src/pages/DirectionPage.tsx` 的 `Direction`（id/title/fields/goal/时间戳）+ 默认预选 id

| 接口 | 说明 |
|---|---|
| `GET /me/directions` | 方向库列表（含 is_default 标记） |
| `POST /me/directions` | 新建方向 |
| `PUT /me/directions/:id` | 更新方向 |
| `DELETE /me/directions/:id` | 删除方向 |
| `PUT /me/directions/:id/default` | 设为默认预选（向导自动带出） |

存储建议：`directions` 表（user_id, title, fields_json, goal, is_default, created_at, updated_at）。前端 localStorage 键 `as.directions` / `as.active-direction` 为过渡方案，后端就绪后迁移并清空本地。

## 3. 选题推荐 / AI 方向精炼（对应 B14/F18；前端 mock 版已并入「研究方向」页）

前端不直连 LLM（密钥安全），由后端代理：

| 接口 | 说明 |
|---|---|
| `POST /direction/refine` | 请求 `{ vaguePrompt: string, fields: string[] }` → 后端调 LLM 按模板精炼为专业研究方向，并经 Semantic Scholar Graph API（免费）检索高质量论文 |
| `GET /projects/:id/gaps` | 包装流水线 **W3-P1 Survey Gap Analyzer**（已有能力）：返回 coverage gaps + methodological gaps + 推荐选题（含 KG 证据支撑） |

响应形状（与前端 `DirectionPage.tsx` 的 `RefinedDirection` 一致）：

```json
{
  "title": "专业化的研究方向标题",
  "statement": "一句话阐述",
  "questions": ["研究问题 1", "研究问题 2", "研究问题 3"],
  "gap": "为什么值得做（识别出的空白）",
  "papers": [{ "title": "...", "venue": "...", "year": 2024, "reason": "推荐理由" }]
}
```

## 4. createProject 载荷扩展（对应向导参数）

`POST /projects` 载荷在原 title/fieldTags/seedPapers 基础上增加：

```json
{
  "title": "…",
  "description": "领域描述/研究目标（→ W1 P1 关键词提取输入）",
  "fieldTags": ["LLM 安全", "智能体"],
  "platforms": ["Semantic Scholar", "arXiv"],
  "searchCap": 2000,
  "corpusCap": 500,
  "prescore": 0.25,
  "screeningProfile": "标准",
  "localPapers": []
}
```

**运行生命周期（已实现）**：`POST /projects` 只创建 draft（写 `w1_config.json`，不自动跑）；`POST /projects/{pid}/run` 显式启动/续跑 W1（runner 以 `--resume` 拉起，跳过已完成 Phase）；`GET /projects/{pid}/run` 在启动前返回 404，前端流水线页以此区分「未启动」并轮询等待首个状态文件。

## 5. 个人中心与 API 密钥存储（对应 B15）

- **users 表扩展**：昵称、头像 URL、研究方向关联（direction_id）
- **API 密钥加密存储**：`api_keys` 表（user_id, platform, key_ciphertext）——服务端 AES/KMS 加密 at rest，**接口只回传掩码**（如 `abcd••••efgh`），明文仅在服务端调用付费平台时解密使用
- 前端 localStorage 键 `as.apikeys` 为过渡方案，后端就绪后迁移并清空本地

## 7. Agent 聚合检索服务（对应 B16）

交互式检索的聚合层（apipick 式模式）：前端把用户问题发给聚合服务，服务内部扇出 arXiv/PubMed/S2 并做限流管理与缓存，返回 LLM 友好 JSON。

- `POST /agent-search`：`{ question, fields[], max_papers }` → `{ papers: [{title, authors, year, doi, url, abstract}], latency_ms }`
- 计费模式：open-core——自部署免费直连各库；托管版按调用计费（关联 F15）
- 前端契约：`createProject`/运行配置增加 `agentSearch: boolean` + `agentSearchKeyId`

## 7.5 W3 → RQ 专页数据契约（对齐 autoSurvey_v2 真实产物，WORKFLOW3_GUIDE.md §二/§三）

W3 实际写出 `analyze_report/` 下的产物，前端 RQ 树/专页的每个分节都对应真实文件（页面分节上直接标注来源文件名）：

| 前端展示 | 来源产物（真实文件） | 关键字段/内容 |
|---|---|---|
| RQ 树（RQ1 → RQ1.1 层级） | `rq_evidence_matrix.json`（冻结） | `RQ1.rq_text / sub_rqs.RQ1.1.sub_rq_text`，**ID 约定为点号层级** |
| 冻结论文集合 / KG 命中数 | 同上 | `paper_ids / kg_node_ids / kg_edge_ids / answerability_score` |
| 章节绑定 + 建议综合产物 | `survey_outline.json` | `sections.subsections.{section_id, sub_rq, suggested_artifact}` |
| 查询计划（意图/焦点词/节点边类型/候选路径） | `rq_query_registry.json` | `query_intent / focus_terms / node_types / edge_types / candidate_paths` |
| 选择原因（回应的 Gap） | `gap_summary.md`（W3-P1） | markdown，后端抽取为可选注解字段 |
| 简述 / 口径 / 分解逻辑 / 综合策略 | `design_report.md`（W3-P2） | markdown 注解 |
| 修订记录 | `rq_reflection_log.md`（W3-P4） | markdown 注解（blocked/weak 的处置） |
| 答案与核查 | W4 `rq_answer.json` | `overall_answer / key_claims`（四维核查） |

**接口建议**：`GET /projects/:pid/rqs` 汇总返回 `{ macros, matrix: { frozenAt } }`，其中 Sub-RQ 内嵌 `paperIds/kgNodeCount/kgEdgeCount/section/query`（后端读上面三个 JSON + 三个 md 组装）；字段命名与前端 `types/data.ts` 的 `MacroRQ/SubRQ/QueryPlan` 一致。可选注解字段缺失时，前端自动显示"尚未生成（对应 Phase 产出）"。

**核心纪律（真实文件即契约）**：`rq_evidence_matrix.json` 是下游唯一入口；W4/W5/前端都不得重新执行 KG 查询，只消费冻结映射。

## 7.6 W1 语料入库 → 语料库页（已实现）

用户裁决：W1-P6 下载完成后写入**用户端本地数据库**，语料库页从库中读取。

- **表**：`autosurvey.db` 的 `corpus_papers`（project_id, doi, title, venue, year, url, abstract, source, status, pdf_path, record_id；UNIQUE(project_id, doi, title)）
- **入库**：`w1/corpus_ingest.py` 挂在 P6 `steps_tail`——读 `download/download_ready.csv` + `no_doi_records.csv`，对照 `papers/` 实际产出判状态（PDF=downloaded / 占位 txt=failed / 无 DOI=no_doi）UPSERT 落库
- **读取**：`GET /projects/{pid}/corpus` → `{ papers, funnel }`；论文映射前端 `PaperRecord`（downloaded→已纳入，failed/no_doi→可获取性），漏斗前两级从 W1 中间产物 CSV 计数（检索归一/筛选纳入），后四级从库统计
- **前端**：`getCorpus(projectId)` 真实模式调上述端点；CorpusPage/KgPage 已带 projectId 接线

## 7.7 W2 事实记忆构建集成（已实现）

主参考 §3.2 四 Phase 接入执行器（存量脚本零改动，`w2/phase_defs.py`）：

- **W2-P0** `parse_pdfs.py --pdf-dir papers`（W1-P6 下载产物）→ `paper_cards/parsed/`
- **W2-P1** `build_structured_papers.py`（LLM 六类对象，checkpoint 断点续传）→ `structured_papers.jsonl`
- **W2-P2**（可选）`select_candidate_objects.py` → `candidate_structured_papers.jsonl`
- **W2-P3** `build_paper_kg.py`（prescore 预评分 + 论文对关系，checkpoint 续跑）→ `paper_kg.db` + `paper_kg.json` + nodes/edges + KG_SUMMARY.md

- **runner 泛化**：`runner.py --workflow w1|w2`，状态文件 `w1_state.json` / `w2_state.json`；API `POST /run?workflow=`、`GET /run?workflow=`、retry 同参
- **KG 端点**：`GET /projects/{pid}/kg` 读 `paper_kg.json` → `{nodes, edges, paperCount}`（前端做类型映射）
- **KG 页**：Obsidian 风格 d3-force 力导向图——按连接度定节点大小、七类着色、悬停高亮邻域其余淡出、光标锚点缩放/平移、节点可拖拽、类型筛选 chips、点选详情卡、矛盾红/支持绿边
- **LLM 依赖**：P1/P3 必须 LLM（启发式已移除），配置沿用 kg_common.py 内置默认；后续可切服务端代理

## 7.8 AI 使用点细分配置（会议裁决已实现）

不同环节可用不同 AI。`llm_configs` 表增加 `use_case` 维度（UNIQUE(user_id, use_case)）：

- **使用点目录**：default 兜底 + w1.screen / w2.extract / w2.relation / w3.gap / w3.design / w4.extract / w4.answer / w4.claim / agent.kg / direction.refine
- **解析链**：环节专属行（Key 可解密且非空）→ default 行；`GET /api/me/llm-catalog` 返回目录+各环节配置概览（掩码）
- **写入**：`PUT /api/me/llm-config` 带 `useCase`；不提供 apiKey 时继承该环节现存密文或 default 密文
- **消费**：`/api/llm/chat` 带 `useCase`；W2 经 llm_wrap `--use-case`（P1=w2.extract，P3=w2.relation）
- **UI**：个人中心「按 AI 使用点细分」矩阵——逐环节覆盖模型名与可选 Key

## 7.9 arXiv 合规采集 + W12 全链路实测（已实现）

- **OAI-PMH 采集器** `w1/arxiv_oai.py` 挂 W1-P2 steps_tail：增量元数据（Retry-After 退避、
  合规 UA、日限额 2000、resumptionToken 分页），产出同 schema CSV 注入官方 DOI，经 P3 合流。
  清单见 docs/arxiv-compliance.md
- **corpus_cap 截断**：download_prep `--limit`——最终保留上限约束下载量（超额部分进 no_doi 分流）
- **scripts_root 兜底**：createProject 不传时用 AS_SCRIPTS_ROOT / 本地默认路径
- **list 端点形状修复**：返回前端 Project 同构（camelCase + stats + workflows 摘要）
- **W12 全链路实测**：新建项目 → P1 22s → P2 176s（712 条）→ P3 7s → P4 → P5（S2 限流降级）
  → P6 786s（60 截断：2 下载 + 58 占位 + 586 分流）→ 646 条入本地库 → W2 全绿 → 真 KG 上图
- **P6 arXiv 批量直连**（2026-09-22，解决"2/60 成功率"）：新增 `w1/arxiv_batch.py` 挂 P6
  （prep 之后、旧五级链之前）。共享节流状态（5s/篇）+ 全局冷却 + 断点续传 + `%PDF` 校验 +
  **curl 首选三级通道**（curl 直连 → urllib 代理 → urllib 直连；实测 arXiv CDN 按 TLS
  指纹过滤 python-urllib，缓存未命中即 406）。30 篇真数据实测 30/30 全成功。
  同日修复 OAI 收割器：记录为无前缀裸标签 `<arXiv>`（原正则按 `<arXiv:arXiv>` 写导致
  每页 0 条无限翻库）+ authors 按 author/keyname 结构化解析 + 重试上限 6 次 + 连续空页
  熔断 + `Accept` 头。详见 docs/arxiv-compliance.md
- **arXiv PDF 截断修复**（2026-09-22 晚，100 篇实测揪出）：curl `--max-time 45` 掐断大 PDF
  后**仍返回 200 + 半个文件**，原魔数+5KB 校验放行 → 40/100 损坏（fitz 0 页/EOF 错）。
  修复：① 连接超时与总时长分离（`--connect-timeout` + `--max-time 300`）；② curl 非零
  退出码（18 部分传输/28 超时）必须抛错走通道重试；③ 完整性校验加 `%%EOF` 尾标（断点
  续传同样验尾——损坏文件重跑自动补下）。重下 44 篇后 fitz 全量复扫 100/100 可开。
  **教训：文件完整性校验必须含"传输完整性"，魔数+体积只是下限。**
- **存量补丁登记（autoSurvey_v2，不入本仓库）**：`build_paper_kg.py::select_paper_pairs`
  由顺序穷举改共享概念评分选对——原实现取前 max_pairs 个组合，百篇规模下 300 对预算
  全落在前两篇论文的配对上（100 篇实测 0/300 相关 → KG 无论文对边）。新逻辑按六类
  对象名 token + 标题词交集评分降序取 Top-N，同分按输入序稳定。
- **W2 千篇级实测（100 篇，2026-09-22 晚）**：P0 解析 100/100（装 pdfminer.six 补齐降级链）
  → P1 六类提取 100 篇 0 错误（DeepSeek ~6min）→ P2 候选 100 → P3 预打分 300 对
  **18 相关 → 18 关系生成**（修复前 0/300）。前端 KG 985 节点 / 1422 边
  （Paper 100 / Method 225 / Problem 219 / Metric 116 / Dataset 111 / Limitation 86）。
  待办：w2_state.json 阶段中写盘滞后（终态一次性落盘），前端 W2 进度条需阶段边界才跳；
  w2_max_pairs 等规模参数应暴露到 createProject 契约（当前需手改 w1_config.json）。

## 8. 基础设施（部署阶段）

- ECS（放既有 VPC 交换机）+ 弹性公网 IP + 安全组 80/443
- nginx 反代 `/api/*` → FastAPI 流水线包装层；托管前端 dist 静态产物
- 长任务状态推送：轮询起步，预留 SSE

## 9. W2/W3 优化 backlog（2026-09-23 会议纪要登记，处置决议：只登记；轻微改动可尝试；改文件类型/存储格式暂不动）

纪要全文归档：docs/references/W2W3优化方向会议纪要.md。逐项现状对照：

| # | 方向 | 本控制台现状 | 涉及面 | 风险级 | 处置 |
|---|---|---|---|---|---|
| 1 | 候选对生成与 Pre-score 精细化 | 已有同构三阶段：概念评分选对（select_paper_pairs，已改共享概念评分）→ LLM Pre-score（chat_json is_related/confidence）→ 关系生成；100 篇实测 18/300 相关 | build_paper_kg.py / 章节级文本供给 | 中 | 登记；章节分区域解析待做 |
| 2 | 结构化对象定义校验（章节定位提取） | 现状为整篇前 16000 字符喂 LLM（--max-text-chars）；卡已有 sections 字段可供定位 | parse_pdfs / build_structured_papers | 中 | 登记；sections 定位提取可试点 |
| 3 | Related Work 引用关系双向解析 | **已回填 + 诊断**：backfill_references.py 三策略回填（实质书目 31→36/100，自动备份）；另确认本批语料内部互引≈0（关键词筛选的随机子集，非引文网络）——引用边不出主因是语料性质。剩余 64 卡需更强的 PDF 章节解析（大改待裁决） | parse_pdfs（深层修复待裁决） | 中大 | 数据层已修；解析层深修待裁决 |
| 4 | KG 存储格式升级（图数据库） | 已有 paper_kg.db（SQLite，query_rq_evidence 已用 SQL 查询）+ JSON + Graphml 三形态；"JSON grep"痛点主要在前端/展示侧 | 存储层迁移 | **大（用户明确暂不动）** | 登记；"OpenCBOC"名称存疑，候选调研对象：Neo4j / TuGraph / NebulaGraph，调研后再裁决 |
| 5 | 节点 AutoMerge | **已执行**（2026-09-23 授权）：kg_merge_suggest.py（只读建议）+ kg_merge_execute.py（精确同名合并，备份先行，JSON+DB 同步，别名入 node_aliases）——实测合并 2 组、删 2 冗余节点；词元相似 6 对留人工复核。下一步：向量匹配 + LLM 融合规则（完整方案） | w2/kg_merge_suggest.py、w2/kg_merge_execute.py | 低（已落地保守版） | 保守版已落地；完整版待裁决 |
| 6 | 三层分析架构（原子操作/Skill/RQ 分类层） | 与主参考 §3.4 L1/L2/L3 同构；Agent 页当前仍是"概览塞给 LLM"，未到 L1/L2/L3 | Agent 页 + W3 registry | 大 | 登记；Agent 升级吃 W3 registry 为前置 |
| 7 | Problem/Solution 双域 Skill 体系 + 自上而下/自下而上构建 | 未开始（SKILL 体系属设备领域主线，控制台承接展示） | Skill 库建设 | 大 | 登记 |

