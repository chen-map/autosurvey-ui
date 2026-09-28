"""
skill_loader.py — 从 skills/ 目录读取 Skill .md 文件

解析 YAML front matter 和章节内容，
返回结构化的 SkillSpec 供 LLMSkillAgent 构建提示词。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class SkillSpec:
    """一个 Skill 的完整规范（从 .md 解析而来）。"""

    skill_id: str                     # e.g. "A1.1-a"
    name: str                         # front matter name 字段
    description: str                  # front matter description 字段
    argument_hints: list[str]         # front matter argument-hint 字段
    allowed_tools: list[str]          # front matter allowed-tools 字段（转义后）
    goal: str                         # ## Goal 章节
    inputs: str                       # ## Inputs 章节
    execution_steps: str              # ## Execution Steps 章节
    outputs: str                      # ## Outputs 章节
    key_rules: str                    # ## Key Rules 章节
    raw_md: str                       # 原始完整 Markdown 文本

    # 从 allowed-tools 解析出的 Layer 1 工具名（过滤掉文件操作类）
    _L1_TOOL_NAMES: frozenset = field(
        default_factory=lambda: frozenset({
            "get_entity_by_type", "get_entity_by_constraint",
            "get_relation", "get_head_entity", "get_tail_entity",
            "get_candidate_entity",
            "count", "intersect", "union", "judge", "end",
        }),
        repr=False, compare=False,
    )

    @property
    def l1_tools(self) -> list[str]:
        """Skill 明确声明使用的 Layer 1 工具名；若未限制则返回所有 L1 工具。"""
        declared = [t for t in self.allowed_tools if t in self._L1_TOOL_NAMES]
        return declared if declared else list(self._L1_TOOL_NAMES)

    def as_system_prompt(self) -> str:
        """
        将 Skill 规范序列化为 Claude 系统提示词。

        结构分为两层：
        - 数据获取层（固定）：说明 KG 结构和可用工具，让 LLM 自主决定需要什么数据
        - 分析框架层（来自 Skill）：元认知逻辑——目标、分析思维框架、关键约束
        """
        # 从 execution_steps 中提取分析逻辑（去掉引用不存在文件的"输入"说明）
        analysis_framework = self._extract_analysis_framework()

        return f"""你是一个知识图谱（KG）分析专家，负责执行 **{self.skill_id} · {self.name}**，对用户提出的研究问题（RQ）进行系统性学术分析。

---

## 第一部分：KG 数据层（你的信息来源）

你可以通过以下工具访问知识图谱。KG 中的数据结构如下：

**节点类型及字段**（所有节点共有字段：`node_id`, `node_type`, `canonical_name`, `description`, `origin_paper_id`）：
- `problem`：研究问题/挑战/威胁
- `method`：方法/技术/解决方案
- `paper`：论文
- `dataset`：数据集/基准
- `metric`：评估指标
- `limitation`：局限性
- `assumption`：假设/约束条件

**边类型**（所有边共有字段：`source_id`, `source_type`, `target_id`, `target_type`, `edge_type`, `confidence`, `evidence`）：
- `addresses`：Paper → Problem（论文解决某问题）
- `proposes`：Paper → Method（论文提出某方法）
- `extends`：Paper → Paper（论文扩展另一论文）
- `has_limitation`：Method/Paper → Limitation（方法存在局限性）
- `targets`：Method → Problem（方法针对某问题）
- `compares_with`：Paper → Paper（论文对比）
- `evaluated_on`：Method → Dataset（方法在数据集上评估）
- `measured_by`：Method → Metric（方法用指标衡量）
- `requires`：Method → Assumption（方法依赖某假设）
- `relaxes`：Method → Assumption（方法放宽某假设）
- `contradicts` / `supports`：Paper → Paper（论文间的矛盾/支持关系）

**可用工具**：
- `get_entity_by_type(entity_type)` — 获取某类型所有节点
- `get_entity_by_constraint(entities, field, op, value)` — 按字段条件过滤节点
- `get_relation(entity_id, direction)` — 获取某节点的一跳关系边
- `get_head_entity(edge_type, tail_id)` — 反向查询：谁 → 尾节点
- `get_tail_entity(edge_type, head_id)` — 正向查询：头节点 → 谁
- `get_candidate_entity(mention, entity_type, topk)` — 文本模糊匹配实体
- `count(entities)` — 计数
- `intersect(list_a, list_b, key)` / `union(list_a, list_b, key)` — 集合运算
- `judge(value, op, threshold)` — 条件判断
- `end(answer, metadata)` — 输出最终结果，**结束分析循环**
- `search_paper_sections(query, topk, paper_ids)` — **RAG 原文检索**：按 embedding 语义搜索 132 篇论文的段落原文，返回 `[{{paper_id, title, section_name, paragraph_text, score}}]`；当 KG 结构化字段不足时，用此工具获取细粒度原文证据

