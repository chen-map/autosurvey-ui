# 需求框架 · AutoSurvey 前端控制台

> 状态：✅ 已确认基线（非冻结，新需求走变更协议） ｜ 最后确认：2026-09-10
> 编号：B = 品类标配（用户裁决保留）；F = 功能点；全部条目已经 Phase 3 逐项裁决

> **📌 主参考（用户指定，牢记）**：`references/Auto_Survey_系统总结与可迁移方向分析.docx`（已归档，流程图见 `references/主参考-流程图/`）。系统 = 5 Workflow / 19 Phase；KG 是唯一事实权威；Workflow 间仅经 Working Memory（wm/{project_id}/）交换数据；rq_evidence_matrix.json 冻结为下游唯一入口。**单 RQ 分析（Agent 页）= 主参考 §3.4.1 LLM Agent 驱动版**：L1 KG 原子工具（get_entity_by_type / get_relation / semantic_search / count / intersect / judge / end 等）→ L2 37 Skills（Problem Space 18 + Solution Space 19）→ L3 Agent tool_use 循环（≤30 轮）→ HTML 报告 + tool_log.json。**其数据底座是 W2 产出的 KG（paper_kg.db），不是 W1 原始语料**。

## 登录与全局

### 页面：`/login` + 全局框架
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B0-1 | 简单登录页 | 黑白登录卡（xept 同款范式），演示账号，登录态存 localStorage | S | 用户裁决 | ✅ |
| B0-2 | 全局框架 | 左侧导航（项目/管理）+ 顶栏（项目切换、只读徽标、DEMO DATA 徽标） | M | 品类标配 | ✅ |
| F0-3 | 只读演示模式 | 观众视角：写操作按钮隐藏，只读徽标常驻 | S | [推断] 随角色报备通过 | ✅ |
| F0-4 | mock 数据层与 API 契约 | 全站数据来自 mock 包（两个快照：全流程完成 / W3 进行中），service 按 REST 语义命名 = 未来 API 契约；后端未定稿的对接方案 | M | [推断·用户裁决未勾回放模式的替代] | ✅ |
| F0-5 | 演示回放模式 | 流水线进度模拟回放（答辩现场动态演示） | M | 用户未勾选 | ⏳ v2 |

## 管线与输入（裁决 A）

### 页面：`/projects` + `/projects/new`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B1 | 项目列表 | 卡片栅格：主题、进度摘要、规模数字、更新时间；xept 卡片范式 | S | 用户裁决 | ✅ |
| B2 | 创建向导·框架 | 顶部步骤条（研究领域 → 主题与种子 → 本地资料 → 参数 → 确认创建），表单范式参照用户提供的同类产品截图：每字段独立 label + 红\*必填 + 内联帮助文案 | S | 用户裁决 | ✅ |
| B2-1 | 研究领域标签选择器 | 预设领域标签多选（如 LLM 安全/智能体/多模态，可增删）+ 自定义标签输入；选择结果联动检索式预览 | S | 用户提出"研究领域标签" | ✅ |
| B2-2 | 主题输入 + 方向库快速选择 | 主题输入框带帮助文案；「从研究方向库快速选择」——**整方向带入**：主题 + 领域标签 + **领域描述/研究目标**（可编辑），供 W1 关键词提取与 Gap 分析使用 | S | 用户提出(方向库联动 + 整体带入) | ✅ |
| B2-3 | 种子论文上传 | 拖拽上传区 + PDF 类型/大小行内校验 + 已上传列表可删除；Golden Set 覆盖率提示位 | M | 用户提出"上传种子" | ✅ |
| B2-4 | 本地资料上传 | 可选批量上传（对应 W1 P7 本地论文合并），控件同 B2-3 | S | 用户提出"上传资料" | ✅ |
| B2-5 | 参数配置表单 | 检索式预览、prescore 阈值、六阶段筛选档位；语言/字数/图表等字段是否纳入 [推断] 待后端契约确认 | M | 品类标配 + 参考截图（学历/字数/语言/图表等字段范式） | ✅ |

