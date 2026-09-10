# 同类产品调研 · AutoSurvey 前端

> 日期：2026-09-10 ｜ 主锚点：xept.online（用户指定，已实拍）

## 调研对象

| 站点/项目 | 链接 | 看了什么 | 证据 |
|---|---|---|---|
| **Xept** | xept.online/projects | 同品类（AI 学术写作平台）；注册/登录页与产品编辑器 | `[实拍]`（1440×900 截图 ×2 + computed style 提取） |
| Elicit | elicit.com | 文献即数据表的提取工作台范式 | `[来源]` |
| Connected Papers | connectedpapers.com | 相似度力导向图谱画布范式 | `[来源]` |
| Semantic Scholar | semanticscholar.org | 搜索+引用上下文列表范式 | `[来源]` |
| W&B / MLflow | wandb.ai / mlflow.org | run 跟踪与流水线 DAG 驾驶舱范式 | `[来源]` |
| 同类 AI 论文写作向导（用户提供截图） | — | 创建表单范式：顶部步骤条（标题→文献→大纲→浏览/下载）+ 逐字段 label 表单（学历层次/字数/题目/语言/图表公式/格式模版），红\*必填、下拉与上传控件、橙色内联帮助文案 | `[实拍]`（用户提供截图） |

## Xept 实拍提取 `[实拍]`

| Token | 值 |
|---|---|
| 页面底色 | `#f5f5f5`；卡片/模态纯白 `#fff` |
| 主色 | **黑白**：黑 wordmark、黑字、主按钮=白底 2px 黑边圆角 10px |
| 输入框 | 高 48px、内边距 12、圆角 8、底 `#f5f5f5`、字 15px |
| 信息条 | 底 `#EFF6FF` + 字 `#1E40AF`、圆角 8、13px（Tailwind blue-50/800） |
| 错误 | 边框与文字 `#E53935`，内联在控件正下方 |
| 字体 | 系统无衬线栈（v-sans, system-ui...），正文 14px，按钮 13px/600 |
| 层次 | 模态 + 背景压暗模糊（scrim+blur）；内容彩色（语法高亮）只出现在编辑区，框架 chrome 全黑白 |
| 认证 | 邮箱 + Google OAuth（白底描边按钮）；整站登录墙 |

**可迁移结论**：同品类对标成立——AutoSurvey 前端可直接采用"黑白 chrome + 内容即色彩"的语言：框架（导航/表格/表单）全黑白灰，彩色只留给 KG 节点分类、流水线状态、claims 核查结果三类**语义内容**。这与答辩诉求（证据链可信感）一致。

## 可借鉴的模式（按页面）

### 项目列表/创建 `[来源]`（xept projects 页 + 品类标配 + 用户截图范式）
- 项目卡片栅格 + 状态摘要；创建走分步向导
- 创建表单范式（用户截图 `[实拍]`）：顶部步骤条分步引导、每字段独立 label + 红\*必填标记、下拉/拖拽上传控件、内联帮助文案（帮助文案用暖色区分于正文）
- 标配输入件：研究领域标签选择器、主题输入、种子论文拖拽上传、本地资料批量上传、参数表单（检索式/阈值）

### 流水线监控 `[来源]`（MLOps 范式）+ `[先验]`（细节）
- 5W 分段进度条 + Phase 级状态点（pending/running/done/failed/checkpoint）
- 实时日志面板（等宽字体、自动滚动、按 Phase 过滤）
- 断点续传操作：失败 Phase 单独"从 checkpoint 重跑"
- 耗时与规模指标卡（162 papers → 13,041 pairs → 313 edges 这类数字要大）

### 语料库/证据表 `[来源]`（Elicit 范式）
- 论文表：标题/年份/来源/引用数/筛选阶段；列可排序、行可勾选
- PRISMA 漏斗可视化（数万→数百→百余，六阶段筛选各级数量）
- 论文详情 = 元数据 + PDF 预览 + Paper Card 六类对象标签页

### KG 画布 `[来源]`（Connected Papers 范式）+ `[先验]`（实现层）
- 力导向图：6 类节点分色（黑白 chrome 下唯一的强彩色区）、边分实/虚（论文内边/论文间关系）
- extends/compares_with/contradicts/supports 边类型可筛选；contradicts 用语义红强调（答辩讲"矛盾识别"的钩子）
- 点节点 → 侧栏 Paper Card；按 RQ 高亮子图（与冻结矩阵联动）

### RQ 证据与声明核查 `[先验]`（系统独有，无直接对标）
- RQ 树（Macro→Sub）+ Answerability 三档分卡（strong ≥0.85 / weak / blocked）
- 冻结矩阵只读表（Sub-RQ → Paper IDs，标"冻结"徽标——讲"防证据漂移"）
- Claims 列表：每条 claim 标四维核查结果（verified/needs_revision/should_remove），点开看依据论文与 KG 节点

### Agent 控制台 `[先验]`
- RQ 输入 → Skill 选择展示（37 选 1 的理由）→ agentic loop 步骤流（工具调用 trace 时间线）→ HTML 报告内嵌

## 现成组件/小工具候选

| 需求 | 候选 1 | 候选 2 | 初步倾向 |
|---|---|---|---|
| KG 图渲染 | React Flow（节点自定义强） | Cytoscape.js / sigma.js（大规模图更成熟） | 待 Phase 5 与栈一起定 |
| DAG/进度 | 自绘（5 段分段条） | DAGRE 自动布局 | W 是线性的，自绘即可 |
| PDF 预览 | iframe/浏览器原生 | pdf.js | 原生 iframe 起步 |
| 表格 | TanStack Table | AG Grid | TanStack（轻） |
| 图标 | lucide | — | lucide |

## 反思三问
- **直接采用**：xept 的黑白 chrome + 内容即色彩、MLOps 的 run/DAG 状态语言、Elicit 的证据表
- **看着好但不适合**：Connected Papers 的全文相似度图（我们的 KG 是语义图不是相似度图，布局算法与交互目的不同，只借画布交互不借布局语义）；整站登录墙（演示场景要免登录直达）
- **有意差异化**：claims 四维核查与冻结矩阵是本系统独有卖点，界面要为"答辩讲解"设计（大字号分数、可点开的追溯链），而非做成后台表格

## 待实拍清单（Phase 6 前）
- W&B 单个 run 页面布局（日志+参数+指标三栏比例）
- Connected Papers 画布交互细节（节点 hover 卡、边高亮）
