"""AutoSurvey Pipeline API — FastAPI 薄壳。

前端 B3/B4 的真实数据源。契约：docs/backend-todo.md。
启动：cd backend && uvicorn api.main:app --port 8000
"""
from __future__ import annotations

import json
import os
import csv
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from db.database import get_db, init_db

BACKEND_DIR = Path(__file__).resolve().parents[1]
WORKSPACE = Path(os.environ.get("AS_WORKSPACE", str(BACKEND_DIR / "wm")))
RUNNER = BACKEND_DIR / "w1" / "runner.py"

app = FastAPI(title="AutoSurvey Pipeline API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wm(pid: str) -> Path:
    return WORKSPACE / pid / "w1"


def _read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_state(pid: str) -> dict[str, Any] | None:
    return _read_json(_wm(pid) / "w1_state.json")


def _write_state(pid: str, state: dict) -> None:
    _write_json(_wm(pid) / "w1_state.json", state)


def _read_config(pid: str) -> dict | None:
    return _read_json(_wm(pid) / "w1_config.json")


def _spawn_runner(pid: str) -> None:
    ws = _wm(pid)
    ws.mkdir(parents=True, exist_ok=True)
    log_path = ws / "runner.log"
    log = open(log_path, "ab")
    subprocess.Popen(
        [sys.executable, str(RUNNER), "--config", str(ws / "w1_config.json"), "--resume"],
        stdout=log, stderr=subprocess.STDOUT, cwd=str(ws),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "workspace": str(WORKSPACE)}


@app.post("/api/projects")
def create_project(body: dict):
    """创建项目并写入 w1_config.json。"""
    pid = f"proj-{int(time.time() * 1000)}"
    ws = WORKSPACE / pid / "w1"
    ws.mkdir(parents=True, exist_ok=True)
    cfg = {
        "project_id": pid, "title": body.get("title", ""),
        "field_tags": body.get("field_tags", []),
        "description": body.get("description", ""),
        "platforms": body.get("platforms", []),
        "search_cap": body.get("search_cap", 2000),
        "corpus_cap": body.get("corpus_cap", 500),
        "prescore": body.get("prescore", 0.25),
        "year_range": body.get("year_range", [2020, 2026]),
        "seed_dir": body.get("seed_dir", ""), "local_dir": body.get("local_dir", ""),
        "llm": body.get("llm", {}), "scripts_root": body.get("scripts_root", ""),
        "workspace": str(ws),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (ws / "w1_config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"project_id": pid}


@app.post("/api/projects/{pid}/run")
def start_run(pid: str):
    """启动（或续跑）W1。创建后项目为 draft，由此端点显式启动；--resume 跳过已完成 Phase。"""
    if _read_config(pid) is None:
        raise HTTPException(404, f"project not found: {pid}")
    _spawn_runner(pid)
    return {"ok": True, "project_id": pid}


@app.get("/api/projects/{pid}/run")
def get_run(pid: str):
    state_path = WORKSPACE / pid / "w1" / "w1_state.json"
    if not state_path.exists():
        raise HTTPException(404, f"run not found for {pid}")
    return json.loads(state_path.read_text(encoding="utf-8"))


@app.post("/api/projects/{pid}/phases/{phase_id}/retry")
def retry_phase(pid: str, phase_id: str):
    state_path = WORKSPACE / pid / "w1" / "w1_state.json"
    if not state_path.exists():
        raise HTTPException(404, f"run not found for {pid}")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    for ph in state.get("phases", []):
        if ph["id"] == phase_id:
            ph["status"] = "pending"
            break
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    _spawn_runner(pid)
    return {"ok": True, "phase_id": phase_id}


@app.get("/api/projects/{pid}/corpus")
def get_corpus(pid: str):
    """语料库页：W1 下载产物（corpus_papers 表）+ PRISMA 漏斗计数。

    数据来源：W1-P6 完成后 corpus_ingest.py 落库；漏斗前两级从 W1 中间产物 CSV 计数。
    """
    if _read_config(pid) is None:
        raise HTTPException(404, f"project not found: {pid}")
    init_db()
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM corpus_papers WHERE project_id=? ORDER BY id", (pid,)).fetchall()]
    conn.close()

    papers = [{
        "id": r["doi"] or f"paper-{r['id']}",
        "title": r["title"],
        "authors": "",
        "venue": r["venue"],
        "year": int(r["year"] or 0),
        "citations": 0,
        "stage": "已纳入" if r["status"] == "downloaded" else "可获取性",
        "abstract": r["abstract"],
        "status": r["status"],
        "pdfPath": r["pdf_path"],
        "card": {"problems": [], "methods": [], "datasets": [], "metrics": [], "limitations": [], "assumptions": []},
    } for r in rows]

    def _csv_count(rel: str) -> int:
        p = _wm(pid) / rel
        if not p.exists():
            return 0
        with open(p, encoding="utf-8-sig", newline="") as f:
            return sum(1 for _ in csv.DictReader(f))

    funnel = [
        {"stage": "检索归一", "count": _csv_count("retrieval_workspace/normalized/unified_records.csv"),
         "note": "W1-P3 归一去重后候选"},
        {"stage": "筛选纳入", "count": _csv_count("retrieval_workspace/screening/screened_records.csv"),
         "note": "W1-P4 筛选通过"},
        {"stage": "下载就绪", "count": len(rows), "note": "DOI 锚定 + 无 DOI 分流合计"},
        {"stage": "成功下载", "count": sum(1 for r in rows if r["status"] == "downloaded"),
         "note": "PDF 落盘（magic bytes 校验通过）"},
        {"stage": "下载失败", "count": sum(1 for r in rows if r["status"] == "failed"),
         "note": "占位 txt 含手动下载指引"},
        {"stage": "无 DOI 分流", "count": sum(1 for r in rows if r["status"] == "no_doi"),
         "note": "不进下载器，走人工/本地合并"},
    ]
    return {"papers": papers, "funnel": funnel}


@app.get("/api/projects")
def list_projects():
    projects = []
    if WORKSPACE.exists():
        for d in sorted(WORKSPACE.iterdir()):
            cfg_path = d / "w1" / "w1_config.json"
            if cfg_path.exists():
                c = json.loads(cfg_path.read_text(encoding="utf-8"))
                state_path = d / "w1" / "w1_state.json"
                status = "draft"
                if state_path.exists():
                    s = json.loads(state_path.read_text(encoding="utf-8"))
                    statuses = [p.get("status") for p in s.get("phases", [])]
                    if "running" in statuses:
                        status = "running"
                    elif all(x == "done" for x in statuses if x):
                        status = "completed"
                    elif "failed" in statuses:
                        status = "failed"
                projects.append({
                    "project_id": c.get("project_id", d.name),
                    "title": c.get("title", d.name),
                    "status": status,
                    "field_tags": c.get("field_tags", []),
                    "description": c.get("description", ""),
                    "search_cap": c.get("search_cap", 2000),
                    "corpus_cap": c.get("corpus_cap", 500),
                    "prescore": c.get("prescore", 0.25),
                    "year_range": c.get("year_range", [2020, 2026]),
                    "seed_dir": c.get("seed_dir", ""),
                    "local_dir": c.get("local_dir", ""),
                    "llm": c.get("llm", {}),
                    "updated_at": c.get("updated_at", ""),
                })
    return {"projects": projects}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