**数据获取原则**：
- 先用 `get_entity_by_type` 批量获取，再在内存中用 `get_entity_by_constraint` 过滤，不要对每个实体单独循环调用工具
- 工具调用总次数控制在 **15 次以内**
- 需要什么数据就调什么工具，不必拘泥于任何预设顺序

---

## 第二部分：分析框架（元认知指导）

这是本次分析的核心——你从 KG 中获取的数据，需要按照以下分析框架来理解和处理。

> **重要说明**：分析框架中若提到 `paper_cards/`、`working_memory/`、`.csv`、`.json` 等外部文件路径，这些文件在当前环境中**不可访问**。框架步骤中涉及这些资源的操作，**请用 Layer 1 工具从 KG 中获取等价信息来替代**。例如：
> - "从 Paper Cards 提取 X" → 用 `get_entity_by_type` + `get_entity_by_constraint` 从 KG 节点的 `description`/`evidence` 字段提取
> - "读取上游 Skill 输出文件" → 若用户在消息中提供了上游结果则参考，否则跳过
> - "从论文元数据获取年份" → 用 `get_entity_by_type("paper")` 后从 `description` 字段推断

### 分析目标
{self.goal}

### 分析思维框架
{analysis_framework}

### 输出结构要求
{self.outputs}

### 分析约束（必须遵守）
{self.key_rules}

---

## 执行规则

