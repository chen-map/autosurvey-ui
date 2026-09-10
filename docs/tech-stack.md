# 技术栈选型 · AutoSurvey 前端控制台

> 状态：✅ 用户已确认（2026-09-10，React + React Flow 方案）

## 决策输入（来自前面阶段）

- 全新前端项目，无历史栈约束
- 后端 = Python 流水线（未定稿）→ 前端配套 REST 契约 + mock 层，长任务状态演示期轮询（3–5s），契约预留 SSE/WebSocket 升级位
- 交互复杂度高：KG 力导向画布、流水线 DAG/状态流、数据表、PDF 内嵌、Agent 时间线
- 无 SEO/首屏诉求（登录墙工具型产品）→ SPA
- 场景：演示/答辩 → 可静态部署（Vercel/Netlify + mock JSON），也需本地连后端模式（env 切换 mock/real）

## 推荐方案

| 层 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite 5 | 快，演示迭代频繁 |
| 框架 | React 18 + TypeScript | 生态最全，图可视化与表格库优先支持 React |
| 路由 | React Router | SPA 标准解 |
| 状态 | Zustand | 项目/流水线/选中态跨页共享，无样板代码 |
| 样式 | Tailwind CSS + design-db tokens.css | 基线 token 直接落成 CSS 变量 |
| 组件库 | shadcn/ui | 黑白极简语言与 xept 锚点天然一致，改造成本最低 |
| **KG 画布** | **React Flow + d3-force** | 自定义节点/边（六类节点色、contradicts 粗红边）最自由；演示规模（数百节点）无压力；教学资料多 |
| 数据表 | TanStack Table | 论文表/冻结矩阵/claims 列表，排序筛选够用 |
| 图表 | Recharts | PRISMA 漏斗、指标卡迷你图 |
| 图标 | lucide-react | 与 shadcn 同源 |
| Mock |MSW 或本地 JSON service 层 | F0-4 的契约即接口形状；env 一键切 mock/real |

## 备选（什么情况下换）

1. **Vue 3 + Pinia + Element Plus + AntV G6/X6** —— 团队更熟 Vue 时换；G6 在大规模图布局上开箱能力强，但自定义节点交互不如 React Flow 自由
2. **Cytoscape.js（配 React）** —— 若 KG 节点规模上到数千、内置力导向布局成为瓶颈时，仅替换画布层，其余不变

## 明确不用

- **Next.js/SSR**：登录墙工具，无 SEO；部署复杂度不值
- **Redux Toolkit**：状态规模不需要
- **ECharts/D3 裸写全图**：一个漏斗几个迷你图 Recharts 够；D3 只借 d3-force 布局算法
- **三套组件库混用**：管理端与主应用统一 shadcn/ui

## 后端契约建议（给后端调整的输入）

- REST 语义资源：`projects / runs(phases,logs,checkpoints) / papers / kg(nodes,edges) / rqs / evidence-matrix / claims / outline / reports / agent-runs / users`
- 长任务：`GET /runs/:id/status` 轮询起步，响应带 `phase_states[] + checkpoint指针`；预留 `SSE /runs/:id/events`
- KG 查询：`GET /kg/subgraph?rq_id=&node_types=&edge_types=`（前端不做全图拉取）

## 用户确认
React + React Flow 方案，2026-09-10 用户拍板（备选项的触发条件不变：团队转 Vue 则换 G6，节点规模上千则画布层换 Cytoscape）。
