# kg_analysis 三层架构详解

> 项目路径：`analysis/kg_analysis/`  
> 总代码量：~5000 行  
> 目标：对论文知识图谱（KG）进行 RQ 级别的结构化分析，由 LLM 自主选 Skill 并执行，最终输出 HTML 小论文报告

---

## 整体架构一览

```
用户 RQ 文本
     │
     ▼
┌─────────────────────────────────────┐
│  LLM Agent 层                        │  ← Claude API 驱动，读 Skill .md 自主分析
│  llm_skill_agent.py                 │
│  skill_loader.py / tool_schemas.py  │
│  html_renderer.py                   │
└──────────────┬──────────────────────┘
               │ 调用 Layer 1 工具
┌─────────────────────────────────────┐
│  Layer 2: Skill 规范层               │  ← Markdown 声明式定义，37 个分析策略
│  problem_space/ (A1.x-x)            │
│  solution_space/ (B2.x-x)           │
└──────────────┬──────────────────────┘
               │ 加载 KG 数据
┌─────────────────────────────────────┐
│  Layer 1: KG 操作层                  │  ← 原子工具，直接读 KG JSON
│  kg_loader.py / tracing_loader.py   │
│  extract_tools.py / logic_tools.py  │
│  semantic_tools.py / tool_trace.py  │
└─────────────────────────────────────┘
               │
     KG JSON 文件（nodes/ + edges/）
```

**执行路径**：LLM 驱动 — `skill_id=None` 时 Claude 先分析 RQ，从 37 个 Skill 中自动选最优，再读 Skill .md 规范自主调用工具推理，输出 HTML 报告。

---

## Layer 1：KG 操作层

> 路径：`layer1_kg_ops/`  
> 职责：封装 KG JSON 文件的所有读取操作，提供原子工具函数

### 文件总览

| 文件 | 行数 | 职责 |
|------|------|------|
| `kg_loader.py` | 173 | KG 数据加载，带内存缓存 |
| `tracing_loader.py` | 199 | KGLoader 的追踪包装器 |
| `extract_tools.py` | 304 | 提取工具（6个函数） |
| `logic_tools.py` | 162 | 逻辑工具（5个函数） |
| `semantic_tools.py` | ~280 | 语义工具：边类型检索、实体消歧、**RAG 段落检索** |
| `tool_registry.py` | ~80 | 工具统一注册表 |
| `tool_trace.py` | 227 | 工具调用追踪装饰器 |

---

### kg_loader.py — KG 数据加载器

**核心类**：`KGLoader(kg_root: str)`

```python
loader = KGLoader("/path/to/knowledge_graph")
problems = loader.load_nodes("problem")   # → list[dict]
edges    = loader.load_edges("addresses") # → list[dict]
```

**设计要点**：

1. **懒加载 + 内存缓存**：首次 `load_nodes("problem")` 读磁盘，后续调用直接返回缓存，同一进程内 KG 只读一次。

2. **支持的节点类型**：
   ```
   problem / method / paper / dataset / metric / limitation / assumption
   ```
   对应文件：`nodes/problems.json`、`nodes/methods.json` 等

3. **支持的边类型**：
   ```
   addresses / proposes / extends / compares_with / evaluated_on /
   measured_by / has_limitation / requires / contradicts /
   supports / targets / relaxes
   ```

4. **节点通用字段**：`node_id`, `node_type`, `canonical_name`, `description`, `origin_paper_id`

5. **边通用字段**：`source_id`, `source_type`, `target_id`, `target_type`, `edge_type`, `confidence`, `evidence`

---

### tool_trace.py — 工具调用追踪

**三个核心组件**：

#### 1. `@traced_tool` 装饰器

给 Layer 1 所有工具函数加上，**零开销**（无 collector 时直接透传）：

```python
@traced_tool
def get_entity_by_type(loader, entity_type):
    return loader.load_nodes(entity_type)
```

内部逻辑：
```
调用时 → 检查 _active_collector ContextVar
  ├─ None → 直接调用原函数（零开销）
  └─ 有 collector → 记录 [工具名, 参数摘要, 返回值摘要, 耗时, 调用方位置]
```

#### 2. `collect_trace` 上下文管理器

```python
with collect_trace() as collector:
    skill.run(loader, rq_id, wm)

print(collector.render())   # 人类可读日志
print(collector.summary())  # {total_calls, calls_by_tool, total_elapsed_ms}
```

#### 3. `TraceCollector`

