#!/usr/bin/env python3
"""openalex_citations.py v2 — OpenAlex 引用图扩展（W1-P5 主力，无限流）。

用户裁决的三条检索策略之一："减少搜索次数，更多依赖引文图谱扩展"。
扩展走 /works?filter=cites:... 批量端点（非 search 集群，礼貌池下无限流痛点），
从筛过的核心集种子出发拉"引用了种子的高被引论文"（sort=cited_by_count）——
综述语料最想要的影响力论文。

元数据入全局 paper_cache（按 DOI/arXiv ID 键，跨项目共享，用户裁决"按 arXiv ID 缓存"）；
种子 DOI→OpenAlex ID 映射命中缓存时免 API。

用法（phase_defs 调起）：
  python openalex_citations.py \
      --seeds-from retrieval_workspace/screening/screened_records.csv \
      --top-seeds 40 --max-records 600 \
      --out-dir retrieval_workspace/snowball/ \
      --cache-db <全局 paper_cache.sqlite3>
产出：
  openalex_expansion.csv      扩展所得（FIELD_ORDER，P3 兼容）
  snowball_candidates.csv     screened + 扩展去重合并（P6 download_prep 的输入）
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paper_cache import PaperCache, key_for  # noqa: E402

API = "https://api.openalex.org"
FIELD_ORDER = ["title", "authors", "year", "doi", "abstract", "venue", "url", "source_db"]
MIN_INTERVAL = 0.3  # filter 端点礼貌间隔


def _curl_json(url: str, mailto: str, max_attempts: int = 4) -> dict:
    for attempt in range(max_attempts):
        proc = subprocess.run(
            ["curl", "-sS", "-g", "-L", "--max-time", "45", url,
             "-A", f"AutoSurvey/0.1 (mailto:{mailto})"], capture_output=True)
        if proc.returncode != 0:
            raise OSError(proc.stderr.decode("utf-8", errors="replace")[:200])
        try:
            data = json.loads(proc.stdout.decode("utf-8", errors="replace"))
        except json.JSONDecodeError as e:
            raise OSError(f"OpenAlex 返回非 JSON: {e}") from e
        if "error" in data and "rate limit" in str(data.get("error", "")).lower():
            wait = int(data.get("retryAfter", 20) or 20)
            print(f"[oa-cite] 临时限流，睡 {wait}s（第 {attempt + 1} 次）", flush=True)
            time.sleep(wait + 2)
            continue
        return data
    raise OSError("OpenAlex 连续限流")


def invert_abstract(idx: dict | None) -> str:
    if not idx:
        return ""
    pos = {p: w for w, ps in idx.items() for p in ps}
    return " ".join(pos[i] for i in sorted(pos))


def load_seed_dois(seeds_csv: Path, top: int) -> list[str]:
    """筛过的核心集 → 有 DOI 的前 N 条（评分列存在时按其排序）。"""
    rows = list(csv.DictReader(open(seeds_csv, encoding="utf-8-sig")))
    score_col = next((c for c in (rows[0].keys() if rows else [])
                      if "score" in c.lower()), None)
    if score_col:
        rows.sort(key=lambda r: float(r.get(score_col) or 0), reverse=True)
    dois = []
    for r in rows:
        doi = (r.get("doi") or "").strip().lower().replace("https://doi.org/", "")
        if doi and doi not in dois:
            dois.append(doi)
        if len(dois) >= top:
            break
    return dois


def _norm_doi(doi: str) -> str:
    """查询用 DOI：DataCite arXiv 前缀大小写敏感（10.48550/arXiv.，大写 X）且
    不带版本号（...v2 → 去掉）——管线 .lower() 与 arXiv 合成 DOI 的版本尾巴都会 404。"""
    d = doi.strip().lower().replace("https://doi.org/", "")
    m = re.match(r"10\.48550/arxiv\.(\d{4}\.\d{4,5})(v\d+)?$", d)
    if m:
        return f"10.48550/arXiv.{m.group(1)}"
    return d


def doi_to_wid(doi: str, cache: PaperCache, mailto: str) -> str:
    """DOI → OpenAlex Work ID（缓存命中免 API）。
    arXiv DOI 走 doi: 端点（/works/https://arxiv.org/abs magic 端点 2026 已废弃）。"""
    qdoi = _norm_doi(doi)
    ck = f"doi:{qdoi.lower()}"
    hit = cache.get(ck)
    if hit and hit.get("openalex_wid", "").startswith("W"):
        return hit["openalex_wid"]
    d = _curl_json(f"{API}/works/doi:{qdoi}?select=id&display_name", mailto, max_attempts=1)
    wid = (d.get("id") or "").rsplit("/", 1)[-1]
    payload = json.dumps({"doi": qdoi, "openalex_wid": wid}, ensure_ascii=False)
    cache.conn.execute(
        "INSERT OR IGNORE INTO papers (cache_key, source, title, doi, url, payload_json)"
        " VALUES (?,?,?,?,?,?)",
        (ck, "openalex_seed_map", d.get("display_name") or "", qdoi, d.get("id") or "",
         payload))
    cache.conn.commit()
    return wid


