# AutoSurvey Console · 综述流水线控制台

**AutoSurvey v3 前端控制台** —— 给"综述主题 + 种子论文 → 可投稿 PDF"的学术自动化流水线（5 Workflow / 19 Phase）做的 Web 界面，重点展示 **W2 知识图谱构建**与 **W4 RQ 证据与声明核查**，为演示/答辩场景设计。

> 本项目由 frontend-blueprint（需求前置工作流）技能全程驱动产出：需求快照 → 多角色工作流 → 功能逐项裁决 → xept 实拍锚点 → 技术栈拍板 → UI 设计，全部文档见 [`docs/`](docs/)。

## 特性

- **流水线监控**：5W 分段 × 19 Phase 状态、实时日志（按 Phase 过滤）、checkpoint 重跑、规模指标卡
- **语料库**：PRISMA 六阶筛选漏斗、论文数据表、论文抽屉（Paper Card 六类结构化对象）
- **RQ 与证据（W4 门面）**：RQ 树、Answerability 圆环分卡（strong/weak/blocked）、冻结证据矩阵、claims 四维核查（引文/语义/覆盖/跨文，可展开追溯链）
- **KG 图谱（W2 门面）**：d3-force 力导向画布、六类节点分色、矛盾边红色强调、按 RQ 高亮子图、500/1000 论文压力快照（构建实测 294ms/500 节点）
- **报告**：大纲树（章节→RQ→论文，可跳转）、PDF 预览、自动审查轮次
- **Agent 控制台**：RQ 输入 → 37 选 1 Skill 展示 → agentic loop 工具调用时间线 → HTML 报告
- **创建向导**：研究领域标签、种子论文上传、七库检索平台多选、论文数量上限、prescore 阈值
- **管理后台**：全项目总览、用户管理
- **全局**：黑白账本视觉（彩色只用于证据语义）、只读演示模式、DEMO DATA 徽标、十项反幼稚审计通过

## 技术栈

Vite 5 · React 18 · TypeScript · Zustand · Tailwind CSS · shadcn/ui 范式 · React Router（Hash） · d3-force + React Flow · Recharts · lucide

## 运行

```bash
npm install
npm run dev      # http://localhost:5173  账号 demo / 123456
npm run build    # 产物 dist/
```

数据全部来自 mock 层（`src/services/api.ts` 即 REST 契约，`VITE_USE_MOCK` 切缝）；后端（Python 流水线包装层）就绪后逐函数替换实现。

## 在线演示

`main` 分支推送后经 GitHub Actions 自动部署至 **https://chen-map.github.io/autosurvey-ui/**

## 文档

| 文档 | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 需求基线（20 功能点裁决 + 变更池 + 变更记录） |
| [docs/workflow.md](docs/workflow.md) | 三角色工作流推演 |
| [docs/research.md](docs/research.md) | 同类产品调研（xept 实拍等，带证据分级） |
| [docs/tech-stack.md](docs/tech-stack.md) | 技术栈选型与架构预留 |
| [docs/ui-design.md](docs/ui-design.md) | 设计 token 与核心页面线框 |
| [docs/references/](docs/references/) | 实拍截图与性能实测记录 |

## License

MIT