1. **数据先行**：先调用工具从 KG 中收集足够的原始数据，再套用分析框架进行推理。数据收集和分析推理是两个阶段，不要混淆。
2. **基于证据**：所有分析结论必须来自工具返回的真实数据，每个判断需引用 `node_id` 或 `edge` 作为来源，不得凭空推断。
3. **数据为空时如实报告**：若工具返回空列表，如实说明，不得用 LLM 先验知识填充。
4. **分析框架是思维指南，不是操作脚本**：框架中的"Steps"描述的是分析视角和推理逻辑，而不是对外部文件的操作指令。用工具获取的 KG 数据来完成这些分析视角。
5. **完成后调用 `end`**：分析完成后，将结构化结果传入 `end(answer=...)` 终止循环。
""".strip()

    def _extract_analysis_framework(self) -> str:
        """
        从 execution_steps 中提取分析逻辑框架。

        去掉步骤中对不存在文件（paper_cards/, working_memory/, .csv）的直接引用，
        保留核心分析思维逻辑，让 LLM 理解"该如何思考数据"而不是"该读哪个文件"。
        """
        import re
        steps = self.execution_steps

        # 把引用外部文件的短语替换为对 KG 数据的引用，让步骤更贴近实际可执行的逻辑
        replacements = [
            # paper_cards 路径引用
            (r"`paper_cards/[^`]*`", "`KG 节点 description/evidence 字段`"),
            (r"(?:从|读取|提取)[^\n，。]*?[Pp]aper\s*[Cc]ards?[^\n，。]*?(?:章节|字段|内容)",
             "从 KG 节点的 description 字段和边的 evidence 字段"),
            (r"回退到读取[^\n]*?[Pp]aper\s*[Cc]ards?[^\n]*",
             "回退到用 get_entity_by_constraint 按 description 字段过滤"),
            (r"Paper\s*Cards?[^\n]*?的[^\n]*?章节", "KG 节点的 description 和 evidence"),
            # 行内 "Paper Cards 中..." 的泛化替换
            (r"Paper\s*Cards?\s*中[^\n]*", "KG 节点的 description/evidence 字段中"),
            # working_memory 文件路径
            (r"`working_memory/[^`]*`", "（上游 Skill 输出，若用户已提供则参考）"),
            (r"(?:从|读取)[^\n]*?working_memory[^\n]*", "参考上游 Skill 输出（若已提供）"),
            # analyze_report 文件
            (r"`analyze_report/[^`]*`", "RQ 定义（见用户消息）"),
            # 裸 .json/.csv 文件路径（非 KG 路径）
            (r"`(?!KG)[^`]*\.(?:csv|json)`", "KG 数据"),
        ]

        result = steps
        for pattern, replacement in replacements:
            result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

        return result


# ---------------------------------------------------------------------------
# 解析逻辑
# ---------------------------------------------------------------------------

# 支持的章节标题 → SkillSpec 字段映射
_SECTION_MAP = {
    "Goal": "goal",
    "Inputs": "inputs",
    "Execution Steps": "execution_steps",
    "Outputs": "outputs",
    "Key Rules": "key_rules",
}


def _parse_front_matter(text: str) -> tuple[dict[str, Any], str]:
    """
    解析 YAML front matter（--- 包裹块）。
    返回 (meta_dict, body_text)。
    """
    fm_pattern = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
    m = fm_pattern.match(text)
    if not m:
        return {}, text

    body = text[m.end():]
    meta: dict[str, Any] = {}

    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            # 解析列表值 [a, b, c]
            if val.startswith("[") and val.endswith("]"):
                items = [s.strip().strip('"\'') for s in val[1:-1].split(",")]
                meta[key] = [i for i in items if i]
            else:
                meta[key] = val.strip('"\'')

    return meta, body


def _extract_sections(body: str) -> dict[str, str]:
    """
    从 Markdown body 中提取各 ## 章节的文本内容。
    只用 ## 级标题划定章节边界，### 及以下作为章节正文保留。
    """
    sections: dict[str, str] = {}
    # 只匹配 ## 级标题（两个 # 后跟空格，不多不少）
    header_re = re.compile(r"^## (.+)$", re.MULTILINE)
    matches = list(header_re.finditer(body))

    for i, m in enumerate(matches):
        title = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        content = body[start:end].strip()
        sections[title] = content

    return sections


def _skill_id_from_filename(filename: str) -> str:
    """从文件名提取 Skill ID，如 'A1.1-a_orthogonal_matrix_mapping.md' → 'A1.1-a'。"""
    stem = Path(filename).stem
    # 匹配 A1.1-a 或 B2.6-c 格式
    m = re.match(r"([AB]\d+\.\d+-[a-z])", stem)
    return m.group(1) if m else stem.split("_")[0]


def load_skill_from_file(md_path: str | Path) -> SkillSpec:
    """
    从 .md 文件加载并解析 Skill 规范。

    Args:
        md_path: .md 文件的绝对或相对路径

    Returns:
        SkillSpec 实例
    """
    md_path = Path(md_path)
    raw_md = md_path.read_text(encoding="utf-8")
    meta, body = _parse_front_matter(raw_md)
    sections = _extract_sections(body)

    skill_id = _skill_id_from_filename(md_path.name)

    # 解析 allowed-tools — 可能是列表或单个字符串
    allowed_raw = meta.get("allowed-tools", [])
    if isinstance(allowed_raw, str):
        allowed_raw = [allowed_raw]

    # 解析 argument-hint
    arg_hint_raw = meta.get("argument-hint", [])
    if isinstance(arg_hint_raw, str):
        arg_hint_raw = [arg_hint_raw]

    return SkillSpec(
        skill_id=skill_id,
        name=meta.get("name", skill_id),
        description=meta.get("description", ""),
        argument_hints=arg_hint_raw,
        allowed_tools=allowed_raw,
        goal=sections.get("Goal", ""),
        inputs=sections.get("Inputs", ""),
        execution_steps=sections.get("Execution Steps", ""),
        outputs=sections.get("Outputs", ""),
        key_rules=sections.get("Key Rules", ""),
        raw_md=raw_md,
    )


# ---------------------------------------------------------------------------
# SkillLoader — 扫描 skills/ 目录，按 Skill ID 索引
# ---------------------------------------------------------------------------

class SkillLoader:
    """
    扫描 skills/ 目录，将所有 .md 文件加载为 SkillSpec。

    Usage:
        loader = SkillLoader("/path/to/analysis/skills")
        spec = loader.get("A1.1-a")
        print(spec.as_system_prompt())
    """

    def __init__(self, skills_root: str | Path) -> None:
        self._root = Path(skills_root)
        self._cache: dict[str, SkillSpec] = {}
        self._scan()

    def _scan(self) -> None:
        """递归扫描 skills_root 下所有 .md 文件并建立索引。"""
        for md_path in sorted(self._root.rglob("*.md")):
            try:
                spec = load_skill_from_file(md_path)
                self._cache[spec.skill_id] = spec
            except Exception:
                # 跳过无法解析的文件（如 README）
                continue

    def get(self, skill_id: str) -> SkillSpec:
        """
        按 Skill ID 获取 SkillSpec。

        Raises:
            KeyError: 若 skill_id 未找到
        """
        if skill_id not in self._cache:
            raise KeyError(
                f"Skill {skill_id!r} not found. Available: {sorted(self._cache)}"
            )
        return self._cache[skill_id]

    def list_skill_ids(self) -> list[str]:
        """返回所有已加载的 Skill ID 列表（排序）。"""
        return sorted(self._cache.keys())

    def __len__(self) -> int:
        return len(self._cache)
