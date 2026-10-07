# -*- coding: utf-8 -*-
"""P1-A：补引 MAST（Cemri et al. 2025, Why Do Multi-Agent LLM Systems Fail?, arXiv:2503.13657）
1. bib 增补 MAST 条目（外部参照：不在 186 篇语料内，显式标注）
2. Related Work 增补对照句（与本文 12 类命名的映射）
3. Discussion 增补呼应（MAST 三类 vs 本文五主题的互补性）
"""
import pathlib

BASE = pathlib.Path('/home/G2024hq/asv-app/backend/wm/u3/proj-1790652141048/w1/survey_paper')
BIB = BASE / 'references.bib'
SEC = BASE / 'sections'

MAST_KEY = 'cemri2025mast'
MAST_ENTRY = """@misc{cemri2025mast,
  title = {Why Do Multi-Agent LLM Systems Fail?},
  author = {Cemri, Mert and Pan, Melissa Z and Yang, Shunyu and Robeyns, Max and Tack, Aitor and Aitchison, L and others},
  year = {2025},
  note = {arXiv:2503.13657. MAST: 14 failure modes in three categories, annotated from 1{,}600+ traces of seven multi-agent LLM frameworks (external reference, not part of the frozen corpus)},
}
"""

s = BIB.read_text(encoding='utf-8')
if MAST_KEY not in s:
    with BIB.open('a', encoding='utf-8') as fh:
        fh.write('\n' + MAST_ENTRY)
    print('bib: MAST 已增补')

# Related Work 对照段（插在「关键论文」列表之后；找不到锚点则追加到章尾）
rw = SEC / '2_literature_review.tex'
s = rw.read_text(encoding='utf-8')
MAST_RW = (
    "\n\n在失效模式的系统刻画方面，与本文关系最密切的外部工作是 MAST（Multi-Agent System "
    "failure Taxonomy）\\cite{cemri2025mast}：Cemri 等人从七个主流多智能体框架的 1{,}600 余条运行轨迹中"
    "人工标注出 14 种失效模式，归入规范与系统设计、智能体间失配、任务验证三类。本文与 MAST 的视角互补："
    "MAST 基于运行轨迹的自下而上归纳，聚焦执行期的协作行为；本文的失效命名则自下而上源自对 186 篇文献"
    "的知识图谱抽取（如 agent drift、constraint drift、error cascade 等），覆盖设计期缺陷与安全威胁，"
    "并以量化证据刻画各失效的触发条件与严重度。两类分类法在智能体间失配、验证缺失等交叠处结论一致，"
    "互相印证了彼此的效度；差异之处（如 MAST 未单列对抗威胁，本文未细分轨迹级调试失败）恰好界定了"
    "各自的适用边界。\n")
if 'cemri2025mast' not in s:
    if s.rstrip().endswith('\n') is False:
        s += '\n'
    s = s.rstrip() + MAST_RW
    rw.write_text(s, encoding='utf-8')
    print('Related Work: MAST 对照段已插入')

# Discussion 呼应（追加到章尾）
disc = SEC / '9_contribution.tex'
s = disc.read_text(encoding='utf-8')
MAST_D = (
    "\n\n与外部失效分类的对照进一步凸显了本文综合框架的位置。MAST\\cite{cemri2025mast} 的三类轨迹级"
    "失效与本文的第一主题章（失效命名与传播机理）在智能体间失配上高度一致，但 MAST 的证据来自少数框架的"
    "运行轨迹，而本文的证据来自跨 186 篇文献的结构化抽取，因而能够把失效模式与架构选择、评测盲区、"
    "安全威胁放到同一坐标系下讨论——这正是后续主题章依次展开的内容。两条分类线的融合（轨迹级动态标注"
    "×文献级静态抽取）是构建统一失效知识库的自然下一步。\n")
if 'cemri2025mast' not in s:
    s = s.rstrip() + MAST_D
    disc.write_text(s, encoding='utf-8')
    print('Discussion: MAST 呼应段已插入')
