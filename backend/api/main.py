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

from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from db.database import get_db, init_db
from db.crypto import encrypt, decrypt, mask_key
from api.auth import router as auth_router, get_current_user
from fastapi import Header
from fastapi import Body
import requests as _requests

BACKEND_DIR = Path(__file__).resolve().parents[1]
WORKSPACE = Path(os.environ.get("AS_WORKSPACE", str(BACKEND_DIR / "wm")))
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


def _spawn_runner(pid: str, workflow: str = "w1") -> None:
    ws = _wm(pid)
    ws.mkdir(parents=True, exist_ok=True)
    log_path = ws / f"runner_{workflow}.log"
    log = open(log_path, "ab")
    subprocess.Popen(
        [sys.executable, str(RUNNER), "--config", str(ws / "w1_config.json"),
         "--workflow", workflow, "--resume"],
        stdout=log, stderr=subprocess.STDOUT, cwd=str(ws),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "workspace": str(WORKSPACE)}


@app.post("/api/projects")
def create_project(body: dict, user: dict = Depends(_me)):
    """创建项目并写入 w1_config.json（绑定当前登录用户）。"""
    pid = f"proj-{int(time.time() * 1000)}"
    uid = user["user_id"]
    workspace_rel = f"u{uid}/{pid}/w1"
    ws = WORKSPACE / workspace_rel
    ws.mkdir(parents=True, exist_ok=True)
    cfg = {
        "project_id": pid, "title": body.get("title", ""),
        "topic": body.get("title", ""),                 # phase_defs P4 筛选主题
        "domain_tags": body.get("field_tags", []),      # phase_defs P1 关键词领域
        "field_tags": body.get("field_tags", []),
        "description": body.get("description", ""),
        "platforms": body.get("platforms", []),
        "search_cap": body.get("search_cap", 2000),
        "corpus_cap": body.get("corpus_cap", 500),
        "prescore": body.get("prescore", 0.25),
        "year_range": body.get("year_range", [2020, 2026]),
        "seed_dir": body.get("seed_dir", ""), "local_dir": body.get("local_dir", ""),
        "llm": body.get("llm", {}),
        # 存量脚本根目录：前端契约不含此字段，默认本地 autoSurvey_v2（可用 AS_SCRIPTS_ROOT 覆盖）
        "scripts_root": body.get("scripts_root") or os.environ.get(
            "AS_SCRIPTS_ROOT",
            "C:/Users/85864/Documents/xwechat_files/wxid_4wveq34o7nag22_eb4c/msg/file/2026-09/autoSurvey_v2/autoSurvey_v2"),
        "workspace": str(ws),
        "workspace_rel": workspace_rel,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (ws / "w1_config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    # 项目归属写入 DB
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO projects (project_id, user_id, title, workspace_rel) VALUES (?,?,?,?)",
        (pid, uid, body.get("title", ""), workspace_rel),
    )
    conn.commit()
    conn.close()
    return {"project_id": pid}


@app.post("/api/projects/{pid}/run")
def start_run(pid: str, workflow: str = "w1"):
    """启动（或续跑）工作流。创建后项目为 draft，由此端点显式启动；--resume 跳过已完成 Phase。"""
    if workflow not in ("w1", "w2", "w3", "w4", "w5"):
        raise HTTPException(400, f"unknown workflow: {workflow}")
    if _read_config(pid) is None:
        raise HTTPException(404, f"project not found: {pid}")
    _spawn_runner(pid, workflow)
    return {"ok": True, "project_id": pid, "workflow": workflow}


@app.get("/api/projects/{pid}/run")
def get_run(pid: str, workflow: str = "w1", user: dict = Depends(_me)):
    state_path = WORKSPACE / pid / "w1" / f"{workflow}_state.json"
    if not state_path.exists():
        raise HTTPException(404, f"run not found for {pid}")
    return json.loads(state_path.read_text(encoding="utf-8"))


@app.post("/api/projects/{pid}/phases/{phase_id}/retry")
def retry_phase(pid: str, phase_id: str, workflow: str = "w1", user: dict = Depends(_me)):
    state_path = WORKSPACE / pid / "w1" / f"{workflow}_state.json"
    if not state_path.exists():
        raise HTTPException(404, f"run not found for {pid}")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    for ph in state.get("phases", []):
        if ph["id"] == phase_id:
            ph["status"] = "pending"
            break
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    _spawn_runner(pid, workflow)
    return {"ok": True, "phase_id": phase_id}


@app.get("/api/projects/{pid}/corpus")
def get_corpus(pid: str, user: dict = Depends(_me)):
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


def _me(authorization: str = Header(default="")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    user = get_current_user(token)
    if not user:
        raise HTTPException(401, "未登录或会话过期")
    return user


# ---- 个人 API Key（Fernet 加密 at rest，接口只回掩码） ----

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


# ---- LLM 接入配置（按使用点细分：环节专属 → default 兜底；Fernet 加密存储） ----

LLM_USE_CASES = [
    {"id": "default", "label": "全局默认", "stage": "所有未单独配置的环节"},
    {"id": "w2.extract", "label": "W2 结构化提取", "stage": "W2-P1 六类对象提取"},
    {"id": "w2.relation", "label": "W2 论文对关系", "stage": "W2-P3 关系判断（量大，可用便宜模型）"},
    {"id": "w2.candidate", "label": "W2 候选筛选", "stage": "W2-P2 低质量条目过滤"},
    {"id": "w1.screen", "label": "W1 筛选判断", "stage": "W1-P4 decision/reason 列"},
    {"id": "w3.gap", "label": "W3 Gap 分析", "stage": "W3-P1"},
    {"id": "w3.design", "label": "W3 RQ 设计", "stage": "W3-P2"},
    {"id": "w4.extract", "label": "W4 证据抽取", "stage": "W4-P1"},
    {"id": "w4.answer", "label": "W4 答案综合", "stage": "W4-P2"},
    {"id": "w4.claim", "label": "W4 声明核查", "stage": "W4-P3"},
    {"id": "agent.kg", "label": "Agent 单 RQ 分析", "stage": "Agent 页"},
    {"id": "direction.refine", "label": "方向精炼", "stage": "研究方向页"},
]


def resolve_llm(user_id: int, use_case: str = "default") -> tuple[str, str, str]:
    """解析链：环节专属行（Key 可解密且非空）→ default 行。返回 (base, key, model)。"""
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
            return r["base_url"], key, r["model"]
    return "", "", ""

class LlmConfigIn(BaseModel):
    baseUrl: str = ""
    apiKey: str = ""
    model: str = ""
    useCase: str = "default"


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
        out.append({**uc, "configured": ok, "baseUrl": r["base_url"] if r else "",
                    "model": r["model"] if r else "",
                    "apiKeyMasked": mask_key(key) if key else ""})
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
        "INSERT INTO llm_configs (user_id, use_case, base_url, api_key_encrypted, model) VALUES (?,?,?,?,?) "
        "ON CONFLICT(user_id, use_case) DO UPDATE SET base_url=excluded.base_url, "
        "api_key_encrypted=excluded.api_key_encrypted, model=excluded.model, updated_at=datetime('now')",
        (user["user_id"], use_case, body.baseUrl.strip(), key_enc, body.model.strip()))
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
    base, key, model = resolve_llm(user["user_id"], getattr(body, "useCase", "default") or "default")
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


@app.get("/api/projects/{pid}/kg")
def get_kg(pid: str, user: dict = Depends(_me)):
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


# 前端静态托管（dist 由 vite build 产出；挂在 API 路由之后作兜底）
from fastapi.staticfiles import StaticFiles  # noqa: E402

_dist_dir = Path(__file__).resolve().parents[2] / "dist"
if _dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(_dist_dir), html=True), name="frontend")


@app.get("/api/projects")
def list_projects(user: dict = Depends(_me)):
    # 按用户过滤：只返回该用户的项目
    conn = get_db()
    user_pids = {r["project_id"] for r in conn.execute(
        "SELECT project_id FROM projects WHERE user_id=?", (user["user_id"],)).fetchall()}
    conn.close()

    projects = []
    if WORKSPACE.exists():
        for d in sorted(WORKSPACE.iterdir()):
            cfg_path = d / "w1" / "w1_config.json"
            if cfg_path.exists():
                c = json.loads(cfg_path.read_text(encoding="utf-8"))
                if c.get("project_id", d.name) not in user_pids:
                    continue
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
            {"id": "W3", "name": "框架与RQ", "status": "pending", "progress": 0},
            {"id": "W4", "name": "RQ证据", "status": "pending", "progress": 0},
            {"id": "W5", "name": "综述写作", "status": "pending", "progress": 0},
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
