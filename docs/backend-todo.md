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

## 7.5 W3 → RQ 专页数据契约（前端 RQ 树/专页的每个字段 = W3 哪个 Phase 产出）

前端 RQ 界面的内容范围由 W3 真实产出决定，字段一一对应（均为主参考 §3.3 已有能力）：

| 前端字段 | W3 产出 Phase | 来源产物 |
|---|---|---|
| Macro-RQ 列表 + 绑定章节（chapter） | W3-P2 RQ Designer | 每个 Macro-RQ 对应一个核心章节 |
| Macro 分解逻辑（decompositionNote）/ 综合策略（synthesisPlan） | W3-P2 | Sub-RQ 划分依据与答案组织策略 |
| Sub-RQ 类型（rqType：descriptive/comparative/causal/trend/evaluative） | W3-P2 | 答案组织策略按类型选择 |
| 选择原因（motivation） | W3-P1 Survey Gap Analyzer | coverage/methodological gaps，不允许凭空声称 novelty |
| 焦点词（focusTerms） | W3-P2 定义，W3-P4 可扩展 | focus_terms |
| 期望证据（expectedEvidence）/ KG 查询路径（kgQueryPaths） | W3-P2/P3 | 预设 KG 证据类型 + 候选查询路径 |
| 可答性（score/level，strong ≥0.85 / weak 0.45–0.85 / blocked <0.45） | W3-P3 Grounding | Answerability Score |
| 冻结论文集合（matrix.entries） | W3-P3 | **rq_evidence_matrix.json（冻结，下游唯一入口）** |
| 修订动作（revisionNote） | W3-P4 Revision Loop | 扩展 focus_terms / 合并 / 降级 / 删除的处置记录 |
| 大纲章节绑定 | W3-P5 Outline Skeleton | survey_outline.json |

**接口建议**：`GET /projects/:pid/rqs` 返回 `{ macros: [...], matrix: {...} }`，字段命名与前端 `types/data.ts` 的 `MacroRQ/SubRQ` 一致；缺失字段（optional）前端自动显示"尚未生成（W3-Px 产出）"占位。

## 8. 基础设施（部署阶段）

- ECS（放既有 VPC 交换机）+ 弹性公网 IP + 安全组 80/443
- nginx 反代 `/api/*` → FastAPI 流水线包装层；托管前端 dist 静态产物
- 长任务状态推送：轮询起步，预留 SSE
