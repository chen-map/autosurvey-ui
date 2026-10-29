# 五步工作流 · 算法代码导读

本目录按工作流顺序摘录 AutoSurvey 流水线各环节的关键实现，供阅读与复用参考：五步工作流如何编排、逐题分析如何执行 37 个策略、每条结论如何定位到原文页码。

> **摘录说明**：文件保持与完整系统一致的路径与内容，但部分 `import` 依赖未收录的内部模块（如数据库读写、部署配置），因此**不可独立运行**。完整可运行系统（FastAPI 服务、数据库、部署）在私有仓库中维护，评审需要时可申请只读访问。规范层面的 37 个分析策略全文见 [`../analysis-skills/`](../analysis-skills/)。

## 总览

```
研究方向 + 种子论文
        │
┌───────▼────────┐   检索 → LLM 筛选 → DOI 锚定下载          语料库（PDF + 题录）
│  W1 语料构建    │   phase_defs / runner / arxiv_search /
│                │   llm_screen / download_prep
└───────┬────────┘
        │ papers/
┌───────▼────────┐   PDF 解析 → 六类对象抽取 → 知识图谱      knowledge_graph/
│  W2 结构化+KG  │   phase_defs / incremental_extract / llm_wrap
└───────┬────────┘
        │ KG JSON + paper cards
┌───────▼────────┐   Gap 分析 → RQ 设计 → 证据矩阵冻结       rqs / evidence matrix
│  W3 RQ 与矩阵  │   phase_defs / matrix_boost
└───────┬────────┘
        │ 冻结矩阵 + RQ
┌───────▼────────┐   逐 RQ：自动选技能 → 工具循环 → HTML 报告  working memory
│  W4 逐题分析   │   run_v3_agent + kg_analysis（三层架构）
└───────┬────────┘
        │ 逐题结论 + 证据
┌───────▼────────┐   大纲装配 → 逐章撰写 → LaTeX 编译         main.pdf
│  W5 写作编译   │   phase_defs / llm_sections / compile_pdf
└───────┬────────┘
        │
  综述 PDF（每条 claim 可回溯：tools/build_paper_evidence_index.py）
```

每一步的产物落盘为结构化文件（JSON/PDF/HTML），下一步只读上一步的产物——**步与步之间通过文件契约解耦**，任何一步都可以单独重跑与核查。

## W1 语料构建：检索 → 筛选 → 下载

| 文件 | 作用 |
|---|---|
| `w1/phase_defs.py` | 19 个 Phase 的编排定义：每步调起哪个脚本、参数如何从项目配置渲染、产物清单是什么。流水线的"目录页"。 |
| `w1/runner.py` | 确定性状态机执行器：只做编排（调脚本、校验产物、落盘状态），不实现业务逻辑。checkpoint 断点重跑、失败定位到 Phase。 |
| `w1/arxiv_search.py` | arXiv API 检索：相关性优先排序 + 年份区间硬过滤，输出统一题录格式。 |
| `w1/llm_screen.py` | LLM 六阶段筛选收敛层：把模型的判断收敛为稳定的 decision/reason 列，避免自由文本不可解析。 |
| `w1/download_prep.py` | **DOI 锚定协议**：DOI 归一化、无 DOI 的 arXiv 记录注入官方 DOI、标题消毒（Windows 非法字符）、按 DOI 去重、无 DOI 记录分流到人工通道。保证下载不跑偏。 |

## W2 结构化与知识图谱

| 文件 | 作用 |
|---|---|
| `w2/phase_defs.py` | 四个 Phase：PDF 批量解析 → 六类对象（问题/方法/数据集/指标/局限/假设）LLM 抽取 → 候选筛选 → KG 构建。 |
| `w2/incremental_extract.py` | 增量抽取契约：新论文只跑自身，不重建全库。 |
| `w2/llm_wrap.py` | 统一 LLM 执行器（url + apikey + model）：所有存量脚本零改动接入用户的模型配置，密钥从加密库读取、不落盘。 |

