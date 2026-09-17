"""执行器状态机测试：用假脚本验证顺序/断点/失败/产物校验（不依赖真实 autoSurvey_v2）。"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from w1 import runner  # noqa: E402


@pytest.fixture()
def env(tmp_path: Path):
    """构造假脚本根目录与 workspace。step1 产出 a.csv，step2 产出 b.csv。"""
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "s1.py").write_text(
        "import sys, pathlib\n"
        "out = pathlib.Path(sys.argv[sys.argv.index('--output') + 1])\n"
        "out.parent.mkdir(parents=True, exist_ok=True)\n"
        "out.write_text('data-a')\n", encoding="utf-8")
    (scripts / "s2.py").write_text(
        "import sys, pathlib\n"
        "inp = pathlib.Path(sys.argv[sys.argv.index('--input') + 1])\n"
        "assert inp.exists(), 'step2 需要step1产物'\n"
        "out = pathlib.Path(sys.argv[sys.argv.index('--output') + 1])\n"
        "out.parent.mkdir(parents=True, exist_ok=True)\n"
        "out.write_text('data-b')\n", encoding="utf-8")
    (scripts / "boom.py").write_text("raise SystemExit(3)\n", encoding="utf-8")

    workspace = tmp_path / "wm" / "proj-1" / "w1"
    cfg = {"project_id": "proj-1", "scripts_root": str(scripts), "workspace": str(workspace)}
    return cfg, workspace


def _phases(cfg, failing=False):
    return [
        {"id": "W1-P1", "name": "step one",
         "steps": [{"script": f"{cfg['scripts_root']}/s1.py",
                    "args": ["--output", "out/a.csv"]}],
         "outputs": ["out/a.csv"]},
        {"id": "W1-P2", "name": "step two",
         "steps": ([{"script": f"{cfg['scripts_root']}/boom.py", "args": []}] if failing else [])
                  + [{"script": f"{cfg['scripts_root']}/s2.py",
                      "args": ["--input", "out/a.csv", "--output", "out/b.csv"]}],
         "outputs": ["out/b.csv"]},
    ]


def test_顺序执行与产物校验(env):
    cfg, ws = env
    monkey_phases = _phases(cfg)
    state = runner.run_pipeline_with(monkey_phases, cfg, ws)
    assert [p["status"] for p in state["phases"]] == ["done", "done"]
    assert (ws / "out" / "a.csv").exists() and (ws / "out" / "b.csv").exists()


def test_断点续跑跳过已完成(env):
    cfg, ws = env
    monkey_phases = _phases(cfg)
    runner.run_pipeline_with(monkey_phases, cfg, ws)
    (ws / "out" / "b.csv").unlink()
    # resume 跳过全部已完成 Phase：b.csv 不会被重建（这正是"跳过"的语义）
    state = runner.run_pipeline_with(monkey_phases, cfg, ws, resume=True)
    assert state["phases"][0]["status"] == "done"
    assert state["phases"][1]["status"] == "done"
    assert not (ws / "out" / "b.csv").exists()
    # 显式 only + resume=False 才会重建产物（对应前端重跑按钮的语义）
    state = runner.run_pipeline_with(monkey_phases, cfg, ws, only="W1-P2", resume=False)
    assert (ws / "out" / "b.csv").exists()


def test_失败落盘且fail_fast(env):
    cfg, ws = env
    failing = _phases(cfg, failing=True)
    state = runner.run_pipeline_with(failing, cfg, ws)
    # boom.py 在 P2 内部：P1 正常完成，P2 失败后 fail-fast（没有后续 Phase 可验证，检查 rc）
    assert state["phases"][0]["status"] == "done"
    assert state["phases"][1]["status"] == "failed"
    assert state["phases"][1]["rc"] == 3


def test_产物缺失视为失败(env):
    cfg, ws = env
    phases = _phases(cfg)
    phases[0]["outputs"] = ["out/不存在的产物.csv"]
    state = runner.run_pipeline_with(phases, cfg, ws)
    assert state["phases"][0]["status"] == "failed"
