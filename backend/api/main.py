"""AutoSurvey Pipeline API — FastAPI 薄壳。

前端 B3/B4 的真实数据源。契约：docs/backend-todo.md。
启动：cd backend && uvicorn api.main:app --port 8000
"""
from __future__ import annotations

import json
import re
import os
import csv
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from db.database import get_db, init_db, WORKSPACE
from db.crypto import encrypt, decrypt, mask_key
from api.auth import router as auth_router, get_current_user, provision_user_partition
from fastapi import Header
from fastapi import Body
import requests as _requests

BACKEND_DIR = Path(__file__).resolve().parents[1]
RUNNER = BACKEND_DIR / "w1" / "runner.py"

app = FastAPI(title="AutoSurvey Pipeline API", version="0.3.0")
app.include_router(auth_router)


@app.on_event("startup")
def _seed_demo_user():
    """空库时播种演示账号 demo/123456（仅本地单机用）。"""
    init_db()
    conn = get_db()
    n = conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
    if n == 0:
        from db.crypto import hash_password
        conn.execute("INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
                     ("demo", hash_password("123456"), "admin"))
        conn.commit()
    conn.close()
    from db.database import _migrate_llm_provider
    _migrate_llm_provider()
    # 存量用户分区补齐（注册即建分区机制上线前注册的老用户）
    conn = get_db()
    for u in conn.execute("SELECT id FROM users").fetchall():
        provision_user_partition(u["id"])
    conn.close()
    # 旧项目迁移：把文件系统里存在但 projects 表没有的项目归属到首个用户（demo）
    conn = get_db()
    first_uid = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
    if first_uid:
        uid = first_uid["id"]
        for d in WORKSPACE.iterdir():
            if not d.is_dir() or d.name.startswith("u"):
                continue
            cfg = d / "w1" / "w1_config.json"
            if cfg.exists():
                try:
                    c = json.loads(cfg.read_text(encoding="utf-8"))
                    pid = c.get("project_id", d.name)
                    conn.execute(
                        "INSERT OR IGNORE INTO projects (project_id, user_id, title, workspace_rel) VALUES (?,?,?,?)",
                        (pid, uid, c.get("title", d.name), f"{d.name}/w1"))
                except Exception:
                    pass
        conn.commit()
    conn.close()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _me(authorization: str = Header(default="")) -> dict:
    """从 Authorization header 解析当前登录用户（须在所有需要认证的端点之前定义）。"""
    token = authorization.removeprefix("Bearer ").strip()
    user = get_current_user(token)
    if not user:
        raise HTTPException(401, "未登录或会话过期")
    return user


def _own_project(pid: str, user: dict) -> None:
    """项目归属校验：pid 不属于当前用户 → 404（不泄露存在性）。"""
    conn = get_db()
    row = conn.execute("SELECT user_id FROM projects WHERE project_id=?", (pid,)).fetchone()
    conn.close()
    if row is None or row["user_id"] != user["user_id"]:
        raise HTTPException(404, "project not found")

def _wm(pid: str) -> Path:
    """解析项目工作区路径。优先查 projects 表（按用户隔离的新项目），回退旧布局。"""
    try:
        conn = get_db()
        row = conn.execute("SELECT workspace_rel FROM projects WHERE project_id=?", (pid,)).fetchone()
        conn.close()
        if row:
            return WORKSPACE / row["workspace_rel"]
    except Exception:
        pass
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


def _spawn_runner(pid: str, workflow: str = "w1", user_id: int | None = None) -> None:
    ws = _wm(pid)
    ws.mkdir(parents=True, exist_ok=True)
    log_path = ws / f"runner_{workflow}.log"
    log = open(log_path, "ab")
    env = dict(os.environ)
    if user_id is not None:
        env["AS_RUN_USER_ID"] = str(user_id)  # 流水线子进程按项目归属用户解析 LLM 配置
    subprocess.Popen(
        [sys.executable, str(RUNNER), "--config", str(ws / "w1_config.json"),
         "--workflow", workflow, "--resume"],
        stdout=log, stderr=subprocess.STDOUT, cwd=str(ws), env=env,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "workspace": str(WORKSPACE)}


@app.post("/api/uploads/seeds")
async def upload_seeds(files: list[UploadFile] = File(...), user: dict = Depends(_me)):
    """种子论文上传：暂存到用户暂存区，createProject 时移入项目 workspace/seeds。"""
    staged = WORKSPACE / f"u{user['user_id']}" / "_staged_seeds"
    staged.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        name = Path(f.filename or "seed.pdf").name
        if not name.lower().endswith(".pdf"):
            continue
        data = await f.read()
        if len(data) < 1024 or data[:4] != b"%PDF":
            raise HTTPException(400, f"{name} 不是有效的 PDF 文件")
        (staged / name).write_bytes(data)
        saved.append(name)
    if not saved:
        raise HTTPException(400, "没有有效的 PDF 文件")
    return {"ok": True, "files": saved}