每条记录结构：
```json
{
  "seq": 1,
  "tool": "get_entity_by_type",
  "args_repr": {"entity_type": "problem"},
  "result_repr": "[{...}, ...] (645 items)",
  "result_count": 645,
  "elapsed_ms": 2.57,
  "caller": "a1_1_a.py:62 in run()"
}
```

**为什么用 `contextvars.ContextVar`**：线程/协程安全，同一进程中多个 Skill 并发执行时各自的 collector 不会串台。

---

### extract_tools.py — 提取工具

| 函数 | 用途 | 示例 |
|------|------|------|
| `get_entity_by_type(loader, type)` | 按类型加载所有实体 | 加载 645 个 Problem |
| `get_entity_by_constraint(entities, field, op, value)` | 字段过滤 | `confidence > 0.8` |
| `get_relation(loader, entity_id, direction)` | 查一跳关系边 | 查某实体的所有出边 |
| `get_head_entity(loader, edge_type, tail_id)` | 反向查头节点 | 谁 addresses 了这个 Problem |
| `get_tail_entity(loader, edge_type, head_id)` | 正向查尾节点 | 这个 Method 有哪些 Limitation |
| `get_candidate_entity(loader, mention, type, topk)` | 实体链接（文本→KG） | "prompt injection" → Top-5 候选 |
| `search_paper_sections(paper_cards_root, query, topk, paper_ids)` | **RAG 原文检索**（embedding 语义） | "prompt injection attack" → Top-K 段落片段 |

`get_entity_by_constraint` 支持 10 种运算符：
```
==  !=  >  <  >=  <=  in  not_in  contains  not_contains
```

`get_candidate_entity` 使用 **Jaccard Token 相似度** + **子串精确匹配加分**，无需 embedding。

---

### semantic_tools.py — 语义工具（含 RAG）

| 函数 | 用途 |
|------|------|
| `retrieve_relation(loader, query_text, topk)` | 语义检索最相关的 KG 边类型 |
| `disambiguate_entity(candidates, context_text)` | 候选实体消歧，返回最匹配的实体 |
| `search_paper_sections(paper_cards_root, query, topk, paper_ids)` | **RAG**：按段落粒度 embedding 检索论文原文 |

#### search_paper_sections — RAG 段落检索

**数据来源**：`paper_cards/parsed/` 下 132 个 JSON 文件，每个文件的 `sections` 字段已按标题预切分为章节。

**索引策略**：
- 将每个章节文本按 `\n\n` 切分为段落（过滤 < 80 字符的短片段）
- 用 `all-MiniLM-L6-v2` 对所有段落编码，结果缓存在模块级变量中
- 同一 `paper_cards_root` 只构建一次索引（进程内持久）

**查询接口**：
```python
results = search_paper_sections(
    paper_cards_root="/path/to/paper_cards/parsed",
    query="prompt injection attack against LLM agents",
    topk=5,
    paper_ids=["paper_001", "paper_042"],  # 可选，限定检索范围
)
# → [{"paper_id", "title", "section_name", "paragraph_text", "score"}, ...]
```

**典型用法**：先用 KG 工具定位相关论文的 `origin_paper_id`，再用 `search_paper_sections(paper_ids=[...])` 在这些论文内做深度原文检索，获取细粒度证据。

**局限性**：JSON 字段名（`paper_id`, `title`, `sections` 等）与当前 paper card 格式强绑定，不适用于其他格式的文献库。

---

### logic_tools.py — 逻辑工具

| 函数 | 用途 |
|------|------|
| `count(entities)` | 返回列表长度 |
| `intersect(list_a, list_b, key)` | 按 key 字段求交集 |
| `union(list_a, list_b, key)` | 按 key 字段求并集（去重） |
| `judge(value, op, threshold)` | 条件判断，返回 bool |
| `end(answer, metadata)` | 包装最终答案，标志推理链结束 |

`end()` 的标准输出格式：
```json
{
  "answer": <任意结构>,
  "metadata": {},
  "_done": true
}
```

---

### tracing_loader.py — 追踪包装器

`TracingKGLoader(base_loader: KGLoader)` 包装 KGLoader，拦截所有 `load_nodes` / `load_edges` 调用，记录：

```json
{
  "op": "load_nodes",
  "arg": "problem",
  "result_count": 645,
  "hit_cache": false,
  "elapsed_ms": 2.1,
  "caller": "a1_6_b.py:62 in run()"
}
```

与 `tool_trace.py` 的区别：
- `tracing_loader.py`：只追踪 KGLoader 的磁盘/缓存操作（KG 数据读取层）
- `tool_trace.py`：追踪所有 Layer 1 工具函数调用（包括 extract/logic 工具的业务逻辑层）

