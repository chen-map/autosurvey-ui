"""AutoSurvey Pipeline API — FastAPI 薄壳。

前端 B3/B4 的真实数据源。契约：docs/backend-todo.md。
启动：cd backend && uvicorn api.main:app --port 8000
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BACKEND = Path(__file__).resolve().parents[1]
WORKSPACE = Path(os.environ.get("AS_WORKSPACE", str(BACKEND / "wm")))
RUNNER = BACKEND / "w1" / "runner.py"

app = FastAPI(title="AutoSurvey Pipeline API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    title: str
    field_tags: list[str] = []
    description: str = ""
    platforms: list[str] = ["Semantic Scholar", "arXiv", "OpenAlex"]
    search_cap: int = 2000
    corpus_cap: int = 500
    prescore: float = 0.25
    year_range: list[int] = [2020, 2026]
    seed_dir: str = ""
    local_dir: str = ""
    llm: dict = Field(default_factory=dict)
    scripts_root: str = ""
    spawn_runner: bool = True


class RetryPhaseRequest(BaseModel):
    phase_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wm(pid: str) -> Path:
    return WORKSPACE / pid / "w1"


def _read_state(pid: str) -> dict[str, Any] | None:
    p = _wm(pid) / "w1_state.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _write_state(pid: str, state: dict) -> None:
    (_wm(pid) / "w1_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_config(pid: str) -> dict | None:
    p = _wm(pid) / "w1_config.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _spawn_runner(pid: str, extra: list[str] | None = None) -> None:
    ws = _wm(pid)
    ws.mkdir(parents=True, exist_ok=True)
    log = open(ws / "runner.log", "ab")
    cmd = [sys.executable, str(RUNNER), "--config", str(ws / "w1_config.json")]
    if extra:
        cmd.extend(extra)
    subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=str(ws))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "workspace": str(WORKSPACE)}


@app.post("/api/projects")
def create_project(body: CreateProjectRequest):
    pid = f"proj-{int(time.time() * 1000)}"
    ws = _wm(pid)
    ws.mkdir(parents=True, exist_ok=True)

    cfg = {
        "project_id": pid, "title": body.title,
        "field_tags": body.field_tags, "description": body.description,
        "platforms": body.platforms, "search_cap": body.search_cap,
        "corpus_cap": body.corpus_cap, "prescore": body.prescore,
        "year_range": body.year_range,
        "seed_dir": body.seed_dir, "local_dir": body.local_dir,
        "llm": body.llm, "scripts_root": body.scripts_root,
        "workspace": str(ws),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (ws / "w1_config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    if body.spawn_runner:
        _spawn_runner(pid)

    return {"project_id": pid}


@app.get("/api/projects/{pid}/run")
def get_run(pid: str):
    state = _read_state(pid)
    if state is None:
        raise HTTPError(404, "run not found")
    return state


@app.post("/api/projects/{pid}/phases/{phase_id}/retry")
def retry_phase(pid: str, phase_id: str):
    state = _read_state(pid)
    if state is None:
        raise HTTPError(404, "run not found")
    _patch_phase_state(pid, phase_id, status="pending")
    _spawn_runner(pid)
    return {"ok": True, "phase_id": phase_id}


@app.get("/api/projects")
def list_projects():
    projects = []
    if WORKSPACE.exists():
        for d in sorted(WORKSPACE.iterdir()):
            cfg = d / "w1" / "w1_config.json"
            if cfg.exists():
                c = json.loads(cfg.read_text(encoding="utf-8"))
                projects.append({
                    "project_id": c.get("project_id", d.name),
                    "title": c.get("title", d.name),
                    "status": "draft",
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
