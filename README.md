# AutoSurvey · 可追溯的 AI 综述生产系统（公开演示与开放工作流）

AutoSurvey 面向科研文献调研场景：把一个研究方向的上百篇论文，整理成**证据可回溯、结论可核查、人工可修订**的综述初稿。系统的核心不是“让模型写一篇文章”，而是把综述生产拆成可检查的环节：检索与筛选、论文结构化、论文关系图、研究问题与证据矩阵、逐题分析、写作与质量检查。

本仓库是 **open-core 的公开部分**：控制台前端、真实运行快照、五步工作流关键实现摘录、分析工作流规范和参赛文档。完整可运行系统（后端服务、数据库、部署配置）在私有仓库中维护，可按评审需要提供只读访问。

- 在线演示：<https://chen-map.github.io/autosurvey-ui/>
- 公开数据：`public/showcase/`（六个真实项目的 RQ、证据矩阵、claims、原文页码、综述 PDF）
- 五步工作流代码摘录：[`open/pipeline/`](open/pipeline/README.md)（W1–W5 各环节关键实现 + 37 技能执行框架导读）
- 开放工作流：`open/analysis-skills/`（37 个分析策略规范）
- 开放计划：[docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md)
- 第三方资源清单：[docs/THIRD_PARTY_RESOURCES.md](docs/THIRD_PARTY_RESOURCES.md)
- AI 工具使用说明：[docs/AI_USAGE.md](docs/AI_USAGE.md)
- 数据卡：[docs/DATA_CARD.md](docs/DATA_CARD.md)

## 在线演示看什么

1. 登录页点「直接进入公开数据演示」（只读，无需账号）。
2. 选择任一「真实快照」项目，查看语料筛选漏斗、论文关系图、RQ 与证据矩阵。
3. 打开一条 claim，查看它对应的论文、PDF 页码和原文高亮条带。
4. 打开「开放数据」页，下载 JSON / PDF，查看静态接口与字段说明。

## 本地运行（仅前端）

```bash
npm ci
npm run dev      # http://localhost:5173，账号 demo / 123456
npm run build
```

公开仓库不含可运行的后端服务、数据库、部署脚本、访问凭据或生产配置；流水线关键算法以源码摘录形式开放于 [`open/pipeline/`](open/pipeline/README.md)（含摘录说明）。完整系统的运行方式见私有仓库说明；评审需要时可通过只读方式提供。

## 数据与许可

- 本仓库中由团队原创的代码与文档：Apache-2.0，见 [LICENSE](LICENSE)。
- `public/showcase/` 中的结构化标注与生成综述：CC BY 4.0，见 [public/showcase/LICENSE](public/showcase/LICENSE)。
- 论文题录、DOI 与短引文来自公开学术文献，其权利仍归原作者/出版方；本仓库仅保留验证引用所需的最短片段，不包含论文全文或批量摘要。
- 第三方组件、模型、数据源与服务的许可与义务见 [docs/THIRD_PARTY_RESOURCES.md](docs/THIRD_PARTY_RESOURCES.md)。

## 边界与声明

生成文本由模型辅助完成，可能存在错误；本项目展示的是“可追溯、可核查”的生产流程，不构成学术结论。公开快照已移除账号、服务器路径与访问凭据，不包含学校名称、校徽或指导教师信息。

问题与建议请通过 GitHub Issues 提出。