两者都被保留，`run_analysis_with_trace()` 用前者，`run_analysis(save_trace=True)` 用后者。

---

## Layer 2：Skill 执行层

> 路径：`layer2_skill_executor/`  
> 职责：将 Skill 分析逻辑实现为可执行 Python 类，每个 Skill 对应一个独立文件

### 文件总览

| 文件 | 职责 |
|------|------|
| `base_skill.py` | Skill 抽象基类 |
| `skill_registry.py` | Skill 注册与查找 |
| `problem_space/a1_1_a_*.py` | A1.1-a 正交矩阵映射 |
| `problem_space/a1_6_b_*.py` | A1.6-b 解法次生问题漂移 |
| `solution_space/b2_1_a_*.py` | B2.1-a 范式抽象聚类 |
| `solution_space/b2_6_c_*.py` | B2.6-c 解法反馈回路识别 |

---

### base_skill.py — Skill 基类

所有 Skill 必须继承此类：

```python
class BaseSkill(ABC):
    skill_id: str           # e.g. "A1.1-a"
    skill_name: str         # 人类可读名称
    rq_types: list[str]     # 能回答的 RQ 类型
    upstream_skills: list[str]  # 依赖的上游 Skill ID

    @abstractmethod
    def run(self, loader, rq_id, working_memory) -> dict:
        """核心分析逻辑，返回结构化结果"""
        ...

    def execute(self, loader, rq_id, working_memory, output_dir) -> dict:
        """完整执行流程：依赖检查 → run() → 保存结果 → 写入 working_memory"""
        ...
```

**`execute()` 执行流程**：
```
1. check_upstream()   检查所有 upstream_skills 是否已在 working_memory 中
2. run()              执行核心分析（子类实现）
3. save()             将结果写入 output_dir（可选）
4. 将结果存入 working_memory[self.skill_id]
5. 返回结果 dict
```

**`working_memory`** 是跨 Skill 的数据共享字典，上游 Skill 的输出放进去，下游 Skill 从里面读。

---

### skill_registry.py — Skill 注册表

```python
# 注册（在每个 Skill 文件底部）
from ..skill_registry import register_skill
register_skill(A1_1_a_OrthogonalMatrixMapping)

# 查找
cls = get_skill("A1.1-a")        # 按 ID 查找
sids = list_skills_by_rq("有什么？")  # 按 RQ 类型查找
all_ids = list_all_skills()       # 列出全部
```

注册表在 `load_all_skills()` 时通过 `importlib` 动态导入所有 Skill 模块，无需手动维护 import 列表。

---

### 已实现的 4 个 Skill

#### A1.1-a 正交矩阵映射（Problem Space）

**输入**：problem 节点、paper 节点  
**逻辑**：提取两个正交属性维度，构建 2D 分布矩阵，统计各象限密度，识别热点/冷区  
**输出**：
```json
{
  "dimension_A": {"name": "攻击阶段", "values": ["planning","execution","post"]},
  "dimension_B": {"name": "攻击目标", "values": ["agent","tool","memory"]},
  "matrix": { "planning×agent": {"count": 12, "density_rank": "hot"} },
  "hot_zones": [...],
  "cold_zones": [...]
}
```

#### A1.6-b 解法次生问题漂移（Problem Space）

**输入**：method 节点、has_limitation 边、limitation 节点、problem 节点  
**逻辑**：
1. 扫描 22 个次生问题语义信号（如 `introduce`, `vulnerability`, `side effect`）
2. 对命中的 Limitation 查找关联 Problem（先查 KG 直接边，再降级到文本相似度）
3. 评估 severity（high/medium/low）

**输出**：`problem_shift_chains`（17条链）、`shift_rate`、`high_severity_chains`

#### B2.1-a 范式抽象聚类（Solution Space）

**输入**：method 节点  
**逻辑**：扫描 9 个范式关键词字典（防御、检测、推理、对齐等），将 Method 聚类到 3-7 个元范式  
**输出**：`paradigms`（各范式及其 Method 列表）

#### B2.6-c 解法反馈回路识别（Solution Space）

**输入**：来自 `working_memory["A1.6-b"]` 的次生问题链  
**逻辑**：对每条 `方法D → 限制L → 次生问题P'` 链，查是否存在 `方法D'` 也 addresses P'，构建 `D → P' → D'` 反馈回路  
**防幻觉约束**：若 P' 是文本推断（无 KG 直接边），则不构造回路，返回空列表  
**依赖**：`upstream_skills = ["A1.6-b"]`

---

## LLM Agent 层

