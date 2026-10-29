# 真实运行快照（只读）

生成时间：2026-10-29 21:45

本目录是 AutoSurvey 在真实项目上跑完整流程后的静态数据副本，用于 GitHub Pages 公开展示。
页面通过读取这些 JSON / PDF 渲染，不需要后端服务。

## 内容

每个项目目录包含：

- `rqs.json`：研究问题树、证据矩阵、逐条结论（claims）及其原文引文 / 页码 / 高亮截图
- `kg.json`：论文关系图的节点与边（已按展示需要截断高复杂度子图）
- `corpus.json`：语料、筛选漏斗与论文结构化字段
- `report.json`：综述大纲与评审记录
- `reports.json` + `w4/*.html`：逐 RQ 分析报告
- `survey.pdf`：最终编译的综述全文
- `evidence/*.jpg`：结论对应的原文页高亮截图（仅导出被 claims 引用的页）

## 边界

- 只读：不含登录、密钥、账号、服务器路径或后端源码。
- 论文题录与原文短引文来自公开学术文献，仅用于验证引用可回溯。
- 生成文本由模型辅助完成，可能存在错误；本项目展示的是可追溯与可核查的生产流程，不构成学术结论。

## 项目

- `multi-agent`：多智能体协作：失败诊断、架构与评估（197 篇论文 / 15 个 Sub-RQ / 120 条 claims）
- `smallholder-agri`：面向小农的农业人工智能：从技术供给到采纳机制（84 篇论文 / 13 个 Sub-RQ / 117 条 claims）
- `crispr-safety`：CRISPR 递送与编辑安全性：面向临床转化的风险建模（139 篇论文 / 15 个 Sub-RQ / 117 条 claims）
- `agent-evolution`：Agent 进化轨迹：机制与路径（276 篇论文 / 13 个 Sub-RQ / 118 条 claims）
- `llm-judge-robustness`：LLM Judge 失效分析：多模态与大规模引用场景（116 篇论文 / 8 个 Sub-RQ / 45 条 claims）
- `self-improving-sec`：网络与软件安全中的大模型与智能体自改进方法（284 篇论文 / 15 个 Sub-RQ / 120 条 claims）