@app.post("/api/projects")
def create_project(body: dict, user: dict = Depends(_me)):
    """创建项目并写入 w1_config.json（绑定当前登录用户）。
    body.seed_files: 已上传种子文件的文件名列表（经 /api/uploads/seeds 预先上传）。
    """
    pid = f"proj-{int(time.time() * 1000)}"
    uid = user["user_id"]
    table_rel = f"u{uid}/{pid}/w1"      # projects 表用：相对 WORKSPACE 基目录
    ws = WORKSPACE / table_rel
    ws.mkdir(parents=True, exist_ok=True)
    # 种子目录：把用户上传的种子 PDF 从暂存区移入项目 workspace
    seed_dir = ""
    staged = WORKSPACE / f"u{uid}" / "_staged_seeds"
    seed_files = body.get("seed_files") or []
    if seed_files:
        seed_dir = str(ws / "seeds")
        (ws / "seeds").mkdir(parents=True, exist_ok=True)
        import shutil as _shutil
        for name in seed_files:
            src = staged / Path(name).name
            if src.exists():
                _shutil.move(str(src), str(ws / "seeds" / Path(name).name))
    cfg = {
        "project_id": pid, "title": body.get("title", ""),
        "topic": body.get("title", ""),                 # phase_defs P4 筛选主题
        "domain_tags": body.get("field_tags", []),      # phase_defs P1 关键词领域
        "field_tags": body.get("field_tags", []),
        "description": body.get("description", ""),
        "platforms": body.get("platforms", []),
        # camelCase（前端 payload）优先，snake_case 兜底——曾因命名不匹配永远落默认值
        "search_cap": body.get("searchCap", body.get("search_cap", 2000)),
        "corpus_cap": body.get("corpusCap", body.get("corpus_cap", 500)),
        "prescore": body.get("prescore", 0.25),
        "year_range": body.get("yearRange", body.get("year_range", [2020, 2026])),
        "seed_dir": seed_dir, "local_dir": body.get("local_dir", ""),
        "search_keywords": body.get("search_keywords", []),  # LLM 生成或用户直填的英文检索词
        # LLM 配置不落盘：唯一事实源是 llm_configs 表（Fernet 加密），运行时经 AS_RUN_USER_ID 解析
        # 存量脚本根目录：前端契约不含此字段，默认本地 autoSurvey_v2（可用 AS_SCRIPTS_ROOT 覆盖）
        "scripts_root": body.get("scripts_root") or os.environ.get(
            "AS_SCRIPTS_ROOT",
            "C:/Users/85864/Documents/xwechat_files/wxid_4wveq34o7nag22_eb4c/msg/file/2026-09/autoSurvey_v2/autoSurvey_v2"),
        "workspace": str(ws),
        "workspace_rel": "retrieval_workspace",  # phase_defs 契约：相对 workspace 的输出目录
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (ws / "w1_config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    # 项目归属写入 DB
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO projects (project_id, user_id, title, workspace_rel) VALUES (?,?,?,?)",
        (pid, uid, body.get("title", ""), table_rel),
    )
    conn.commit()
    conn.close()
    return {"project_id": pid}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str, user: dict = Depends(_me)):
    """删除项目：DB 两张项目级表 + 工作区目录。归属校验不过 → 404。"""
    _own_project(pid, user)
    conn = get_db()
    row = conn.execute("SELECT workspace_rel FROM projects WHERE project_id=?", (pid,)).fetchone()
    conn.execute("DELETE FROM projects WHERE project_id=?", (pid,))
    conn.execute("DELETE FROM corpus_papers WHERE project_id=?", (pid,))
    conn.commit()
    conn.close()
    # 工作区目录删除：解析后必须仍在 WORKSPACE 内（防 workspace_rel 被污染成穿越路径）
    import shutil
    if row and row["workspace_rel"]:
        root = (WORKSPACE / row["workspace_rel"]).parent  # workspace_rel 形如 u{uid}/{pid}/w1
        try:
            root_resolved = root.resolve()
            root_resolved.relative_to(WORKSPACE.resolve())
            if root_resolved.exists():
                shutil.rmtree(root_resolved, ignore_errors=True)
        except (ValueError, OSError):
            pass  # 路径越界：宁可留着也不误删
    return {"ok": True}


@app.post("/api/projects/{pid}/run")
def start_run(pid: str, workflow: str = "w1", user: dict = Depends(_me)):
    _own_project(pid, user)
    """启动（或续跑）工作流。创建后项目为 draft，由此端点显式启动；--resume 跳过已完成 Phase。"""
    if workflow not in ("w1", "w2", "w3", "w4", "w5"):
        raise HTTPException(400, f"unknown workflow: {workflow}")
    if _read_config(pid) is None:
        raise HTTPException(404, f"project not found: {pid}")
    _spawn_runner(pid, workflow, user["user_id"])
    return {"ok": True, "project_id": pid, "workflow": workflow}


@app.get("/api/projects/{pid}/run")
def get_run(pid: str, workflow: str = "w1", user: dict = Depends(_me)):
    _own_project(pid, user)
    state_path = _wm(pid) / f"{workflow}_state.json"
    if not state_path.exists():
        raise HTTPException(404, f"run not found for {pid}")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    # W1-P6 下载进度注入：papers/ 目录 PDF+占位计数 / download_ready 总数（前端 chip 显示 xx/xx）
    # running 时实时跳数；done/failed 后保留最终战果（用户裁决：进度条跑完也要能看到）
    if workflow == "w1":
        for ph in state.get("phases", []):
            if ph.get("id") == "W1-P6" and ph.get("status") in ("running", "done", "failed"):
                dl_dir = _wm(pid) / "retrieval_workspace" / "download" / "download_ready.csv"
                papers = _wm(pid) / "retrieval_workspace" / "papers"
                if dl_dir.exists() and papers.exists():
                    try:
                        total = sum(1 for _ in dl_dir.open(encoding="utf-8-sig")) - 1
                        n_pdf = len(list(papers.glob("*.pdf")))
                        n_txt = len(list(papers.glob("*.txt")))
                        ph["progress"] = {"downloaded": n_pdf, "placeholder": n_txt,
                                          "total": max(total, 0)}
                    except OSError:
                        pass
                break
    return state


@app.post("/api/projects/{pid}/phases/{phase_id}/retry")
def retry_phase(pid: str, phase_id: str, workflow: str = "w1", user: dict = Depends(_me)):
    _own_project(pid, user)
    state_path = _wm(pid) / f"{workflow}_state.json"
    if not state_path.exists():
        raise HTTPException(404, f"run not found for {pid}")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    for ph in state.get("phases", []):
        if ph["id"] == phase_id:
            ph["status"] = "pending"
            ph.pop("duration_sec", None)  # 清上次时长残留（否则 running 显示旧 600s）
            ph.pop("rc", None)
            break
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    _spawn_runner(pid, workflow, user["user_id"])
    return {"ok": True, "phase_id": phase_id}