> 路径：`layer3_llm_agent/`  
> 职责：Claude API 驱动，读 Skill .md 规范自主执行分析，输出 HTML 报告

### 文件总览

| 文件 | 行数 | 职责 |
|------|------|------|
| `skill_loader.py` | ~340 | 解析 .md 文件，生成系统提示词 |
| `tool_schemas.py` | ~330 | Layer 1 工具的 Claude tool_use JSON Schema（12 个） |
| `llm_skill_agent.py` | ~730 | LLM 执行 Agent 主类，含 working memory 写入 |
| `html_renderer.py` | 416 | HTML 小论文渲染器 |

---

### skill_loader.py — Skill .md 解析器

解析 `skills/` 目录下的 `.md` 文件，提取：

```python
@dataclass
class SkillSpec:
    skill_id: str          # "A1.1-a"
    name: str              # YAML front matter name
    description: str       # YAML front matter description
    goal: str              # ## Goal 章节
    inputs: str            # ## Inputs 章节
    execution_steps: str   # ## Execution Steps 章节
    outputs: str           # ## Outputs 章节
    key_rules: str         # ## Key Rules 章节
```

`spec.as_system_prompt()` 将所有内容序列化为 Claude 的系统提示词，包含目标、执行步骤、输出格式、约束规则，以及强制性的执行规则：
- 工具调用总次数 ≤ 15 次
- 优先批量查询，不对每个实体循环调用
- 数据为空时如实说明，不推断填充

---

### tool_schemas.py — 工具 JSON Schema

将 12 个 Layer 1 工具函数转为 Claude API `tools` 参数格式（11 个 KG 工具 + 1 个 RAG 工具）：

```python
ALL_TOOL_SCHEMAS = [
    {
        "name": "get_entity_by_type",
        "description": "从 KG 中按节点类型加载所有实体...",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "enum": ["problem","method","paper","dataset","metric","limitation","assumption"]
                }
            },
            "required": ["entity_type"]
        }
    },
    # ... 其余 11 个工具（含 search_paper_sections RAG 工具）
]
```

---

### llm_skill_agent.py — LLM 执行 Agent

**核心执行流程**：

```
① 加载 Skill .md → as_system_prompt()
② 构建工具分发表（注入 KGLoader + paper_cards_root 上下文）
③ 发送初始消息（RQ 文本 + 执行指令）
④ Tool use 对话循环（最多 30 轮）：
   ├─ Claude 返回 tool_use → 执行工具 → 截断大结果 → 送回结果
   ├─ 每轮收集：reasoning_trace（LLM 文本块）、tool_call_log（含完整 raw_result）
   ├─ 轮数 ≥ 12 时插入催促消息（"请立即调用 end 工具"）
   └─ Claude 调用 end() → 触发 HTML 生成请求 → 退出循环
⑤ 请求 Claude 输出 HTML sections JSON 数组
⑥ html_renderer 渲染为完整 HTML
⑦ 写 working memory 目录（6 个文件）
⑧ 输出：{working_memory_dir, tool_calls, final_answer, ...}
```

**工具分发表**（注入 loader 和 paper_cards_root 上下文）：
```python
dispatcher = {
    "get_entity_by_type": lambda entity_type: get_entity_by_type(loader, entity_type),
    "get_head_entity":    lambda edge_type, tail_id, **kw: get_head_entity(loader, edge_type, tail_id, **kw),
    # ...（其余 9 个 KG 工具）
    # RAG 工具（仅当 paper_cards_root 不为 None 时注册）
    "search_paper_sections": lambda query, topk=5, paper_ids=None: search_paper_sections(paper_cards_root, query, topk, paper_ids),
}
```

**大结果截断**（防 token 超限）：
```python
# 列表超过 30 条时截断
{
  "_truncated": true,
  "_total_count": 645,
  "_showing": 30,
  "items": [...]
}
```

**输出目录结构**（每次 `run_skill()` 创建独立子目录，带时间戳，不覆盖历史）：
```
outputs/
└── working_memory/
    └── {rq_id}_{skill_id}_{timestamp}/
        ├── 00_meta.json            — 元信息：RQ、Skill、模型、时间、工具统计
        ├── 01_tool_calls.json      — 工具调用流水（含完整 raw_result，列表超 200 条截断）
        ├── 02_reasoning_trace.json — LLM 推理文本流（每轮 text 块）
        ├── 03_final_answer.json    — end() 的 answer 结构化结果
        ├── 04_html_sections.json   — HTML render 前的 sections JSON 数组
        └── 05_report.html          — 最终 HTML 报告
```