### 页面：`/projects/:id/pipeline`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B3 | 流水线监控 | 5W 分段进度 + 19 Phase 状态点（含 checkpoint 态）+ 实时日志面板（按 Phase 过滤、等宽字体）+ 失败 Phase「checkpoint 重跑」+ 规模指标卡（162 papers→13,041 pairs→313 edges 式大数字） | L | 用户裁决 | ✅ |

### 页面：`/projects/:id/corpus` + `/papers/:pid`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B4 | 语料库+筛选漏斗 | PRISMA 漏斗可视化（六阶段各级数量）+ 论文数据表（标题/年份/来源/引用数/筛选阶段，排序筛选） | M | 用户裁决 | ✅ |
| B5 | 论文详情+Paper Card | 元数据 + PDF 内嵌预览 + 六类对象标签页（problems/methods/datasets/metrics/limitations/assumptions）【W2】 | M | 用户裁决 | ✅ |

## W2/W4 重点（裁决 B）

### 页面：`/projects/:id/kg`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B6 | KG 可视化画布 | 力导向图：6 类节点分色（全站唯一强彩色区）+ 边类型筛选（contradicts 语义红）+ 点节点联动侧栏 Paper Card + 按 RQ 高亮子图【W2·答辩视觉中心】 | L | 用户裁决 | ✅ |

### 页面：`/projects/:id/rq` + `/rq/:rqid/evidence`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B7 | RQ 树+冻结矩阵 | Macro→Sub 两级树 + Answerability 三档分卡（strong/weak/blocked 大字号）+ 冻结矩阵只读表（"已冻结"徽标，防证据漂移卖点） | M | 用户裁决 | ✅ |
| B8 | 证据与声明核查 | 证据池（≥5 篇达标提示）+ overall_answer（500–800 字）+ claims 四维核查列表（verified/needs_revision/should_remove），点 claim 展开追溯链（论文位置+KG 节点）【W4·讲解核心】 | L | 用户裁决 | ✅ |

### 页面：`/projects/:id/report` + `/projects/:id/agent`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B9 | 大纲与报告 | survey_outline 章节树（章节→RQ→论文绑定）+ main.pdf 内嵌预览/下载 + 审查轮次记录 | M | 用户裁决 | ✅ |
| B10 | Agent 控制台 | RQ 输入 → Skill 选择展示（37 选 1 理由）→ agentic loop 工具调用时间线 → HTML 报告内嵌 + tool_log 查看 | L | 用户裁决 | ✅ |

## 管理端

| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B11 | 管理员最小集 | `/admin` 全项目总览 + 用户列表（角色/停用开关）；非管理员 403 | M | 用户追加角色，功能集 [推断] 默认最小集 | ✅（深度功能见变更池） |

## 全局板块（侧栏导航）

### 页面：知识库 `/library`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B12 | 知识库（前端版） | 收藏论文（语料库行内收藏按钮 / 论文抽屉）、分类集合管理（新建/移动）、搜索；localStorage 持久化，后端持久化进 backend-todo | M | 用户裁决(F16) | ✅ |

### 页面：研究方向 `/direction`（研究方向库）
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B13 | 研究方向库（前端版） | 多方向 CRUD（标题/领域标签/研究目标）+ **默认预选**（新建向导自动带出该方向的领域标签）+ 旧单一画像自动迁移；localStorage，后端 CRUD 见 backend-todo §2 | M | 用户裁决(B13 升级为方向库) | ✅ |
| B14 | AI 方向精炼（mock 版） | 方向页内：模糊 prompt → 结合领域标签精炼为专业研究方向（阐述/研究问题/Gap）+ 推荐论文 3 篇，**一键采纳并存入方向库**；真实实现（后端 LLM 代理 + Semantic Scholar 检索）见 backend-todo.md §3 | M | 用户裁决(F18 升级进本版) | ✅ |

