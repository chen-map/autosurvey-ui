"""固定工作流执行器 — 确定性状态机（W1 语料构建 / W2 事实记忆，设计：docs/w1-pipeline-design.md）。

职责边界：
  - 本执行器只做编排（调起存量脚本、校验产物、落盘状态），不实现任何筛选/检索逻辑
  - LLM 判断（W1-P4 decision/reason 列）由 llm_screen.py 收敛层负责（M-B3）

状态文件 w1_state.json 结构（前端 B3 页 phase_states 的一一对应）：
  {project_id, started_at, updated_at, current, phases: [{id, name, status, started_at,
   ended_at, duration_sec, rc, outputs, log}]}
status ∈ pending | running | done | failed | skipped
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

STATE_FILES = {"w1": "w1_state.json", "w2": "w2_state.json", "w3": "w3_state.json", "w4": "w4_state.json"}
WORKFLOW_DIRS = {"w1": Path(__file__).resolve().parent,
                 "w2": Path(__file__).resolve().parents[1] / "w2",
                 "w3": Path(__file__).resolve().parents[1] / "w3",
                 "w4": Path(__file__).resolve().parents[1] / "w4"}
STEP_TIMEOUT_SEC = 3600


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_state(workspace: Path, state_file: str = STATE_FILES["w1"]) -> dict[str, Any]:
    path = workspace / state_file
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"phases": [], "started_at": now(), "updated_at": now(), "current": None}


def save_state(workspace: Path, state: dict[str, Any], state_file: str = STATE_FILES["w1"]) -> None:
    state["updated_at"] = now()
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / state_file).write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def init_state(workspace: Path, phases: list[dict[str, Any]], project_id: str,
               state_file: str = STATE_FILES["w1"]) -> dict[str, Any]:
    state = load_state(workspace, state_file)
    known = {p["id"]: p for p in state.get("phases", [])}
    merged = []
    for ph in phases:
        old = known.get(ph["id"], {})
        merged.append({
            "id": ph["id"], "name": ph["name"],
            "status": old.get("status", "pending"),
            "started_at": old.get("started_at"), "ended_at": old.get("ended_at"),
            "duration_sec": old.get("duration_sec"), "rc": old.get("rc"),
            "outputs": ph["outputs"], "log": f"logs/{ph['id']}.log",
        })
    state["phases"] = merged
    state["project_id"] = project_id
    save_state(workspace, state, state_file)
    return state


def run_step(step: dict[str, Any], log_path: Path, timeout: int, cwd: Path) -> int:
    """调起单个存量脚本；以 workspace 为工作目录（GUIDE 相对路径布局的前提），输出重定向到独立日志。

    step["env"]（可选 dict）按键合并进进程环境——跨工作流 LLM 配置注入用
    （W4 脚本以别名加载 kg_common，llm_wrap 补丁不可达，须走环境变量）。
    """
    cmd = [sys.executable, step["script"], *step["args"]]
    log_path.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.update({k: str(v) for k, v in (step.get("env") or {}).items()})
    with log_path.open("ab") as log:
        log.write(f"\n$ {' '.join(cmd)}\n".encode("utf-8"))
        log.flush()
        proc = subprocess.run(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, timeout=timeout, env=env)
    return proc.returncode


def outputs_ready(workspace: Path, outputs: list[str]) -> bool:
    return all((workspace / o).exists() for o in outputs)


def check_requires(phase: dict[str, Any]) -> None:
    """Phase 声明的硬依赖缺失时显式失败（防静默降级，如 rapidfuzz 缺失跳过去重）。"""
    import importlib  # noqa: PLC0415

    for mod in phase.get("requires", []):
        try:
            importlib.import_module(mod)
        except ImportError as exc:
            raise RuntimeError(
                f"{phase['id']} 依赖 {mod} 未安装——该依赖缺失会导致静默降级，请先 pip install {mod}") from exc


def run_phase(phase: dict[str, Any], cfg: dict[str, Any], workspace: Path,
              state: dict[str, Any], state_file: str = STATE_FILES["w1"]) -> str:
    pid = phase["id"]
    entry = next(p for p in state["phases"] if p["id"] == pid)
    if entry["status"] == "done" and outputs_ready(workspace, entry["outputs"]):
        return "done"
    entry["status"] = "running"
    entry["started_at"] = now()
    state["current"] = pid
    save_state(workspace, state, state_file)
    check_requires(phase)

    t0 = time.time()
    try:
        steps = list(phase["steps"]) + list(phase.get("steps_tail", []))
        for n, step in enumerate(steps, 1):
            log_path = workspace / "logs" / f"{pid}_step{n}.log"
            rc = run_step(step, log_path, cfg.get("step_timeout_sec", STEP_TIMEOUT_SEC), cwd=workspace)
            if rc != 0:
                entry["status"] = "failed"
                entry["rc"] = rc
                entry["ended_at"] = now()
                entry["duration_sec"] = round(time.time() - t0, 1)
                save_state(workspace, state, state_file)
                return "failed"
        missing = [o for o in phase["outputs"] if not (workspace / o).exists()]
        if missing:
            entry["status"] = "failed"
            entry["rc"] = -1
            entry["ended_at"] = now()
            save_state(workspace, state, state_file)
            raise FileNotFoundError(f"{pid} 产物缺失: {missing}")
        entry["status"] = "done"
        entry["rc"] = 0
    except subprocess.TimeoutExpired:
        entry["status"] = "failed"
        entry["rc"] = -9
    except Exception as exc:  # noqa: BLE001 — 顶层执行器需要把异常落进状态而非崩溃
        entry["status"] = "failed"
        entry["rc"] = -1
        entry["error"] = str(exc)
    entry["ended_at"] = now()
    entry["duration_sec"] = round(time.time() - t0, 1)
    save_state(workspace, state, state_file)
    return entry["status"]


def _load_build_phases(workflow: str):
    """按工作流加载对应 phase_defs.build_phases（显式路径导入，避免同名模块冲突）。"""
    import importlib.util  # noqa: PLC0415

    spec = importlib.util.spec_from_file_location(
        f"{workflow}_phase_defs", WORKFLOW_DIRS[workflow] / "phase_defs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.build_phases


def run_pipeline(cfg: dict[str, Any], *, workflow: str = "w1", resume: bool = True,
                 only: str | None = None, from_phase: str | None = None) -> dict[str, Any]:
    build_phases = _load_build_phases(workflow)
    return run_pipeline_with(build_phases(cfg), cfg, Path(cfg["workspace"]),
                             resume=resume, only=only, from_phase=from_phase,
                             state_file=STATE_FILES[workflow])


def run_pipeline_with(phases: list[dict[str, Any]], cfg: dict[str, Any],
                      workspace: Path, *, resume: bool = True,
                      only: str | None = None, from_phase: str | None = None,
                      state_file: str = STATE_FILES["w1"]) -> dict[str, Any]:
    workspace = Path(workspace)
    state = init_state(workspace, phases, cfg.get("project_id", ""), state_file)

    started = False
    for phase in phases:
        pid = phase["id"]
        if only and pid != only:
            continue
        if from_phase and not started and pid != from_phase:
            continue
        started = True
        entry = next(p for p in state["phases"] if p["id"] == pid)
        if resume and entry["status"] == "done":
            continue
        # 必须透传 state_file：run_phase 默认值是 w1_state.json，
        # 漏传会让 W2 的阶段进度全部写进 W1 状态文件（实测覆盖事故）
        status = run_phase(phase, cfg, workspace, state, state_file)
        if status == "failed":
            state["current"] = None
            save_state(workspace, state, state_file)
            return state  # fail-fast：前端可用 retry 恢复
    state["current"] = None
    save_state(workspace, state, state_file)
    return state


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="固定工作流执行器（W1 语料构建 / W2 事实记忆）")
    parser.add_argument("--config", required=True, help="w1_config.json 路径")
    parser.add_argument("--workflow", choices=sorted(STATE_FILES), default="w1", help="工作流（默认 w1）")
    parser.add_argument("--resume", action="store_true", help="跳过已完成 Phase")
    parser.add_argument("--only", help="只跑指定 Phase（如 W1-P2）")
    parser.add_argument("--from", dest="from_phase", help="从指定 Phase 开始")
    args = parser.parse_args(argv)

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    state = run_pipeline(cfg, workflow=args.workflow, resume=args.resume, only=args.only, from_phase=args.from_phase)
    failed = [p for p in state["phases"] if p["status"] == "failed"]
    print(f"完成：{sum(1 for p in state['phases'] if p['status'] == 'done')}"
          f"/{len(state['phases'])} done，失败 {len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