## W3 研究问题与证据矩阵

| 文件 | 作用 |
|---|---|
| `w3/phase_defs.py` | Gap 分析 → RQ 设计 → 证据查询落地 → 可回答性核验 → 综述评审，五 Phase。 |
| `w3/matrix_boost.py` | 证据矩阵增强：两级递降匹配（长短语拆词匹配为主、结构钩子兜底），把 claim 与 KG 节点、论文证据对齐。 |

## W4 逐题分析：37 个分析策略 × LLM Agent

这是系统的核心分析引擎，采用三层架构（详细说明见 [`w4/kg_analysis/ARCHITECTURE.md`](w4/kg_analysis/ARCHITECTURE.md)）：

```
RQ 文本 ──► Layer 3  LLM Agent（自主选技能 → 工具循环 → HTML 报告）
                 │ 调用
                 ▼
            Layer 1  KG 原子工具（提取/逻辑/语义，直接读 KG JSON）
                 │ 被
                 ▼
            Layer 2  37 个分析策略规范（Markdown 声明式定义）
```

| 文件 | 作用 |
|---|---|
| `w4/run_v3_agent.py` | 项目级入口：对 W3 冻结的每个宏 RQ 跑一次 Agent 分析，断点续跑。 |
| `w4/kg_analysis/layer3_llm_agent/skill_loader.py` | 加载 37 个策略规范；RQ 到技能的自动选型（37 选 1 并给出理由）。 |
| `w4/kg_analysis/layer3_llm_agent/llm_skill_agent.py` | Agent 主循环：读策略 .md → 按规范调用工具 → 推理 → 产出答案；每次运行生成 6 文件工作记忆（工具调用、推理轨迹、最终答案、HTML 报告）。 |
| `w4/kg_analysis/layer3_llm_agent/tool_schemas.py` | 工具的 JSON Schema 定义：模型能调用什么、参数是什么、返回什么。 |
| `w4/kg_analysis/layer3_llm_agent/html_renderer.py` | 把分析结果渲染为带引用锚点的 HTML 报告。 |
| `w4/kg_analysis/layer1_kg_ops/` | KG 原子工具层：加载器、提取/逻辑/语义工具、调用追踪（每个结论可追溯到哪次工具调用看了哪些节点）。 |

**37 个策略本身**（problem space 18 + solution space 19）以 Markdown 规范形式开放在 [`../analysis-skills/`](../analysis-skills/)，含 `INDEX.json` 索引。Agent 的每次运行会在报告中说明"为什么选这个策略"。

## W5 写作与编译

| 文件 | 作用 |
|---|---|
| `w5/phase_defs.py` | W5 各 Phase：大纲装配 → 逐章撰写 → 质检 → 编译。 |
| `w5/llm_sections.py` | 逐章 LLM 撰写：每章喂入对应 RQ 的工作记忆（结论/维度/共识/缺口），引用强制 `\cite{}` 与 references.bib 对齐，未解析引用为零才通过。 |
| `w5/compile_pdf.py` | LaTeX 编译（tectonic），未安装编译器时优雅跳过不阻塞流水线。 |

## 证据定位：可溯源的实现基础

| 文件 | 作用 |
|---|---|
| `tools/build_paper_evidence_index.py` | 把 claim 的引文对齐到 PDF 页码坐标并截取高亮条带图——演示站上"点开一条结论看到原文高亮"背后的实现。 |

## 许可

- 本目录代码：Apache-2.0（见仓库根 [LICENSE](../../LICENSE)）。
- `tools/build_paper_evidence_index.py` 依赖 PyMuPDF（AGPL-3.0 或商业许可）。此处为**源码摘录、供阅读参考**，不构成基于 PyMuPDF 的网络服务分发；若据此对外提供服务，须遵循 AGPL 义务或购买商业许可，详见 [docs/THIRD_PARTY_RESOURCES.md](../../docs/THIRD_PARTY_RESOURCES.md) §5。