**`run_skill()` 返回值**：
```python
{
    "skill_id": str,
    "skill_selection": dict | None,
    "rq_id": str,
    "html": str,
    "working_memory_dir": str | None,  # working memory 目录绝对路径
    "tool_calls": [...],               # 工具调用记录（含 raw_result）
    "final_answer": Any,
    "total_time_sec": float,
    "total_tool_rounds": int,
}
```

---

### html_renderer.py — HTML 渲染器

`HTMLReport` 构建器支持逐步追加内容块：

```python
report = HTMLReport("报告标题", rq_id="RQ-002")
report.add_section("摘要", "<p>...</p>")
report.add_table("数据统计", headers=["类型","数量"], rows=[["problem","645"]])
report.add_bar_chart("分布图", categories=["A","B"], series_name="数量", values=[10,5])
report.add_pie_chart("占比", data=[{"name":"A","value":10}])
report.add_note("注：数据来自 KG")
html = report.build()
```

`render_from_llm_output(sections)` 接收 LLM 返回的 JSON 数组直接渲染：

```json
[
  {"type": "section",   "heading": "摘要",    "content": "..."},
  {"type": "table",     "heading": "统计表",  "headers": [...], "rows": [...]},
  {"type": "bar_chart", "heading": "分布图",  "categories": [...], "values": [...]},
  {"type": "pie_chart", "heading": "占比图",  "data": [...]},
  {"type": "note",                            "content": "注意：..."},
  {"type": "section",   "heading": "结论",    "content": "..."}
]
```

生成的 HTML 特性：
- 单文件（内联 ECharts CDN），无外部依赖
- 自动生成目录（TOC）
- 响应式宽度，最大 900px
- 衬线字体，学术风格排版

---

## 层间数据流

```
Layer 4 路径（LLM 驱动）：
  RQ 文本
    → LLMSkillAgent.run_skill(skill_id, rq_text)
      → skill_loader.get(skill_id) → 系统提示词
      → Claude API tool_use 循环
        → get_entity_by_type("problem") → [645 个 Problem]  ← raw_result 完整保存
        → get_entity_by_constraint(...) → 过滤子集          ← reasoning_trace 逐轮收集
        → get_head_entity("addresses", tail_id) → 相关方法
        → search_paper_sections("...") → 原文段落          ← RAG 工具
        → end(answer={...})
      → 请求生成 HTML sections JSON
      → html_renderer 渲染
    → 写 working_memory/{rq_id}_{skill_id}_{ts}/ 目录（6 个文件）

Layer 3 路径（规则驱动）：
  RQ 文本
    → RQClassifier.classify() → ["有什么？", "副作用？"]
    → SkillSelector.select() → ["A1.6-b", "B2.1-a", "B2.6-c"]
    → SkillSelector.resolve_dependencies() + 拓扑排序
    → [A1.6-b, B2.1-a, B2.6-c]（有序）
    → KGAnalysisAgent 逐步执行：
        A1.6-b.execute(loader, rq_id, working_memory={})
          → working_memory["A1.6-b"] = {problem_shift_chains: [...]}
        B2.1-a.execute(loader, rq_id, working_memory)
          → working_memory["B2.1-a"] = {paradigms: [...]}
        B2.6-c.execute(loader, rq_id, working_memory)
          → 读 working_memory["A1.6-b"]
          → working_memory["B2.6-c"] = {feedback_loops: []}
    → 汇总 skill_outputs + execution_log
    → 可选写 full_report.json + trace.json
```

---

## 扩展指南

### 新增一个 Skill（Layer 2 路径）

1. 在 `layer2_skill_executor/problem_space/` 或 `solution_space/` 下新建 `a1_x_x_name.py`
2. 继承 `BaseSkill`，实现 `run()`，设置 `skill_id`、`rq_types`、`upstream_skills`
3. 文件末尾调用 `register_skill(YourSkillClass)`
4. 在 `skill_registry.py` 的 `_SKILL_MODULES` 列表中加入模块路径

### 新增一个 Skill（Layer 4 路径）

只需在 `skills/` 目录下写 `.md` 文件，`SkillLoader` 会自动扫描加载，无需改任何 Python 代码。

### 新增一个 KG 工具

1. 在 `extract_tools.py` 或 `logic_tools.py` 中加函数，加 `@traced_tool` 装饰器
2. 在 `tool_schemas.py` 的 `ALL_TOOL_SCHEMAS` 中加对应 JSON Schema
3. 在 `llm_skill_agent.py` 的 `_build_tool_dispatcher()` 中加分发条目