@app.get("/api/projects/{pid}/corpus")
def get_corpus(pid: str, user: dict = Depends(_me), page: int = 1, page_size: int = 50,
               status: str = ""):
    _own_project(pid, user)
    """语料库页：分页返回（大语料不全量加载）；漏斗计数走 SQL 聚合。

    page 从 1 起；status 可选过滤（downloaded/failed/no_doi）。
    W1-P6 下载进行中：corpus_papers 尚未入账（ingest 在 P6 末尾），改用
    download_ready + papers/ 目录实时聚合（用户裁决：下载中就能看到哪个下好了、
    哪个需要人工补）。
    """
    if _read_config(pid) is None:
        raise HTTPException(404, f"project not found: {pid}")
    init_db()
    page, page_size = max(1, page), min(max(1, page_size), 200)

    # 目录-DB 对账：回捞器/手动上传直写 papers/ 目录不经过 P6 末尾的批量入账，
    # 库里的 status 会滞后（实测 69 vs 目录 162）——目录为准校正
    try:
        papers_dir = _wm(pid) / "retrieval_workspace" / "papers"
        ready_csv0 = _wm(pid) / "retrieval_workspace" / "download" / "download_ready.csv"
        if papers_dir.exists() and ready_csv0.exists():
            import csv as _csv0
            pdf_rids0 = {f.name[:4] for f in papers_dir.glob("*.pdf") if f.name[:4].isdigit()}
            txt_rids0 = {f.name[:4] for f in papers_dir.glob("*.txt") if f.name[:4].isdigit()}
            rid_row0: dict[str, dict] = {}
            if pdf_rids0 or txt_rids0:
                for r in _csv0.DictReader(open(ready_csv0, encoding="utf-8-sig")):
                    m0 = re.match(r"^(\d+)", r.get("record_id") or "")
                    if m0:
                        rid_row0[f"{int(m0.group(1)):04d}"] = r
            conn0 = get_db()
            n_dl0 = conn0.execute(
                "SELECT COUNT(*) c FROM corpus_papers WHERE project_id=? AND status='downloaded'",
                (pid,)).fetchone()["c"]
            if len(pdf_rids0) > n_dl0 and rid_row0:
                n_fix = 0
                for rid0, r0 in rid_row0.items():
                    if rid0 not in pdf_rids0:
                        continue
                    cur0 = conn0.execute(
                        "UPDATE corpus_papers SET status='downloaded' WHERE project_id=? AND record_id=?",
                        (pid, r0.get("record_id") or ""))
                    n_fix += cur0.rowcount
                # 目录 PDF 但 ready 无对应行的（手动上传的新论文等）——已由上传端点入账，跳过
                conn0.commit()
                if n_fix:
                    print(f"[corpus] 目录对账：{n_fix} 行校正为 downloaded")
            conn0.close()
    except Exception:
        pass  # 对账失败不影响正常查询

    # 实时分支：P6 running 且库中行数明显少于下载清单（未入账）
    state = _read_state(pid)
    p6 = next((p for p in (state or {}).get("phases", []) if p.get("id") == "W1-P6"), {})
    ready_csv = _wm(pid) / "retrieval_workspace" / "download" / "download_ready.csv"
    if p6.get("status") == "running" and ready_csv.exists():
        conn = get_db()
        n_db = conn.execute("SELECT COUNT(*) c FROM corpus_papers WHERE project_id=?",
                            (pid,)).fetchone()["c"]
        conn.close()
        n_ready = sum(1 for _ in ready_csv.open(encoding="utf-8-sig")) - 1
        if n_db < n_ready:
            return _corpus_live(pid, page, page_size, status)

    where = "project_id=?" + (" AND status=?" if status else "")
    args = (pid, status) if status else (pid,)

    conn = get_db()
    total = conn.execute(f"SELECT COUNT(*) c FROM corpus_papers WHERE {where}", args).fetchone()["c"]
    rows = [dict(r) for r in conn.execute(
        f"SELECT id, doi, title, venue, year, status, pdf_path FROM corpus_papers WHERE {where} ORDER BY id LIMIT ? OFFSET ?",
        args + (page_size, (page - 1) * page_size)).fetchall()]
    status_counts = {r["status"]: r["c"] for r in conn.execute(
        f"SELECT status, COUNT(*) c FROM corpus_papers WHERE {where} GROUP BY status", args).fetchall()}
    conn.close()

    papers = [{
        "id": r["doi"] or f"paper-{r['id']}",
        "title": r["title"],
        "authors": "",
        "venue": r["venue"],
        "year": int(r["year"] or 0),
        "citations": 0,
        "stage": "已纳入" if r["status"] == "downloaded" else "可获取性",
        "abstract": "",
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
        {"stage": "下载就绪", "count": total, "note": "DOI 锚定 + 无 DOI 分流合计"},
        {"stage": "成功下载", "count": status_counts.get("downloaded", 0),
         "note": "PDF 落盘（magic bytes 校验通过）"},
        {"stage": "下载失败", "count": status_counts.get("failed", 0),
         "note": "占位 txt 含手动下载指引"},
        {"stage": "无 DOI 分流", "count": status_counts.get("no_doi", 0),
         "note": "不进下载器，走人工/本地合并"},
    ]
    return {"papers": papers, "funnel": funnel, "total": total, "page": page, "pageSize": page_size}




# ---- 个人 API Key（Fernet 加密 at rest，接口只回掩码） ----

class EmailIn(BaseModel):
    email: str


@app.get("/api/me/profile")
def get_profile(user: dict = Depends(_me)):
    """个人资料：用户名 + 绑定邮箱（找回密码通道）。"""
    conn = get_db()
    row = conn.execute("SELECT username, email FROM users WHERE id=?", (user["user_id"],)).fetchone()
    conn.close()
    return {"username": row["username"], "email": row["email"] or "" if row else ""}


@app.put("/api/me/email")
def put_email(body: EmailIn, user: dict = Depends(_me)):
    """补填/更换绑定邮箱（存量注册无邮箱的用户在此补，忘密码靠它）。"""
    from api.auth import _valid_email
    email = body.email.strip().lower()
    if not _valid_email(email):
        raise HTTPException(400, "邮箱格式不正确")
    conn = get_db()
    dup = conn.execute("SELECT 1 FROM users WHERE email=? AND id<>?", (email, user["user_id"])).fetchone()
    if dup:
        conn.close()
        raise HTTPException(409, "该邮箱已被其他账号绑定")
    conn.execute("UPDATE users SET email=? WHERE id=?", (email, user["user_id"]))
    conn.commit()
    conn.close()
    return {"ok": True, "email": email}


class ApiKeyIn(BaseModel):
    platform: str
    key: str


@app.get("/api/me/api-keys")
def list_api_keys(user: dict = Depends(_me)):
    conn = get_db()
    rows = conn.execute(
        "SELECT platform, key_encrypted FROM api_keys WHERE user_id=?", (user["user_id"],)).fetchall()
    conn.close()
    return {"keys": {r["platform"]: mask_key(decrypt(r["key_encrypted"])) for r in rows}}


@app.put("/api/me/api-keys")
def put_api_key(body: ApiKeyIn, user: dict = Depends(_me)):
    if not body.platform.strip() or not body.key.strip():
        raise HTTPException(400, "platform 与 key 不能为空")
    conn = get_db()
    conn.execute(
        "INSERT INTO api_keys (user_id, platform, key_encrypted) VALUES (?,?,?) "
        "ON CONFLICT(user_id, platform) DO UPDATE SET key_encrypted=excluded.key_encrypted",
        (user["user_id"], body.platform.strip(), encrypt(body.key.strip())))
    conn.commit()
    conn.close()
    return {"ok": True, "masked": mask_key(body.key.strip())}


@app.delete("/api/me/api-keys/{platform}")
def delete_api_key(platform: str, user: dict = Depends(_me)):
    conn = get_db()
    conn.execute("DELETE FROM api_keys WHERE user_id=? AND platform=?", (user["user_id"], platform))
    conn.commit()
    conn.close()
    return {"ok": True}


# ---- LLM 接入配置（按 WF 独立配置 + 可选细粒度覆盖；Fernet 加密存储） ----

# 按 5 大 WF + Agent + 方向精炼组织，每个 WF 内可细粒度覆盖
LLM_USE_CASES = [
    {"id": "default", "label": "全局默认", "wf": "所有", "stage": "未单独配置的环节自动继承此配置"},
    {"id": "w1", "label": "W1 语料构建", "wf": "W1", "stage": "检索 · 筛选 · 下载 · 入库"},
    {"id": "w2", "label": "W2 事实记忆", "wf": "W2", "stage": "解析 · 六类提取 · KG 构建"},
    {"id": "w3", "label": "W3 框架与RQ", "wf": "W3", "stage": "Gap · RQ 设计 · 证据矩阵 · 评审"},
    {"id": "w4", "label": "W4 工作记忆", "wf": "W4", "stage": "证据抽取 · 答案综合 · claim 核查"},
    {"id": "w5", "label": "W5 综述写作", "wf": "W5", "stage": "大纲 → LaTeX 全文"},
]


def resolve_llm(user_id: int, use_case: str = "default") -> tuple[str, str, str, str]:
    """解析链：环节专属行（Key 可解密且非空）→ default 行。返回 (base, key, model, provider)。"""
    from db.crypto import decrypt

    conn = get_db()
    rows = {r["use_case"]: r for r in conn.execute(
        "SELECT * FROM llm_configs WHERE user_id=?", (user_id,)).fetchall()}
    conn.close()
    for uc in (use_case, "default"):
        r = rows.get(uc)
        if r is None:
            continue
        key = decrypt(r["api_key_encrypted"])
        if r["base_url"] and key and r["model"]:
            provider = r["provider"] if "provider" in r.keys() else "openai"
            return r["base_url"], key, r["model"], provider
    return "", "", "", "openai"

class LlmConfigIn(BaseModel):
    baseUrl: str = ""
    apiKey: str = ""
    model: str = ""
    useCase: str = "default"
    provider: str = "openai"  # openai | anthropic


@app.get("/api/me/llm-catalog")
def get_llm_catalog(user: dict = Depends(_me)):
    """AI 使用点目录 + 各环节当前配置概览（掩码）。"""
    conn = get_db()
    rows = {r["use_case"]: r for r in conn.execute(
        "SELECT * FROM llm_configs WHERE user_id=?", (user["user_id"],)).fetchall()}
    conn.close()
    out = []
    for uc in LLM_USE_CASES:
        r = rows.get(uc["id"])
        key = decrypt(r["api_key_encrypted"]) if r else ""
        ok = bool(r and r["base_url"] and key and r["model"])
        provider = r["provider"] if r and "provider" in r.keys() else "openai"
        out.append({**uc, "configured": ok, "baseUrl": r["base_url"] if r else "",
                    "model": r["model"] if r else "",
                    "apiKeyMasked": mask_key(key) if key else "",
                    "provider": provider})
    return {"useCases": out}


@app.get("/api/me/llm-config")
def get_llm_config(user: dict = Depends(_me), use_case: str = "default"):
    conn = get_db()
    row = conn.execute(
        "SELECT base_url, api_key_encrypted, model FROM llm_configs WHERE user_id=? AND use_case=?",
        (user["user_id"], use_case)).fetchone()
    conn.close()
    if row is None:
        return {"baseUrl": "", "model": "", "apiKeyMasked": "", "configured": False, "useCase": use_case}
    key = decrypt(row["api_key_encrypted"])
    return {"baseUrl": row["base_url"], "model": row["model"], "useCase": use_case,
            "apiKeyMasked": mask_key(key) if key else "", "configured": bool(row["base_url"] and key and row["model"])}


@app.put("/api/me/llm-config")
def put_llm_config(body: LlmConfigIn, user: dict = Depends(_me)):
    use_case = body.useCase if body.useCase in {u["id"] for u in LLM_USE_CASES} else "default"
    if body.apiKey.strip() and len(body.apiKey.strip()) < 20:
        raise HTTPException(400, f"API Key 只有 {len(body.apiKey.strip())} 个字符——多半是粘贴不完整，请完整复制后重填")
    conn = get_db()
    if body.apiKey.strip():
        key_enc = encrypt(body.apiKey.strip())  # 提供了新 Key → 加密覆盖
    else:
        # 未提供 Key → 保留该使用点现存密文；没有则继承 default 的密文
        row = conn.execute("SELECT api_key_encrypted FROM llm_configs WHERE user_id=? AND use_case=?",
                           (user["user_id"], use_case)).fetchone()
        key_enc = row["api_key_encrypted"] if row and row["api_key_encrypted"] else ""
        if not key_enc and use_case != "default":
            d = conn.execute("SELECT api_key_encrypted FROM llm_configs WHERE user_id=? AND use_case='default'",
                             (user["user_id"],)).fetchone()
            key_enc = d["api_key_encrypted"] if d else ""
    conn.execute(
        "INSERT INTO llm_configs (user_id, use_case, base_url, api_key_encrypted, model, provider) VALUES (?,?,?,?,?,?) "
        "ON CONFLICT(user_id, use_case) DO UPDATE SET base_url=excluded.base_url, "
        "api_key_encrypted=excluded.api_key_encrypted, model=excluded.model, provider=excluded.provider, updated_at=datetime('now')",
        (user["user_id"], use_case, body.baseUrl.strip(), key_enc, body.model.strip(), body.provider))
    conn.commit()
    conn.close()
    return {"ok": True}


class ChatIn(BaseModel):
    messages: list[dict]
    temperature: float = 0.3
    maxTokens: int = 2000
    useCase: str = "default"


@app.post("/api/llm/chat")
def llm_chat(body: ChatIn, user: dict = Depends(_me)):
    """服务端 LLM 代理：解密用户存储的 url+apikey+model 调用，明文 Key 永不回传浏览器。"""
    base, key, model, _provider = resolve_llm(user["user_id"], getattr(body, "useCase", "default") or "default")
    if not (base and key and model):
        raise HTTPException(400, "未配置 LLM（个人中心填写 url + apikey + model）")
    try:
        resp = _requests.post(
            f"{base.rstrip('/')}/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
            json={"model": model, "messages": body.messages,
                  "temperature": body.temperature, "max_tokens": body.maxTokens},
            timeout=120)
    except Exception as e:
        raise HTTPException(502, f"LLM 接口不可达: {e}")
    if not resp.ok:
        raise HTTPException(502, f"LLM 接口 {resp.status_code}: {resp.text[:200]}")
    content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise HTTPException(502, "LLM 返回内容为空")
    return {"content": content}


# ---- 方向库 / 知识库：用户状态 KV 全量同步（前端本地逻辑不变，启动拉取 + 变更推送） ----

def _kv_get(user_id: int, k: str):
    conn = get_db()
    init_db()
    row = conn.execute("SELECT v FROM user_kv WHERE user_id=? AND k=?", (user_id, k)).fetchone()
    conn.close()
    return json.loads(row["v"]) if row else None


def _kv_put(user_id: int, k: str, v: dict):
    conn = get_db()
    conn.execute(
        "INSERT INTO user_kv (user_id, k, v) VALUES (?,?,?) "
        "ON CONFLICT(user_id, k) DO UPDATE SET v=excluded.v, updated_at=datetime('now')",
        (user_id, k, json.dumps(v, ensure_ascii=False)))
    conn.commit()
    conn.close()


@app.get("/api/me/directions")
def get_directions(user: dict = Depends(_me)):
    return _kv_get(user["user_id"], "directions") or {"directions": [], "activeId": None, "customFields": []}


@app.put("/api/me/directions")
def put_directions(body: dict = Body(...), user: dict = Depends(_me)):
    _kv_put(user["user_id"], "directions", body)
    return {"ok": True}


@app.get("/api/me/library")
def get_library(user: dict = Depends(_me)):
    return _kv_get(user["user_id"], "library") or {"items": [], "collections": ["方法参考", "待精读"]}


@app.put("/api/me/library")
def put_library(body: dict = Body(...), user: dict = Depends(_me)):
    _kv_put(user["user_id"], "library", body)
    return {"ok": True}


@app.post("/api/projects/{pid}/corpus/upload")
async def upload_corpus_pdfs(pid: str, files: list[UploadFile] = File(...), user: dict = Depends(_me)):
    """手动上传 PDF 补齐语料（用户裁决：付费墙论文用户自己搞，此处收尾入账）。
    匹配优先级：文件名前缀 4 位数字 = record_id（替换同名占位 txt）→ 标题包含匹配
    download_ready → 匹配不到作为新论文登记（title=文件名）。全部落 papers/ 目录并
    upsert corpus_papers（status=downloaded）。"""
    import re as _re
    import shutil as _shutil
    _own_project(pid, user)
    ws = _wm(pid)
    papers_dir = ws / "retrieval_workspace" / "papers"
    ready_csv = ws / "retrieval_workspace" / "download" / "download_ready.csv"
    papers_dir.mkdir(parents=True, exist_ok=True)

    # download_ready 索引：record_id → 行；title_norm → 行
    ready_by_rid: dict[str, dict] = {}
    ready_by_title: dict[str, dict] = {}

    def _norm_t(t: str) -> str:
        return _re.sub(r"[^a-z0-9]+", "", (t or "").lower())

    if ready_csv.exists():
        import csv as _csv
        with open(ready_csv, encoding="utf-8-sig", newline="") as fh:
            for row in _csv.DictReader(fh):
                rid = "".join(c for c in (row.get("record_id") or "") if c.isdigit())
                if rid:
                    ready_by_rid[f"{int(rid):04d}"] = row
                nt = _norm_t(row.get("title") or "")
                if nt and nt not in ready_by_title:
                    ready_by_title[nt] = row

    result = {"matched": 0, "added": 0, "failed": 0, "detail": []}
    conn = get_db()
    for f in files:
        name = Path(f.filename or "paper.pdf").name
        data = await f.read()
        if len(data) < 1024 or data[:4] != b"%PDF":
            result["failed"] += 1
            result["detail"].append({"file": name, "note": "不是有效 PDF"})
            continue
        stem = name.rsplit(".", 1)[0]
        m = _re.match(r"^(\d{4})", stem)
        row = ready_by_rid.get(m.group(1)) if m else None
        how = "record_id 匹配（占位替换）" if row else None
        if row is None:
            nt = _norm_t(stem)
            for t, r in ready_by_title.items():
                if nt and (nt in t or t in nt):
                    row, how = r, "标题匹配"
                    break
        if row:
            rid_key = "".join(c for c in row["record_id"] if c.isdigit())
            dest = papers_dir / f"{int(rid_key):04d}_{_re.sub(r'[^\w\-]+', '_', (row.get('title') or 'paper')[:60]).strip('_')}.pdf"
            # 删占位 txt（命名可能不同：按 rid 前缀扫）
            for old in papers_dir.glob(f"{int(rid_key):04d}*.txt"):
                old.unlink(missing_ok=True)
            dest.write_bytes(data)
            conn.execute(
                "INSERT INTO corpus_papers (project_id, doi, title, venue, year, url, abstract, source, status, pdf_path, record_id)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id, doi, title)"
                " DO UPDATE SET status='downloaded', pdf_path=excluded.pdf_path",
                (pid, row.get("doi") or "", row.get("title") or "", row.get("venue") or "",
                 row.get("year") or "", row.get("url") or "", "", "manual",
                 "downloaded", str(dest), row.get("record_id") or ""))
            result["matched"] += 1
            result["detail"].append({"file": name, "note": how})
        else:
            # 新论文登记（title=文件名）
            dest = papers_dir / f"manual_{_re.sub(r'[^\w\-]+', '_', stem[:60])}.pdf"
            dest.write_bytes(data)
            conn.execute(
                "INSERT INTO corpus_papers (project_id, doi, title, venue, year, url, abstract, source, status, pdf_path, record_id)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id, doi, title)"
                " DO UPDATE SET status='downloaded', pdf_path=excluded.pdf_path",
                (pid, "", stem.replace("_", " "), "", "", "", "", "manual_upload",
                 "downloaded", str(dest), ""))
            result["added"] += 1
            result["detail"].append({"file": name, "note": "新论文入库（未匹配占位）"})
    conn.commit()
    conn.close()
    return result


@app.get("/api/projects/{pid}/kg")
def get_kg(pid: str, user: dict = Depends(_me)):
    _own_project(pid, user)
    """KG 图谱数据：读 W2-P3 产物 paper_kg.json（{papers, nodes, edges}）。"""
    p = _wm(pid) / "knowledge_graph" / "paper_kg.json"
    if not p.exists():
        raise HTTPException(404, f"KG not built for {pid}（W2 未完成）")
    data = json.loads(p.read_text(encoding="utf-8"))
    # 论文也是图节点（Obsidian 式枢纽）：paper_kg.json 的 nodes 只含六类概念，论文在 papers 列表
    nodes = [{"id": pp.get("paper_id"), "type": "Paper",
              "label": pp.get("title") or pp.get("paper_id"),
              "description": (pp.get("summary") or "")[:200]}
             for pp in data.get("papers", []) if pp.get("paper_id")]
    nodes += [{"id": n.get("node_id"), "type": n.get("node_type", "Method"),
               "label": n.get("canonical_name") or n.get("title") or n.get("node_id"),
               "description": n.get("description", "")}
              for n in data.get("nodes", []) if n.get("node_id")]
    edges = [{"source": e.get("source_id"), "target": e.get("target_id"),
              "type": e.get("edge_type") or e.get("relation") or "related",
              "confidence": e.get("confidence")}
             for e in data.get("edges", []) if e.get("source_id") and e.get("target_id")]
    return {"nodes": nodes, "edges": edges,
            "paperCount": len(data.get("papers", []))}


@app.get("/api/projects/{pid}/rqs")
def get_rqs(pid: str, user: dict = Depends(_me)):
    _own_project(pid, user)
    """RQ 体系：读 W3 产物 analyze_report/rq_evidence_matrix.json → 前端 RQBundle 契约。"""
    matrix_path = _wm(pid) / "analyze_report" / "rq_evidence_matrix.json"
    if not matrix_path.exists():
        raise HTTPException(404, f"W3 not run for {pid}（analyze_report 缺失）")
    m = json.loads(matrix_path.read_text(encoding="utf-8"))

    def _level(ans: dict, n_papers: int) -> str:
        if ans.get("intercept") or n_papers < 2:
            return "blocked"
        score = float(ans.get("answerability_score") or 0)
        return "strong" if score >= 0.85 or n_papers >= 3 else "weak"

    macros: dict[str, dict] = {}
    order: list[str] = []
    for e in m.get("sub_rq_matrix", []):
        rq_id = e.get("rq_id") or ""
        if rq_id not in macros:
            macros[rq_id] = {"id": rq_id, "text": e.get("rq_text", ""), "subs": []}
            order.append(rq_id)
        ans = e.get("answerability") or {}
        qp = e.get("query_plan") or {}
        sec = e.get("section_assignment") or {}
        paper_ids = e.get("paper_ids_ranked") or []
        subs = macros[rq_id]["subs"]
        subs.append({
            "id": e.get("sub_rq_id"),
            "text": e.get("sub_rq_text", ""),
            "score": float(ans.get("answerability_score") or 0),
            "level": _level(ans, len(paper_ids)),
            "paperIds": paper_ids,
            "kgNodeCount": len(e.get("node_ids") or []),
            "kgEdgeCount": len(e.get("edge_ids") or []),
            "section": (sec.get("subsection_id") or "").replace("section_", "").replace("_", "."),
            "summary": qp.get("intent_summary", ""),
            "query": {
                "queryIntent": qp.get("intent_summary", ""),
                "focusTerms": qp.get("focus_terms") or [],
                "nodeTypes": qp.get("node_type_hints") or [],
                "edgeTypes": qp.get("edge_type_hints") or [],
                "candidatePaths": [str(p) for p in (qp.get("path_patterns") or [])][:6],
            },
            "revisionNote": e.get("recommended_action", ""),
        })
    macros_list = [macros[k] for k in order]
    n_papers = sum(len(s.get("paperIds") or []) for mc in macros_list for s in mc["subs"])

    # 证据论文元数据：卡片（作者/年份/venue/url）+ download_ready.csv（DOI）
    cards_dir = _wm(pid) / "paper_cards" / "parsed"
    doi_by_rid: dict[int, str] = {}
    ready_csv = _wm(pid) / "retrieval_workspace" / "download" / "download_ready.csv"
    if ready_csv.exists():
        import csv as _csv
        with open(ready_csv, encoding="utf-8-sig", newline="") as fh:
            for row in _csv.DictReader(fh):
                try:
                    doi_by_rid[int(row.get("record_id", 0))] = (row.get("doi") or "").strip()
                except ValueError:
                    continue
    evidence = []
    for cf in sorted(cards_dir.glob("*.json")) if cards_dir.exists() else []:
        try:
            c = json.loads(cf.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        pid_str = str(c.get("paper_id") or cf.stem)
        authors = c.get("authors")
        if isinstance(authors, list):
            authors = "; ".join(map(str, authors))
        url = str(c.get("url") or "")
        mx = re.search(r"arxiv\.org/(?:abs|pdf)/([^\s/?#]+)", url)
        arxiv_id = mx.group(1) if mx else ""
        rid = "".join(ch for ch in pid_str[:4] if ch.isdigit())
        doi = doi_by_rid.get(int(rid), "") if rid else ""
        evidence.append({
            "id": pid_str, "title": c.get("title", ""), "venue": c.get("venue", ""),
            "year": c.get("year"), "authors": (authors or "")[:300],
            "arxivId": arxiv_id, "doi": doi,
        })
    ev_by_id = {e["id"]: e for e in evidence}

    return {
        "macros": macros_list,
        "matrix": {"frozenAt": m.get("generated_at", "")},
        "overallAnswer": "",
        "claims": [],
        "evidencePapers": evidence,
        "evidenceGaps": [],
        "stats": {"macros": len(macros_list), "subs": sum(len(x["subs"]) for x in macros_list),
                  "paperMentions": n_papers},
    }



@app.get("/api/projects/{pid}/survey-pdf")
def get_survey_pdf(pid: str, user: dict = Depends(_me)):
    """W5 综述论文 PDF 预览（浏览器原生查看器）。"""
    _own_project(pid, user)
    pdf = _wm(pid) / "survey_paper" / "main.pdf"
    if not pdf.exists():
        raise HTTPException(404, f"survey PDF not compiled for {pid}")
    from fastapi.responses import FileResponse
    return FileResponse(str(pdf), media_type="application/pdf", filename=f"{pid}-survey.pdf")


@app.get("/api/projects/{pid}/report")
def get_project_report(pid: str, user: dict = Depends(_me)):
    """报告页：W3 大纲（OutlineNode 树）+ W3 两轮评审/W5 自审（ReviewRound）。"""
    _own_project(pid, user)
    ar = _wm(pid) / "analyze_report"
    if not (ar / "survey_outline.json").exists():
        raise HTTPException(404, f"W3 not run for {pid}（大纲缺失）")

    outline_data = json.loads((ar / "survey_outline.json").read_text(encoding="utf-8"))
    outline = []
    for sec in outline_data.get("sections", []):
        subs = []
        for sub in sec.get("subsections", []):
            subs.append({
                "id": sub.get("subsection_id", ""),
                "title": sub.get("subsection_title", ""),
                "rq": sub.get("sub_rq", ""),
                "papers": len(sub.get("paper_ids") or []),
            })
        outline.append({
            "id": sec.get("section_id", ""),
            "title": sec.get("title", ""),
            "rq": sec.get("macro_rq", ""),
            "papers": sum(x["papers"] for x in subs) or len(sec.get("paper_ids") or []),
            "children": subs,
        })

    def _bullets(md_path: Path) -> list[str]:
        out = []
        try:
            for line in md_path.read_text(encoding="utf-8").splitlines():
                t = line.strip()
                if t.startswith(("- ", "* ")) and len(t) > 4:
                    out.append(t.lstrip("-* ").strip())
        except OSError:
            pass
        return out[:12]

    reviews = []
    for i, name in enumerate(["review/main_round1.md", "review/main_round2.md", "WORKFLOW5_SELF_REVIEW.md"], 1):
        f = _wm(pid) / "analyze_report" / name if "SELF" in name else ar / name
        if not f.exists():
            continue
        text = f.read_text(encoding="utf-8")
        verdict = "已完成"
        for key in ("可交付", "需返工", "pass", "needs_revision", "No missing"):
            if key in text:
                verdict = key
                break
        reviews.append({"round": i, "date": time.strftime("%Y-%m-%d", time.localtime(f.stat().st_mtime)),
                        "verdict": verdict, "improvements": _bullets(f)})

    return {"outline": outline, "reviews": reviews}


@app.get("/api/projects")
def list_projects(user: dict = Depends(_me)):
    """以 projects 表为准（表驱动），目录扫描只作旧数据兜底。"""
    conn = get_db()
    user_pids = {r["project_id"] for r in conn.execute(
        "SELECT project_id FROM projects WHERE user_id=?", (user["user_id"],)).fetchall()}
    conn.close()

    projects = []
    seen: set[str] = set()

    def _load_project(cfg_path: Path, fallback_id: str) -> None:
        c = json.loads(cfg_path.read_text(encoding="utf-8"))
        pid = c.get("project_id", fallback_id)
        if pid in seen:
            return
        seen.add(pid)
        state_path = cfg_path.parent / "w1_state.json"
        status = "draft"
        if state_path.exists():
            st = json.loads(state_path.read_text(encoding="utf-8"))
            statuses = [p.get("status") for p in st.get("phases", [])]
            if "running" in statuses:
                status = "running"
            elif statuses and all(x == "done" for x in statuses if x):
                status = "completed"
            elif "failed" in statuses:
                status = "failed"
        projects.append({
            "project_id": pid,
            "title": c.get("title", fallback_id),
            "status": status,
            "field_tags": c.get("field_tags", []),
            "description": c.get("description", ""),
            "search_cap": c.get("search_cap", 2000),
            "corpus_cap": c.get("corpus_cap", 500),
            "prescore": c.get("prescore", 0.25),
            "year_range": c.get("year_range", [2020, 2026]),
            "seed_dir": c.get("seed_dir", ""),
            "local_dir": c.get("local_dir", ""),
            "updated_at": c.get("created_at", ""),
        })

    # 1) 表驱动：新布局项目（u{uid}/{pid}/w1）
    for pid in sorted(user_pids):
        cfg_path = _wm(pid) / "w1_config.json"
        if cfg_path.exists():
            _load_project(cfg_path, pid)

    # 2) 旧布局兜底：表里没有但目录存在的（补登记）
    if WORKSPACE.exists():
        for d in sorted(WORKSPACE.iterdir()):
            cfg_path = d / "w1" / "w1_config.json"
            if cfg_path.exists():
                c = json.loads(cfg_path.read_text(encoding="utf-8"))
                pid = c.get("project_id", d.name)
                if pid not in user_pids:
                    continue
                if pid not in seen:
                    _load_project(cfg_path, pid)
                # 补登记进表（此后走表驱动）
                conn = get_db()
                conn.execute(
                    "INSERT OR IGNORE INTO projects (project_id, user_id, title, workspace_rel) VALUES (?,?,?,?)",
                    (pid, user["user_id"], c.get("title", d.name), f"{d.name}/w1"))
                conn.commit()
                conn.close()
    # 前端 Project 类型（camelCase 裸数组）：id/fieldTags/status/createdAt/updatedAt + stats
    conn = get_db()
    kg_stats = {}
    for pr in projects:
        n = conn.execute("SELECT COUNT(*) c FROM corpus_papers WHERE project_id=? AND status='downloaded'",
                         (pr["project_id"],)).fetchone()["c"]
        kgj = _wm(pr["project_id"]) / "knowledge_graph" / "paper_kg.json"
        edges = 0
        if kgj.exists():
            try:
                edges = len(json.loads(kgj.read_text(encoding="utf-8")).get("edges", []))
            except Exception:
                edges = 0
        kg_stats[pr["project_id"]] = {"papers": n, "kgEdges": edges}
    conn.close()

    def _wf(pid: str, wid: str, name: str, state_file: str, total: int) -> dict:
        sp = _wm(pid) / state_file
        prog, status = 0, "pending"
        if sp.exists():
            try:
                ph = [q.get("status") for q in json.loads(sp.read_text(encoding="utf-8")).get("phases", [])]
                prog = round(100 * sum(1 for x in ph if x == "done") / max(total, 1))
                status = "running" if "running" in ph else ("failed" if "failed" in ph else ("completed" if all(x == "done" for x in ph) else "draft"))
            except Exception:
                pass
        return {"id": wid, "name": name, "status": status, "progress": prog}

    wf_summaries = {}
    for pr in projects:
        pid = pr["project_id"]
        wf_summaries[pid] = [
            _wf(pid, "W1", "语料库构建", "w1_state.json", 6),
            _wf(pid, "W2", "事实记忆(KG)", "w2_state.json", 4),
            _wf(pid, "W3", "框架与RQ", "w3_state.json", 7),
            _wf(pid, "W4", "RQ证据", "w4_state.json", 4),
            _wf(pid, "W5", "综述写作", "w5_state.json", 3),
        ]

    return [{
        "id": pr["project_id"],
        "title": pr["title"],
        "fieldTags": pr["field_tags"],
        "description": pr["description"],
        "status": pr["status"],
        "searchCap": pr["search_cap"],
        "corpusCap": pr["corpus_cap"],
        "yearRange": pr["year_range"],
        "updatedAt": pr["updated_at"],
        "stats": {
            "papers": kg_stats[pr["project_id"]]["papers"],
            "kgEdges": kg_stats[pr["project_id"]]["kgEdges"],
            "rqs": 0,
            "claims": {"verified": 0, "needsRevision": 0, "shouldRemove": 0},
        },
        "workflows": wf_summaries.get(pr["project_id"], []),
    } for pr in projects]



def _corpus_live(pid: str, page: int, page_size: int, status: str) -> dict:
    """W1-P6 下载中的语料实时视图：download_ready 清单 × papers/ 目录状态。
    status: downloaded=已下好 PDF / failed=占位待人工 / pending=处理中。"""
    import csv as _csv
    ws = _wm(pid)
    ready = list(_csv.DictReader(
        open(ws / "retrieval_workspace" / "download" / "download_ready.csv",
             encoding="utf-8-sig")))
    papers_dir = ws / "retrieval_workspace" / "papers"
    pdf_rids: set[str] = set()
    txt_rids: set[str] = set()
    if papers_dir.exists():
        for f in papers_dir.iterdir():
            rid = f.name[:4]
            if not rid.isdigit():
                continue
            (pdf_rids if f.suffix.lower() == ".pdf" else txt_rids).add(rid)

    rows = []
    for i, r in enumerate(ready, 1):
        rid = f"{i:04d}"
        m = re.match(r"^(\d+)", r.get("record_id") or "")
        if m:
            rid = f"{int(m.group(1)):04d}"
        if rid in pdf_rids:
            st = "downloaded"
        elif rid in txt_rids:
            st = "failed"
        else:
            st = "pending"
        rows.append({"rid": rid, "title": r.get("title") or "", "doi": r.get("doi") or "",
                     "venue": r.get("venue") or "", "year": r.get("year") or "", "status": st})

    counts = {"downloaded": 0, "failed": 0, "pending": 0}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    if status:
        rows = [r for r in rows if r["status"] == status]
    total = len(rows)
    page_rows = rows[(page - 1) * page_size: page * page_size]
    papers = [{
        "id": r["doi"] or r["rid"],
        "title": r["title"],
        "authors": "",
        "venue": r["venue"],
        "year": int(r["year"] or 0),
        "citations": 0,
        "stage": "已纳入" if r["status"] == "downloaded" else "可获取性",
        "abstract": "",
        "status": r["status"],
        "pdfPath": "",
        "card": {"problems": [], "methods": [], "datasets": [], "metrics": [],
                 "limitations": [], "assumptions": []},
    } for r in page_rows]
    funnel = [
        {"stage": "下载就绪", "count": len(ready), "note": "download_ready 清单（实时）"},
        {"stage": "成功下载", "count": counts["downloaded"], "note": "PDF 已落盘，可开 W2"},
        {"stage": "需要人工", "count": counts["failed"], "note": "付费墙占位——手动上传 PDF 补齐"},
        {"stage": "处理中", "count": counts["pending"], "note": "下载器队列中"},
    ]
    return {"papers": papers, "funnel": funnel, "total": total,
            "page": page, "pageSize": page_size, "live": True}


# 前端静态托管：必须在所有 API 路由注册完之后，否则 Mount("/") 会抢在 API 路由之前匹配
from fastapi.staticfiles import StaticFiles  # noqa: E402

_dist_dir = Path(__file__).resolve().parents[2] / "dist"
if _dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(_dist_dir), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