### 页面：个人中心 `/me`
| 编号 | 功能点 | 交互描述 | 工作量 | 来源 | 裁决 |
|---|---|---|---|---|---|
| B15 | 个人中心（前端版） | 个人信息卡 + **付费平台 API Key 存储**（掩码显示/眼睛切换，localStorage）+ 研究方向摘要与快捷入口；向导付费平台提示链接到此页。后端加密存储进 backend-todo §5 | M | 用户提出(个人信息界面/API 存储) | ✅ |
| B16 | Agent 检索选项（前端版） | 检索平台新增「Agent 检索」：LLM Agent 聚合检索（按问题发起、无布尔式限制、无平台限流），个人中心存其服务 Key；后端聚合服务实现见 backend-todo §7 | M | 用户提出 | ✅（前端版） |

## 延后（v2）｜变更池
| 编号 | 功能点 | 原因/备注 |
|---|---|---|
| F0-5 | 演示回放模式 | 用户裁决未勾选；mock 数据层（F0-4）已覆盖开发与静态演示需要 |
| F12 | 管理员深度用户管理 | 用户管理 CRUD/权限编辑；B11 只做列表+停用 |
| F13 | 增量更新可视化 | 新论文加入后受影响子图高亮（对应后端 6.2 规划） |
| F14 | 数据失效细粒度追踪 | 重跑后仅提示条（本次静态），细粒度失效 v2 |
| F15 | 付费平台余额计费系统 | 用户提出备选方案。开源与收费不冲突（托管版计费/自部署免费，open-core 模式）；实现路径：付费平台（IEEE/ACM/Springer/Elsevier）先走 BYO Key，余额计费在产品化阶段再决策。向导已预留付费平台标识与提示 |
| F18 | 选题推荐 · 后端真实实现（LLM 代理 + Semantic Scholar 检索） | 前端 mock 版已并入研究方向页（B14）；后端代理接口与论文检索见 backend-todo.md §3 |
| F19 | 知识库后端持久化 | 前端版为 localStorage；跨设备同步需后端接口（已登记 backend-todo.md §1） |
| F20 | 个人中心后端化 | 用户表扩展（昵称/头像）+ API Key 服务端加密存储（接口只回掩码，见 backend-todo.md §5） |

## 已排除
（无）

## 数据需求（= 未来 API 契约，mock 层同形）
`projects` / `pipelineruns`（含 phase 状态、logs、checkpoints）/ `papers`（含 paper_card 六类对象）/ `kg`（nodes/edges 查询，按 RQ 子图）/ `rqs`（树+answerability）/ `evidence_matrix`（冻结只读）/ `claims`（含四维核查结果与追溯引用）/ `outline` / `reports`（pdf、审查轮次）/ `agent_runs`（skill 选择、tool 调用 trace、html 报告）/ `users`
长任务状态：演示期轮询（3–5s），契约预留 SSE/WebSocket 升级位。

## 全局/边界状态
DEMO DATA 徽标常驻；403 页；上传非 PDF 行内报错；空项目/无论文/空 claims 空态；Phase 失败红色态+重跑；「数据已过期」提示条（静态）。

## 工作量总览（价格信号）
- S：B0-1 登录、B1 项目列表、F0-3 只读模式、B2 向导框架、B2-1 领域标签、B2-2 主题输入、B2-4 资料上传
- M：B0-2 框架、F0-4 mock 层、B2-3 种子上传、B2-5 参数表单、B4 语料库、B5 论文详情、B7 RQ 树、B9 报告、B11 管理端
- L：B3 流水线监控、B6 KG 画布、B8 证据核查、B10 Agent 控制台
- 合计约 7S + 9M + 4L

## 变更协议状态
基线确认于 2026-09-10。变更池见上。文档源头层级：本文件是范围唯一事实源；workflow.md / requirements-snapshot.md / research.md 为对应领域文档，页面级小变更不回写。

