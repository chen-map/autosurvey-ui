"""
semantic_tools.py — 语义工具（Semantic Tools）

基于 sentence-transformers 提供语义级别的关系检索与实体消歧。

工具列表：
    retrieve_relation      — 按语义检索最相关的 KG 边类型
    disambiguate_entity    — 按上下文对候选实体排序消歧
    search_paper_sections  — RAG：按段落粒度语义搜索 paper card 原文片段

依赖：
    pip install sentence-transformers
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import numpy as np

from .kg_loader import KGLoader

# 延迟导入，避免未安装时整个 layer1 无法 import
_model = None
_MODEL_NAME = "all-MiniLM-L6-v2"


def _get_model():
    """懒加载 sentence-transformers 模型（首次调用时初始化）。"""
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(_MODEL_NAME)
        except ImportError as e:
            raise ImportError(
                "semantic_tools 需要安装 sentence-transformers：\n"
                "    pip install sentence-transformers"
            ) from e
    return _model


def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    """计算两个向量的余弦相似度。"""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ---------------------------------------------------------------------------
# retrieve_relation
# ---------------------------------------------------------------------------

def retrieve_relation(
    loader: KGLoader,
    query_text: str,
    topk: int = 3,
) -> list[str]:
    """
    基于语义相似度，从 KG 所有可用边类型中检索与 query_text 最相关的边类型名称。

    使用场景：当 Skill 不确定应该查哪种边关系时，用自然语言描述目标，
              由此工具给出候选边类型。

    Args:
        loader:     KGLoader 实例（用于获取所有可用边类型）
        query_text: 描述目标关系的自然语言文本
                    例如："method addresses which problem"
        topk:       返回 Top-K 个候选边类型（默认 3）
    Returns:
        边类型名称列表，按相关度从高到低排序
        例如：["addresses", "targets", "proposes"]

    Example:
        edge_types = retrieve_relation(loader, "method solves problem", topk=3)
        # → ["addresses", "targets", "proposes"]
    """
    available = loader.available_edge_types()
    if not available:
        return []

    model = _get_model()

    # 将边类型名称转为自然语言描述（下划线→空格）以提升语义匹配
    edge_descriptions = [et.replace("_", " ") for et in available]
    edge_embeddings = model.encode(edge_descriptions, convert_to_numpy=True)
    query_embedding = model.encode([query_text], convert_to_numpy=True)[0]

    scored = [
        (_cosine_sim(query_embedding, emb), edge_type)
        for emb, edge_type in zip(edge_embeddings, available)
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [et for _, et in scored[:topk]]


# ---------------------------------------------------------------------------
# disambiguate_entity
# ---------------------------------------------------------------------------

def disambiguate_entity(
    candidates: list[dict[str, Any]],
    context_text: str,
) -> dict[str, Any] | None:
    """
    基于上下文语义，从候选实体列表中选择最匹配的实体（消歧）。

    使用场景：get_candidate_entity 返回多个候选时，结合上下文文本
              判断最合适的实体，避免实体歧义。

    Args:
        candidates:   候选实体 dict 列表（来自 get_candidate_entity）
        context_text: 包含实体的上下文文本（如 RQ 句子或 paper 摘要片段）
    Returns:
        最匹配的实体 dict（附加 _disambig_score 字段），
        若 candidates 为空则返回 None

    Example:
        candidates = get_candidate_entity(loader, "relay attack", "problem")
        best = disambiguate_entity(candidates, "NFC payment relay attack in mobile systems")
        # best["canonical_name"] → "NFC Relay Attack"
    """
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    model = _get_model()

    # 用 canonical_name + description 联合编码候选实体
    entity_texts = [
        f"{c.get('canonical_name', '')}. {c.get('description', '')}"
        for c in candidates
    ]
    entity_embeddings = model.encode(entity_texts, convert_to_numpy=True)
    context_embedding = model.encode([context_text], convert_to_numpy=True)[0]

    best_score = -1.0
    best_entity: dict[str, Any] = candidates[0]
    for entity, emb in zip(candidates, entity_embeddings):
        score = _cosine_sim(context_embedding, emb)
        if score > best_score:
            best_score = score
            best_entity = entity

    result = dict(best_entity)
    result["_disambig_score"] = round(best_score, 4)
    return result


# ---------------------------------------------------------------------------
# search_paper_sections — RAG 段落级语义检索
# ---------------------------------------------------------------------------

# 全局段落索引缓存：{paper_cards_root: (paragraphs_meta, embeddings_matrix)}
_paragraph_index: dict[str, tuple[list[dict], np.ndarray]] = {}


def _split_paragraphs(text: str, min_chars: int = 80) -> list[str]:
    """
    将章节文本按段落切分（双换行为边界），过滤掉太短的片段。
    """
    raw = re.split(r"\n\s*\n", text.strip())
    return [p.strip() for p in raw if len(p.strip()) >= min_chars]


def _build_paragraph_index(paper_cards_root: str | Path) -> tuple[list[dict], np.ndarray]:
    """
    扫描 paper_cards_root 下所有 JSON 文件，按段落粒度建立 embedding 索引。
    结果缓存在模块级 _paragraph_index 中，同一根目录只构建一次。

    返回 (meta_list, embeddings)：
        meta_list:  每个段落对应的元数据 dict
        embeddings: shape (N, dim) 的 numpy 矩阵
    """
    root = str(Path(paper_cards_root).resolve())
    if root in _paragraph_index:
        return _paragraph_index[root]

    model = _get_model()
    meta_list: list[dict] = []
    texts: list[str] = []

    for json_path in sorted(Path(paper_cards_root).glob("*.json")):
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        paper_id = data.get("paper_id", json_path.stem)
        title = data.get("title", "")
        sections: dict[str, str] = data.get("sections", {})

        # 若 sections 为空，回退到 abstract + paper_text
        if not sections:
            fallback_text = data.get("abstract", "") + "\n\n" + data.get("paper_text", "")
            sections = {"full_text": fallback_text}

        for section_name, section_text in sections.items():
            for para in _split_paragraphs(section_text):
                meta_list.append({
                    "paper_id": paper_id,
                    "title": title,
                    "section_name": section_name,
                    "paragraph_text": para,
                })
                texts.append(para)

    if not texts:
        _paragraph_index[root] = ([], np.empty((0, 384)))
        return _paragraph_index[root]

    embeddings = model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    _paragraph_index[root] = (meta_list, embeddings)
    return _paragraph_index[root]


def search_paper_sections(
    paper_cards_root: str | Path,
    query: str,
    topk: int = 5,
    paper_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    基于 embedding 语义检索，从 paper card 原文中检索与 query 最相关的段落片段。

    使用场景：当 KG 结构化数据不足以支撑深度分析时，用此工具检索论文原文的
              具体论述段落，获取更细粒度的证据文本。

    Args:
        paper_cards_root: paper_cards/parsed/ 目录路径
        query:            检索查询文本（自然语言，支持中英文）
        topk:             返回 Top-K 个最相关段落（默认 5）
        paper_ids:        若指定，只在这些论文中检索（可选过滤）

    Returns:
        list of dict，按相关度从高到低排序，每条记录：
        {
            "paper_id":       str,   # 论文 ID
            "title":          str,   # 论文标题
            "section_name":   str,   # 来源章节名
            "paragraph_text": str,   # 段落原文
            "score":          float  # 余弦相似度 [0, 1]
        }

    Example:
        results = search_paper_sections(
            paper_cards_root="/path/to/paper_cards/parsed",
            query="prompt injection attack against LLM agents",
            topk=5,
        )
    """
    meta_list, embeddings = _build_paragraph_index(paper_cards_root)
    if not meta_list:
        return []

    model = _get_model()
    query_emb = model.encode([query], convert_to_numpy=True)[0]

    # 若指定 paper_ids，构建过滤掩码
    if paper_ids:
        pid_set = set(paper_ids)
        mask = np.array([m["paper_id"] in pid_set for m in meta_list])
        if not mask.any():
            return []
        indices = np.where(mask)[0]
        sub_embeddings = embeddings[indices]
        sub_meta = [meta_list[i] for i in indices]
    else:
        sub_embeddings = embeddings
        sub_meta = meta_list
        indices = np.arange(len(meta_list))

    # 批量计算余弦相似度
    norms = np.linalg.norm(sub_embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1e-9, norms)
    normed = sub_embeddings / norms
    query_norm = query_emb / (np.linalg.norm(query_emb) + 1e-9)
    scores = normed @ query_norm  # shape (N,)

    top_indices = np.argsort(scores)[::-1][:topk]
    results = []
    for idx in top_indices:
        entry = dict(sub_meta[idx])
        entry["score"] = round(float(scores[idx]), 4)
        results.append(entry)

    return results
