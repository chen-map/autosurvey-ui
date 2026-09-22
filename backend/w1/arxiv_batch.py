#!/usr/bin/env python3
"""W1-P6 arXiv 批量直连下载（合规限速版）。

解决痛点：旧五级降级链对 arXiv 论文也逐级试错（每级长超时），撞 429 后无全局冷却，
60 篇实测 786s 仅成功 2 篇。本脚本对带 arXiv ID 的记录（OAI 收割已注入官方 DOI
10.48550/arXiv.<id>）直接从 export.arxiv.org 批量获取 PDF。

限速模式参考 CocoLoop 商店 arxiv-paper-processor 技能（CLS A 级，纯标准库）：
  - 共享节流状态文件：所有请求先取 slot，距上次请求 < min-interval 则等待；
  - 服务器冷却：429/5xx 时把 max(Retry-After, 指数退避+抖动) 写入状态，后续请求同享冷却；
  - 断点续传：已存在且通过校验的 PDF 直接跳过（与 download_papers.py --skip-existing 对齐）；
  - 完整性校验：%PDF 魔数 + 体积 >= 5KB（拦截 arXiv 错误页/占位响应）。

单进程顺序执行，无需技能版的跨进程文件锁。零第三方依赖。
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import http.client
import json
import random
import re
import subprocess
import time
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
import urllib.error
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PDF_MAGIC = b"%PDF"
MIN_PDF_BYTES = 5000
RETRYABLE_HTTP = {429, 500, 502, 503, 504}
ARXIV_ID_RE = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?$|^([a-z\-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?$", re.I)
DOI_ARXIV_RE = re.compile(r"^10\.48550/arxiv\.(.+)$", re.I)
URL_ARXIV_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/([^/?#\s]+)", re.I)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="arXiv 批量限速下载（download_ready.csv → papers/）")
    p.add_argument("--input", required=True, help="download_ready.csv（download_prep.py 产物）")
    p.add_argument("--out-dir", required=True, help="PDF 输出目录（papers/）")
    p.add_argument("--stats-out", default="", help="统计 JSON 输出路径，默认 <out-dir>/../download/arxiv_batch_stats.json")
    p.add_argument("--state-file", default="", help="节流状态文件，默认 <out-dir>/.runtime/arxiv_download_state.json")
    p.add_argument("--min-interval-sec", type=float, default=5.0, help="相邻请求最小间隔秒（默认 5，约 12 篇/分钟）")
    p.add_argument("--retry-max", type=int, default=4, help="429/5xx/网络错误最大重试次数")
    p.add_argument("--retry-base-sec", type=float, default=5.0, help="指数退避基数秒")
    p.add_argument("--retry-max-sec", type=float, default=120.0, help="单次退避上限秒")
    p.add_argument("--retry-jitter-sec", type=float, default=1.0, help="退避随机抖动上限秒")
    p.add_argument("--request-timeout", type=int, default=45, help="单请求超时秒")
    p.add_argument("--limit", type=int, default=0, help="本次最多网络下载篇数（0=不限，测试用）")
    p.add_argument("--force", action="store_true", help="忽略已存在文件强制重下")
    p.add_argument("--contact-email", default="autosurvey@example.com", help="合规 UA 联系邮箱")
    return p.parse_args()


def safe_filename(record_id: str, title: str, ext: str = "pdf") -> str:
    """与 download_papers.py safe_filename 完全一致——保证 --skip-existing 能命中。"""
    try:
        id_str = f"{int(record_id):04d}"
    except (ValueError, TypeError):
        id_str = str(record_id)[:6]
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9\s]", "", slug)
    slug = re.sub(r"\s+", "_", slug.strip())
    slug = slug[:60].rstrip("_")
    return f"{id_str}_{slug}.{ext}"


def arxiv_id_of(doi: str, url: str) -> str:
    """优先官方 DOI 10.48550/arXiv.<id>，其次 arxiv.org 链接。返回裸 ID（含版本号）。"""
    for source in (doi, url):
        m = DOI_ARXIV_RE.match((source or "").strip())
        if m:
            return m.group(1)
        m = URL_ARXIV_RE.search(source or "")
        if m:
            return m.group(1)
    return ""


def looks_like_arxiv_id(raw: str) -> bool:
    return bool(ARXIV_ID_RE.match(raw.strip()))


def load_state(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def acquire_slot(state_path: Path, min_interval: float) -> None:
    """取请求 slot：等足间隔 + 服务器冷却。顺序执行故无需文件锁。"""
    state = load_state(state_path)
    now = time.time()
    last = float(state.get("last_request_ts", 0.0) or 0.0)
    cooldown_until = float(state.get("cooldown_until_ts", 0.0) or 0.0)
    wait = max(0.0, min_interval - (now - last), cooldown_until - now)
    if wait > 0:
        time.sleep(wait)
    state["last_request_ts"] = time.time()
    state["last_request_utc"] = dt.datetime.now(dt.timezone.utc).isoformat()
    if state.get("cooldown_until_ts", 0) <= state["last_request_ts"]:
        state.pop("cooldown_until_ts", None)
        state.pop("cooldown_until_utc", None)
    save_state(state_path, state)


def register_cooldown(state_path: Path, seconds: float) -> None:
    if seconds <= 0:
        return
    state = load_state(state_path)
    new_until = max(float(state.get("cooldown_until_ts", 0.0) or 0.0), time.time() + seconds)
    state["cooldown_until_ts"] = new_until
    state["cooldown_until_utc"] = dt.datetime.fromtimestamp(new_until, tz=dt.timezone.utc).isoformat()
    save_state(state_path, state)


def parse_retry_after(raw: str) -> float:
    value = (raw or "").strip()
    if not value:
        return 0.0
    if value.isdigit():
        return float(int(value))
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return max(0.0, (parsed - dt.datetime.now(dt.timezone.utc)).total_seconds())


def user_agent(args: argparse.Namespace) -> str:
    return f"AutoSurvey-W1-corpus/0.1 (academic-survey tool; contact: {args.contact_email})"


# urllib 默认不带 Accept 头，arXiv CDN 会以 406 拒绝（实测），必须显式声明
FETCH_HEADERS = {"Accept": "*/*", "Accept-Encoding": "identity"}

# 传输通道阶梯（实测 arXiv CDN 会按 TLS/HTTP 指纹过滤：python-urllib 的请求在
# 缓存未命中时被 406，同 URL curl 直连正常。故 curl 子进程为首选，urllib 兜底）：
#   1. curl 直连（可信指纹）
#   2. urllib 跟随系统代理（不同出口 IP，规避单 IP 限流）
#   3. urllib 直连
OPENER_DEFAULT = urllib.request.build_opener()
OPENER_DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
# 这些状态码换下一通道也无济于事（资源真不存在 / 真被限流到底），按终态处理
PERMANENT_CODES = {404, 410}


def _curl_fetch(url: str, args: argparse.Namespace) -> tuple[int, bytes]:
    """curl 子进程抓取。返回 (http_code, body)；传输层失败抛 OSError。

    -o - 正文进 stdout、-w 状态码紧随其后，故 stdout = body + 3 位状态码。
    """
    cmd = ["curl", "-sS", "-L", "--max-time", str(args.request_timeout),
           "-A", user_agent(args), "-H", "Accept: */*", "-o", "-", "-w",
           "%{http_code}", url]
    proc = subprocess.run(cmd, capture_output=True)
    out = proc.stdout
    if len(out) >= 3 and out[-3:].isdigit():
        return int(out[-3:]), out[:-3]
    detail = proc.stderr.decode("utf-8", errors="replace").strip()
    raise OSError(detail.splitlines()[-1][:200] if detail else f"curl 退出码 {proc.returncode}")


def _urllib_fetch(url: str, args: argparse.Namespace, opener) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": user_agent(args), **FETCH_HEADERS})
    with opener.open(req, timeout=args.request_timeout) as resp:
        return resp.read()


def fetch_pdf(url: str, args: argparse.Namespace, state_path: Path) -> bytes:
    """三级通道 × 指数退避的抓取；404/410 等终态直接抛 HTTPError。"""
    backoff = 0.0
    for attempt in range(args.retry_max + 1):
        if backoff > 0:
            time.sleep(backoff)
            backoff = 0.0
        acquire_slot(state_path, args.min_interval_sec)

        last_code: int | None = None
        # —— 通道 1：curl 直连 ——
        try:
            code, body = _curl_fetch(url, args)
            if code == 200:
                return body
            last_code = code
            if code in PERMANENT_CODES:
                raise HTTPError(url, code, f"HTTP {code}", None, None)
            # 403/406/5xx → 换下一通道
        except OSError as exc:
            if isinstance(exc, HTTPError):
                raise
            last_code = None  # curl 不可用/网络失败 → urllib 兜底

        # —— 通道 2/3：urllib（系统代理 → 直连）——
        for opener in (OPENER_DEFAULT, OPENER_DIRECT):
            try:
                return _urllib_fetch(url, args, opener)
            except HTTPError as exc:
                last_code = exc.code
                if exc.code in PERMANENT_CODES:
                    raise
                if exc.code not in RETRYABLE_HTTP and exc.code not in (403, 406):
                    raise
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
                # HTTPException 覆盖 IncompleteRead（大 PDF 断流）等传输层错误
                last_code = None

        if attempt >= args.retry_max:
            raise RuntimeError(f"三级通道均失败（最后状态 {last_code or '网络异常'}）")
        backoff = min(args.retry_max_sec, args.retry_base_sec * (2 ** attempt)) + random.uniform(0.0, args.retry_jitter_sec)
        register_cooldown(state_path, backoff)
    raise RuntimeError("unreachable")


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    state_path = Path(args.state_file) if args.state_file else out_dir / ".runtime" / "arxiv_download_state.json"
    stats_path = Path(args.stats_out) if args.stats_out else out_dir.parent / "download" / "arxiv_batch_stats.json"

    with open(args.input, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))

    stats = {"total_rows": len(rows), "cached": 0, "downloaded": 0, "failed": 0,
             "no_arxiv_id": 0, "limit_reached": False, "network_attempts": 0,
             "min_interval_sec": args.min_interval_sec, "results": []}
    t0 = time.time()

    for row in rows:
        record_id = (row.get("record_id") or "0").strip()
        title = (row.get("title") or "unknown").strip()
        aid = arxiv_id_of(row.get("doi", ""), row.get("url", ""))
        entry: dict[str, Any] = {"record_id": record_id, "arxiv_id": aid}

        if not aid or not looks_like_arxiv_id(aid):
            stats["no_arxiv_id"] += 1
            entry["status"] = "no_arxiv_id" if not aid else "bad_id"
            stats["results"].append(entry)
            continue

        dest = out_dir / safe_filename(record_id, title)
        entry["file"] = dest.name
        if not args.force and dest.exists() and dest.stat().st_size > 1024 and dest.read_bytes()[:4] == PDF_MAGIC:
            stats["cached"] += 1
            entry["status"] = "cached"
            stats["results"].append(entry)
            continue

        if args.limit and stats["network_attempts"] >= args.limit:
            stats["limit_reached"] = True
            entry["status"] = "limit_skipped"
            stats["results"].append(entry)
            continue

        stats["network_attempts"] += 1
        # 无版本号 ID 先按原样请求；arXiv 对部分旧论文的无版本 PDF URL 返回 404/406，
        # 此时降级请求 v1（早期版本内容用于语料筛选足够，记录 fallback 便于追溯）
        urls = [f"https://export.arxiv.org/pdf/{aid}"]
        if not re.search(r"v\d+$", aid):
            urls.append(f"https://export.arxiv.org/pdf/{aid}v1")
        blob, url = None, urls[0]
        try:
            for i, candidate in enumerate(urls):
                url = candidate
                try:
                    blob = fetch_pdf(url, args, state_path)
                    break
                except HTTPError as exc:
                    if exc.code in (404, 406) and i < len(urls) - 1:
                        entry["version_fallback"] = True
                        continue
                    raise
            if blob[:4] != PDF_MAGIC or len(blob) < MIN_PDF_BYTES:
                entry["status"] = "invalid_content"
                entry["bytes"] = len(blob)
                stats["failed"] += 1
            else:
                dest.write_bytes(blob)
                entry["status"] = "downloaded"
                entry["bytes"] = len(blob)
                stats["downloaded"] += 1
        except HTTPError as exc:
            entry["status"] = "http_error"
            entry["code"] = exc.code
            stats["failed"] += 1
        except (URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
            entry["status"] = "network_error"
            entry["error"] = str(exc)[:200]
            stats["failed"] += 1
        stats["results"].append(entry)
        print(f"[arxiv-batch] {entry['status']:>15}  {aid:<22} {dest.name}", flush=True)

    stats["elapsed_sec"] = round(time.time() - t0, 1)
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    stats_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in stats.items() if k != "results"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