## 变更记录
| 日期 | 变更 | 影响面 | 提出人 |
|---|---|---|---|
| 2026-09-23 | **W3 部署完成并真实跑通**（用户：继续部署W3）。存量 W3 六阶段映射为执行器七 Phase：P1 Gap 分析（LLM）→ P2 RQ 设计（LLM）→ P3 查询落地（存量 query_rq_evidence.py，产出 registry/matrix/reflection/outline 全家桶）→ P4 证据核验（v2 schema answerability 分级）→ **P5 反思修订（LLM 改写被拦截 Sub-RQ）→ P6 二次查询落地 → P7 综述评审**（GUIDE 的 Phase 4 反思循环折叠为 P5/P6 线性一轮）。新增 backend/w3 三件套：llm_doc.py（gap/design/review/revise 四任务的 LLM 驱动，复用 llm_wrap use_case 解析链，=== FILE: === 分节拆写）、w3_verify.py、phase_defs.py。runner/后端/前端扩至 w3。实跑（100 篇 KG）：12 Sub-RQ 首轮 8 个被拦截（语义失配）→ 反思修订后 **blocked 8→5、strong 4→5**，大纲 4 章/12 小节带真实论文绑定。途中修：llm model 数组 422、FILE 路径双写、--target 传参键、kg_common 跨工作流注入（llm_wrap 新增 --kg-common-path）、LLM 长输出截断（必检产物收敛+兜底）。遗留：5 个 blocked Sub-RQ 需再一轮修订；RQ 页与 Agent 页吃 analyze_report 真产物为下一步 | backend/w3/*（新）、runner.py、llm_wrap.py、api/main.py、PipelinePage、api.ts | 用户 |
| 2026-09-22 | **W2 前端接线完成**（用户：先把前端和W2接上）。① 流水线页新增 W1/W2 工作流切换标签：api.ts 新增裸状态→PipelineRun 适配器（阶段聚合/进度/指标尽力取数 corpus+kg/日志由阶段记录合成）；启动/重试均带 workflow 参数。② Agent 页接入真 KG：替换硬编码"162篇/645概念"假概览，改为拉取 /kg 真实统计（100 篇/985 节点/1422 边 + 类型分布 + 度数 Top30 概念）进 LLM 提示词；无 KG 时显示引导条并禁用分析。**顺带修掉三个白屏级 bug**：runner.py `run_phase` 漏传 state_file（W2 阶段进度全写进 w1_state.json，污染多个项目状态文件，已重建修复）；ProjectsPage statusBadge 缺 failed 状态（出现失败项目即全页白屏，补映射+兜底）；App 增加全局 ErrorBoundary（渲染异常不再无声白屏）。实测：W2 标签 4 Phase 全绿、Agent 基于真 KG 输出结构化分类分析 | PipelinePage、AgentPage、ProjectsPage、App.tsx、services/api.ts、backend/w1/runner.py | 用户 |
| 2026-09-22 | **KG 渲染层重写：canvas + 两级视图**（用户问：500 篇这么大的 SVG 图渲染怎么办）。SVG 每帧 tick 全量 React 重渲，985 节点已是上限；重写为 canvas 命令式渲染（rAF + 脏标记，React 退出热路径），**概览模式**（>400 节点默认：Paper 层 + 度数 Top-300 概念，其余折叠）、点选/搜索**按需展开一跳邻域**、标签 LOD（缩放不足只画重点）、类型筛选/搜索/详情卡/拖拽/缩放平移全保留。实测：985 节点真图 60fps、**6000 节点合成压测（≈500 篇）概览与全部模式均 60fps**。顺手修：切项目残留搜索状态导致全图淡显。数据层不动——KG 全量保留，W3 查询按 RQ 取子图 | KgPage（canvas 重写）、mock/kg 不变 | 用户 |
| 2026-09-22 | **W1 下载提速：P6 arXiv 批量直连**（用户提供 CocoLoop 技能链接问能否解决下载过慢/限流；评估其限速模式后自研落地，第三方代码未入库）。新增 `w1/arxiv_batch.py` 挂 P6（prep → **arxiv_batch** → 旧五级链兜底）：共享节流状态（5s/篇 ≈12 篇/分钟）+ 全局冷却 + 断点续传（命名对齐 safe_filename，旧链 --skip-existing 无缝衔接）+ `%PDF`/≥5KB 校验。实测破案：arXiv CDN 按 TLS 指纹过滤 python-urllib（缓存未命中 406，curl 直连 200）→ **curl 子进程为首选通道**，urllib 代理/直连兜底；无版本旧 ID 自动试 v1。30 篇真数据 **30/30 全成功**（此前 60 篇仅 2 成）。同日修复 OAI 收割器：真实记录为无前缀裸标签 `<arXiv>`（原正则每页 0 条致无限翻库）+ authors 结构化解析 + 重试上限 + 空页熔断 + Accept 头。配置键 `arxiv_dl_min_interval` | W1-P6 phase_defs、backend/w1/arxiv_batch.py（新）、arxiv_oai.py、docs/arxiv-compliance.md | 用户 |
| 2026-09-21 | **W2 集成 + KG 页 Obsidian 化**（用户提出：推进 W2；KG 图做成 Obsidian 内置样式）。执行器泛化双工作流（runner --workflow w1/w2，状态文件分离，API 带 workflow 参数）；`w2/phase_defs.py` 四 Phase 对齐主参考 §3.2（解析→提取→筛选→建图，全用存量脚本，断点续传沿用）；新增 `GET /projects/{pid}/kg` 读 paper_kg.json；KG 页重写为 d3-force 力导向图（连接度定大小、七类着色、悬停高亮邻域、光标锚点缩放平移、节点拖拽、类型筛选、点选详情、矛盾红/支持绿边），真实数据 mock 同构 |
| 2026-09-21 | **W1 产物回流闭环**：下载完成后自动入用户端本地库（autosurvey.db 新增 corpus_papers 表），语料库页改从库读取。链路：P6 steps_tail 执行 w1/corpus_ingest.py（PDF=downloaded / 占位=failed / 无DOI=no_doi 三态 UPSERT）→ GET /projects/{pid}/corpus（论文列表 + 六级 PRISMA 漏斗：检索归一→筛选纳入→下载就绪→成功下载→下载失败→无DOI分流）→ getCorpus(projectId) 前端接线（CorpusPage/KgPage）。烟雾测试：25 条真实下载产物入库 18/7/0，端点 200，未知项目 404 |
| 2026-09-21 | **B7 四次修正：RQ 页面以 W3 真实产出为准**（用户强调：看 W3 输出什么决定展示什么）。实读 autoSurvey_v2 `WORKFLOW3_GUIDE.md` 后重造数据层：真实产物为 `analyze_report/` 三结构化文件（rq_evidence_matrix.json 冻结矩阵 / rq_query_registry.json 查询计划 / survey_outline.json 大纲）+ 三 markdown（gap_summary / design_report / rq_reflection_log）。变更：① ID 约定改为真实点号层级 RQ1 / RQ1.1 ② Sub-RQ 内嵌 paperIds/kgNodeCount/kgEdgeCount/section（真实字段）③ 专页新增「查询计划」分节（query_intent/focus_terms/node_types/edge_types/candidate_paths）④ 每个分节标注来源文件名（analyze_report/xxx.md）⑤ 移除 W3 并不产出的臆造字段（rqType/analysisSteps/kgQueryPaths）⑥ 头部显示章节号与建议产物（survey_outline.json suggested_artifact）。backend-todo §7.5 按真实文件重写 |
| 2026-09-21 | **B7 三次升级：RQ 两级专页 + 内容由 W3 产出决定**（用户提出：① 点 Macro-RQ（如 RQ1）也要能进入专页 ② RQ 界面该有什么内容由 W3 能产出什么决定）。RQ 树两级整行可点：Macro 行 → Macro 专页（Macro 简述/分解逻辑/Sub-RQ 分解/汇总证据/怎么综合/缺陷/答案与核查，分卡取 Sub 均值）；Sub 行 → Sub 专页（7 分节不变），专页头部 RQ1 徽标可返回 Macro 专页。数据契约落 docs/backend-todo.md §7.5：每个字段标注 W3 哪个 Phase 产出（P1 Gap→motivation、P2 设计→类型/焦点词/查询路径、P3 Grounding→可答性+冻结矩阵、P4 修订→revisionNote、P5 大纲→章节绑定）。**修复用户主项目「LLM Agent 安全综述」RQ 数据为空导致的无处可跳问题**：mock 按真实论文（Greshake/AgentDojo/R-Judge/InjecAgent/Spotlighting/GuardAgent 等 8 篇）补全 4 Macro / 6 Sub 完整体系，GNN 项目 4 个 Macro 补 W3 字段 |
| 2026-09-21 | **B7 二次升级：每个 RQ 专门一整页**（用户提出：每个 RQ 要专门做一页，包含 RQ 简述/使用证据/包含内容/怎么分析/具体缺陷/选择原因分析等，内容要详细）。RQ 详情页重写为文档式长页：头部（分卡+类型+章节+归属 Macro）+ 粘滞分节导航 + 7 个编号分节——① RQ 简述 ② 选择原因（Gap 来源 + 在综述中的角色/删去会怎样）③ 包含内容（口径 + 纳入/排除清单 + 焦点词）④ 怎么分析（按 RQ 类型的答案组织策略 + 执行步骤 + KG 候选查询路径）⑤ 使用证据（从冻结矩阵恢复的论文集合 + 解析详情）⑥ 具体缺陷（证据/数据/口径层面 + P4 修订循环动作）⑦ 答案与核查（overall_answer + claims 四维核查）。SubRQ 模型新增 summary/roleInSurvey/includedScope/excludedScope/analysisPlan/analysisSteps/deficiencies 六字段，mock 8 个 Sub-RQ 全量填充 | RQ 详情页（文档式专页）、types/data.ts、mock/rq.ts | 用户 |
| 2026-09-21 | **B7 升级：RQ 详情页改为「RQ 说明」+「答案与核查」双标签**（用户提出：RQ 要有专门界面说明其内容，不是只有 answer）。默认标签「RQ 说明」= 这个 RQ 在问什么（口径边界）/ 为什么提出（W3-P1 Gap 来源）/ 焦点词 / 期望证据 / KG 候选查询路径 / P4 修订循环动作（blocked 时）；「答案与核查」= 原 overall_answer + claims 四维核查 + 证据池。数据模型 SubRQ 扩展可选字段（rqType/motivation/definition/focusTerms/expectedEvidence/kgQueryPaths/chapter/revisionNote，对齐主参考 W3-P2/P3 产出），mock 已全量填充 | RQ 详情页（RqDetailPage 替换 EvidencePage）、types/data.ts、mock/rq.ts、RqPage 链接文案 | 用户 |
| 2026-09-21 | **W1-P6 下载确立 DOI 锚定协议**：下载必须以 DOI 为锚（不用 DOI 会跑偏）。P6 改为两步链：新增执行器层 `download_prep.py`（DOI 归一、arXiv 记录注入官方 10.48550 DOI、标题消毒、去重、无 DOI 分流到人工/本地合并）→ 存量 `download_papers.py --no-scihub` 五级合法降级。25 条真实样本实测：arXiv 15/15、付费墙 3/10，合计 72%，PDF 全过 magic bytes；失败自动生成手动下载指引占位，配合 P7 本地合并闭环 | W1-P6 phase_defs、backend/w1/download_prep.py（新）、w1-pipeline-design.md | 用户 |
| 2026-09-21 | **登记主参考**：《Auto_Survey_系统总结与可迁移方向分析.docx》为项目主要参考（已归档 references/，含 6 张流程图）。据主参考修正主功能链路认知：单 RQ 分析（主功能）的数据底座是 **W2 产出的 KG（paper_kg.db / nodes+edges JSON）**，非 W1 原始语料——W1 语料需先经 W2（PDF 解析 → 六类对象提取 → KG 构建）才能被 Agent 工具查询。Agent 页目标形态 = 主参考 §3.4.1 三层架构（L1 KG 原子工具 / L2 37 Skills / L3 Agent 循环 → HTML 报告 + tool_log.json）；当前 AgentPage 硬编码的「162 篇/645 概念/313 边」即主参考 §3.2 的示例 KG 规模 | 需求基线全局、Agent 页目标形态、后端 roadmap（W2 为单 RQ 主功能的前置） | 用户 |
| 2026-09-21 | **功能优先级澄清**：单个 RQ 分析（Agent 页）为主要功能；综述写作（W5/报告页）为主要功能之后产生的衍生功能。W1 语料库定位为服务于单 RQ 分析的数据底座。当前断点：AgentPage 喂给 LLM 的是硬编码 KG 概览（162 篇/645 概念/313 边），未消费 W1 真实语料产物；语料页（/projects/corpus）、RQ 树（/{pid}/rqs）、报告（/projects/report）、agent-runs、/users 五个真实端点后端未实现 | 需求基线优先级、Agent 页数据来源、backend-todo 端点清单 | 用户 |
| 2026-09-12 | 方向库快速选择升级为**整方向带入**：选中方向自动填入主题、领域标签与领域描述/研究目标（新增描述字段，作为 W1 关键词提取与 Gap 分析输入）；createProject 契约增加 description | 向导第 2/5 步、api-contract（createProject 载荷）、backend-todo §4 | 用户 |
| 2026-09-12 | B2-2 增加方向库快速选择：新建向导主题步可直接选用研究方向库中的方向（自动填入主题与领域标签） | 仅 `/projects/new` 第 2 步 | 用户 |
| 2026-09-12 | B13 升级为研究方向库：多方向 CRUD + 默认预选联动向导 + AI 精炼一键入库；旧单一画像自动迁移。个人 API 存储（B15）确认为部署期 BYO Key + 后端加密（backend-todo §5） | 研究方向页重构、创建向导预选逻辑、个人中心摘要 | 用户 |
| 2026-09-12 | F18 升级进本版（B14）：研究方向页新增 AI 方向精炼（模糊 prompt → 专业化方向 + 推荐论文，mock）；真实实现（后端 LLM 代理 + Semantic Scholar）与 refine 契约登记 backend-todo.md §3 | 研究方向页；backend-todo.md | 用户 |
| 2026-09-12 | 侧栏扩展：新增 B12 知识库（收藏+分类集合）与 B13 研究方向画像（静态版，与向导预选联动）；F18 Gap 推荐入口与 F19 知识库后端持久化进变更池；新建 docs/backend-todo.md 收纳后端侧任务 | 侧栏导航、/library、/direction 两个新页面、语料库收藏按钮、backend-todo.md | 用户 |
| 2026-09-12 | B2-5 参数配置扩展：论文数量上限拆分为「检索上限（默认 2000，决定 W1 筛选量）」与「最终保留上限（默认 500，决定 W2 KG 耗时）」双参数，保留 ≤ 检索自动钳制；搜索平台增加免费/付费分层标识（付费走自带 API Key） | 向导第 4 步与确认页；未来 API 契约的 createProject 载荷增加 searchCap/corpusCap/platforms | 用户 |
| 2026-09-10 | B2 创建向导细化：拆为向导框架 + 研究领域标签选择器 + 主题输入 + 种子论文上传 + 本地资料上传 + 参数配置表单（用户提出输入步骤必须有上传资料/上传种子/研究领域等标签化字段，并提供同类产品表单截图为范式） | 仅 `/projects/new` 单页；research.md 增补该表单范式 | 用户 |
