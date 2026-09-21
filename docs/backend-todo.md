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

## 8. 基础设施（部署阶段）

- ECS（放既有 VPC 交换机）+ 弹性公网 IP + 安全组 80/443
- nginx 反代 `/api/*` → FastAPI 流水线包装层；托管前端 dist 静态产物
- 长任务状态推送：轮询起步，预留 SSE
