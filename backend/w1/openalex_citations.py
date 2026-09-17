"""openalex_citations.py — OpenAlex 引用图扩展（替代 S2 滚雪球，免费无 Key 无限流）。

用法：
    python openalex_citations.py \
        --seed-dois "10.1038/x,10.1145/y" \
        --output snowball/openalex_citations.json \
        [--depth 1] [--max-per-seed 50]

原理：
    OpenAlex 每篇 Work 有 referenced_works（参考文献）和 cited_by_api_url（被引）。
    从种子 DOI 出发，查 OpenAlex 拿到 OpenAlex ID → 再查引用/被引 → 递归扩展。
    全程免费，无限流痛点（10 万次/天配额）。
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

API = "https://api.openalex.org"


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "AutoSurvey/0.1 (mailto:autosurvey@example.com)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenAlex 引用图扩展")
    parser.add_argument("--seed-dois", required=True, help="逗号分隔的种子 DOI")
    parser.add_argument("--output", required=True, help="输出 JSON 路径")
    parser.add_argument("--depth", type=int, default=1, help="扩展深度（1=仅直接引用/被引）")
    args = parser.parse_args()

    seed_dois = [d.strip() for d in args.seed_dois.split(",") if d.strip()]
    all_papers: dict[str, dict] = {}

    # 1) DOI → OpenAlex ID 映射
    for doi in seed_dois:
        try:
            d = _get(f"{API}/works/doi:{doi}")
            all_papers[d["id"]] = d
            print(f"  ✓ {doi} → {d['id']} ({d.get('title', '')[:50]})")
        except Exception as e:
            print(f"  ✗ {doi}: {e}")

    # 2) 逐层扩展引用图
    frontier = list(all_papers.keys())
    for depth in range(args.depth):
        next_frontier = []
        for wid in frontier:
            try:
                # 被引（这个 Work 引用了谁）
                d = _get(f"{API}/works/{wid}?select=referenced_works,cited_by_count")
                refs = d.get("referenced_works", [])
                for ref_id in refs:
                    if ref_id not in all_papers:
                        full_id = ref_id.replace("https://openalex.org/", "")
                        try:
                            detail = _get(f"{API}/works/{full_id}")
                            all_papers[full_id] = detail
                            next_frontier.append(full_id)
                        except Exception:
                            pass
            except Exception as e:
                print(f"  ⚠ 扩展失败 {wid}: {e}")

            # 限速礼貌：每 10 个请求 sleep 0.5s
            if len(all_papers) % 10 == 0:
                import time
                time.sleep(0.5)

        frontier = next_frontier
        print(f"  depth {depth + 1}: 累计 {len(all_papers)} 篇")

    # 输出
    out = {
        "total": len(all_papers),
        "seed_dois": seed_dois,
        "depth": args.depth,
        "papers": [{"id": k, **v} for k, v in all_papers.items()],
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {args.output}（{len(all_papers)} 篇）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