def to_record(w: dict) -> dict:
    loc = (w.get("primary_location") or {})
    return {
        "title": re.sub(r"\s+", " ", w.get("display_name") or "").strip(),
        "authors": "; ".join(a.get("author", {}).get("display_name", "")
                             for a in (w.get("authorships") or []) if a.get("author"))[:400],
        "year": w.get("publication_year") or "",
        "doi": (w.get("doi") or "").replace("https://doi.org/", ""),
        "abstract": invert_abstract(w.get("abstract_inverted_index")),
        "venue": ((loc.get("source") or {}).get("display_name") or "")[:200],
        "url": w.get("id") or "",
        "source_db": "openalex_citation",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="OpenAlex 引用图扩展 v2")
    ap.add_argument("--seeds-from", required=True, help="screened_records.csv（筛过的核心集）")
    ap.add_argument("--top-seeds", type=int, default=40, help="取前 N 个有 DOI 的种子")
    ap.add_argument("--max-records", type=int, default=600, help="扩展产出上限")
    ap.add_argument("--out-dir", required=True, help="输出目录（snowball/）")
    ap.add_argument("--cache-db", required=True, help="全局 paper_cache.sqlite3")
    ap.add_argument("--refs-per-seed", type=int, default=20, help="参考方向每种子取前 N 个引文")
    ap.add_argument("--mailto", default="858641291@qq.com")
    args = ap.parse_args()

    seeds_csv = Path(args.seeds_from)
    if not seeds_csv.exists():
        raise SystemExit(f"[oa-cite] 种子文件不存在: {seeds_csv}")
    cache = PaperCache(args.cache_db)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    dois = load_seed_dois(seeds_csv, args.top_seeds)
    print(f"[oa-cite] 种子 {len(dois)} 个 DOI（取自 {seeds_csv.name} 前 {args.top_seeds}）", flush=True)

    # DOI → WID（缓存优先）
    wids: list[str] = []
    for doi in dois:
        try:
            wids.append(doi_to_wid(doi, cache, args.mailto))
            time.sleep(MIN_INTERVAL)
        except Exception as e:
            print(f"[oa-cite] 种子失败 {doi}: {e}", flush=True)
    wids = [w for w in wids if w.startswith("W")]
    if not wids:
        raise SystemExit("[oa-cite] 无有效种子 WID")
    print(f"[oa-cite] 种子 WID {len(wids)} 个", flush=True)

    # 方向一（被引）：filter=cites: 批量——"引用了种子的新论文"（追前沿）
    expansion: dict[str, dict] = {}
    cursor = "*"
    batch_no = 0
    while len(expansion) < args.max_records:
        batch = wids[:50]
        q = urllib.parse.urlencode({
            "filter": "cites:" + "|".join(batch),
            "sort": "cited_by_count:desc",
            "per-page": 100, "cursor": cursor, "mailto": args.mailto,
        })
        data = _curl_json(f"{API}/works?{q}", args.mailto)
        batch_no += 1
        results = data.get("results", [])
        if not results:
            break
        for w in results:
            wid = (w.get("id") or "").rsplit("/", 1)[-1]
            if not wid or wid in expansion:
                continue
            expansion[wid] = to_record(w)
        print(f"[oa-cite] 被引方向 第 {batch_no} 页累计 {len(expansion)} 条", flush=True)
        cursor = (data.get("meta") or {}).get("next_cursor") or ""
        if not cursor or len(expansion) >= args.max_records:
            break
        time.sleep(MIN_INTERVAL)

    # 方向二（参考文献）：种子的 referenced_works——"种子所引的经典论文"（综述语料主体）。
    # 逐 ID 拉（filter 无 ids 批量端点）但先查全局缓存，命中免 API（按 ID 缓存的落点）。
    for wid in wids[: args.top_seeds]:
        if len(expansion) >= args.max_records:
            break
        try:
            d = _curl_json(f"{API}/works/{wid}?select=referenced_works", args.mailto)
        except OSError:
            continue
        for rid_full in (d.get("referenced_works") or [])[: args.refs_per_seed]:
            if len(expansion) >= args.max_records:
                break
            rid = rid_full.rsplit("/", 1)[-1]  # referenced_works 给全 URL，取裸 W id
            rkey = f"openalex:{rid}"
            hit = cache.get(rkey)
            if hit and hit.get("title"):
                expansion[rid] = {k: hit.get(k, "") for k in FIELD_ORDER}
                continue
            try:
                detail = _curl_json(f"{API}/works/{rid}?mailto={args.mailto}", args.mailto,
                                    max_attempts=1)
            except OSError:
                continue
            rec = to_record(detail)
            expansion[rid] = rec
            time.sleep(MIN_INTERVAL)
        print(f"[oa-cite] 参考方向 {wid} 后累计 {len(expansion)} 条", flush=True)

    records = list(expansion.values())[: args.max_records]

    # 全局缓存入库（跨项目共享；按 DOI/arXiv ID 键去重，命中只 +hits）
    new_n = cache.upsert_many(records)
    print(f"[oa-cite] 缓存入库：新增 {new_n} / {len(records)}（其余命中已有）", flush=True)

    # expansion CSV
    exp_csv = out_dir / "openalex_expansion.csv"
    with open(exp_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELD_ORDER, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)

    # snowball_candidates = screened 种子集 + 扩展（P6 download_prep 的输入）
    base_rows = list(csv.DictReader(open(seeds_csv, encoding="utf-8-sig")))
    seen_keys = {key_for(r) for r in base_rows if key_for(r)}
    merged = [r for r in base_rows]
    for r in records:
        k = key_for(r)
        if k and k in seen_keys:
            continue
        seen_keys.add(k)
        merged.append(r)
    cand_csv = out_dir / "snowball_candidates.csv"
    fieldnames = list(base_rows[0].keys()) if base_rows else FIELD_ORDER
    for extra in FIELD_ORDER:
        if extra not in fieldnames:
            fieldnames.append(extra)
    with open(cand_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(merged)

    print(f"[oa-cite] 完成：扩展 {len(records)} 条（{round(time.time() - t0, 1)}s）；"
          f"candidates = 核心 {len(base_rows)} + 扩展去重 {len(merged) - len(base_rows)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
