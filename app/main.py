"""FastAPI 앱: 로컬 웹 UI + REST API."""
import json
import logging
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import company as company_svc
from . import db, extra, ingest, llm, maintenance, profile, rag, setup, usage, writer
from .config import BASE_DIR, settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger("app")
db.init()
maintenance.normalize_hangul()
app = FastAPI(title="자기소개서 작성 도우미")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

CATEGORIES = ["이력서", "자기소개서", "포트폴리오", "프로젝트", "논문", "경험/활동", "기타"]


_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", settings.host}


@app.middleware("http")
async def local_only(request: Request, call_next):
    """이 PC의 브라우저에서 온 요청만 허용 (.env 수정 API를 다른 웹사이트가 호출하지 못하게 차단).
    - Host 검사: DNS rebinding 방지
    - Origin 검사: 다른 사이트에서 보낸 POST/PUT/DELETE 차단
    """
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
    if host not in _LOCAL_HOSTS:
        return JSONResponse(status_code=403, content={"detail": "로컬에서만 접속할 수 있습니다."})
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and urlparse(origin).hostname not in _LOCAL_HOSTS:
            return JSONResponse(status_code=403, content={"detail": "허용되지 않은 요청 출처입니다."})
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        # 코드 업데이트 후 브라우저가 예전 JS/CSS를 쓰지 않도록 매번 재검증 (변경 없으면 304로 가볍게 응답)
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(llm.LLMError)
async def _llm_error(_, exc: llm.LLMError):
    log.warning("OpenAI 오류: %s", exc)
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(Exception)
async def _unexpected_error(request: Request, exc: Exception):
    # 예상 못 한 오류도 화면에 이유를 보여주고, 터미널에 전체 로그를 남긴다
    log.exception("처리 중 오류: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"서버 처리 중 오류가 발생했습니다: {type(exc).__name__}: {exc}"})


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/config")
def get_config():
    return {
        "api_key_set": settings.api_key_ok,
        "admin_key_set": bool(settings.openai_admin_key),
        "writer_model": settings.writer_model,
        "analyzer_model": settings.analyzer_model,
        "utility_model": settings.utility_model,
        "embedding_model": settings.embedding_model,
        "models": list(dict.fromkeys([settings.writer_model, *settings.available_models])),
        "pii_masking": settings.pii_masking,
        "pii_custom_terms_count": len(settings.pii_custom_terms),
        "categories": CATEGORIES,
        "usd_krw": settings.usd_krw,
        "monthly_budget_usd": settings.monthly_budget_usd,
        "reasoning_effort": settings.reasoning_effort,
        "pricing": llm.pricing()["models"],
        "web_search_per_call": llm.pricing()["web_search_per_call"],
    }


# ---------------- 초기 설정 (.env) ----------------

@app.get("/api/setup")
def get_setup():
    state = setup.get_state()
    state["pricing"] = llm.pricing()["models"]
    return state


@app.put("/api/setup")
def save_setup(body: dict):
    try:
        state = setup.save(body.get("values") or {})
    except setup.SetupError as e:
        raise HTTPException(400, str(e))
    state["pricing"] = llm.pricing()["models"]
    return state


class KeyTestIn(BaseModel):
    key: str | None = None
    models: list[str] = []


@app.post("/api/setup/test-key")
def test_key(body: KeyTestIn):
    return setup.test_api_key(body.key, body.models)


@app.post("/api/setup/test-admin-key")
def test_admin_key(body: KeyTestIn):
    return setup.test_admin_key(body.key)


# ---------------- 자료 (RAG) ----------------

def _store_document(name: str, source_type: str, source: str, category: str, text: str,
                    warnings: list[str] | None = None) -> dict:
    doc_id = db.new_id()
    (settings.raw_dir / f"{doc_id}.txt").write_text(text, encoding="utf-8")
    try:
        n = rag.index_document(doc_id, name, category, text)
    except Exception:
        (settings.raw_dir / f"{doc_id}.txt").unlink(missing_ok=True)
        rag.delete_document(doc_id)
        raise
    db.execute(
        "INSERT INTO documents(id, name, source_type, source, category, chunk_count, char_count, enabled, note, created_at)"
        " VALUES (?,?,?,?,?,?,?,1,?,?)",
        (doc_id, name, source_type, source, category, n, len(text), "\n".join(warnings or []) or None, db.now()),
    )
    return db.row("SELECT * FROM documents WHERE id=?", (doc_id,))


@app.get("/api/documents")
def list_documents():
    return db.rows("SELECT * FROM documents ORDER BY created_at DESC")


@app.post("/api/documents/upload")
def upload_documents(files: list[UploadFile] = File(...), category: str = Form("기타")):
    added, errors = [], []
    for f in files:
        try:
            text, warnings = ingest.extract_file(f.filename, f.file.read())
            added.append(_store_document(ingest.clean_name(f.filename), "file", f.filename, category, text, warnings))
        except (ingest.IngestError, llm.LLMError) as e:
            errors.append({"file": f.filename, "error": str(e)})
        except Exception as e:  # noqa: BLE001
            errors.append({"file": f.filename, "error": f"처리 실패: {e}"})
    return {"added": added, "errors": errors}


class UrlIn(BaseModel):
    url: str
    category: str = "포트폴리오"
    name: str | None = None


@app.post("/api/documents/url")
def add_url(body: UrlIn):
    try:
        title, text = ingest.fetch_url(body.url.strip())
    except ingest.IngestError as e:
        raise HTTPException(400, str(e))
    return _store_document(body.name or title, "url", body.url.strip(), body.category, text)


class TextIn(BaseModel):
    name: str
    text: str
    category: str = "경험/활동"


@app.post("/api/documents/text")
def add_text(body: TextIn):
    if len(body.text.strip()) < 20:
        raise HTTPException(400, "내용이 너무 짧습니다.")
    return _store_document(ingest.nfc(body.name.strip()) or "직접 입력", "text", "", body.category, ingest.nfc(body.text.strip()))


class DocPatch(BaseModel):
    enabled: bool | None = None
    category: str | None = None
    name: str | None = None


@app.patch("/api/documents/{doc_id}")
def patch_document(doc_id: str, body: DocPatch):
    doc = db.row("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not doc:
        raise HTTPException(404)
    if body.enabled is not None:
        db.execute("UPDATE documents SET enabled=? WHERE id=?", (int(body.enabled), doc_id))
    if body.category or body.name:
        name, cat = body.name or doc["name"], body.category or doc["category"]
        db.execute("UPDATE documents SET name=?, category=? WHERE id=?", (name, cat, doc_id))
        rag.update_metadata(doc_id, name, cat)
    return db.row("SELECT * FROM documents WHERE id=?", (doc_id,))


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    rag.delete_document(doc_id)
    (settings.raw_dir / f"{doc_id}.txt").unlink(missing_ok=True)
    db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    return {"ok": True}


@app.get("/api/documents/{doc_id}/chunks")
def document_chunks(doc_id: str):
    return {"chunks": rag.get_chunks(doc_id)}


@app.post("/api/documents/{doc_id}/reindex")
def reindex_document(doc_id: str):
    doc = db.row("SELECT * FROM documents WHERE id=?", (doc_id,))
    raw = settings.raw_dir / f"{doc_id}.txt"
    if not doc or not raw.exists():
        raise HTTPException(404, "원본 텍스트가 없습니다.")
    n = rag.index_document(doc_id, doc["name"], doc["category"], raw.read_text(encoding="utf-8"))
    db.execute("UPDATE documents SET chunk_count=? WHERE id=?", (n, doc_id))
    maintenance.clear_nfc_note(doc_id)
    return db.row("SELECT * FROM documents WHERE id=?", (doc_id,))


@app.post("/api/search")
def test_search(body: dict):
    return {"results": rag.search([body.get("query", "")])}


# ---------------- 기업 분석 ----------------

class CompanyIn(BaseModel):
    name: str
    position: str = ""
    jd: str = ""
    notes: str = ""
    urls: list[str] = []
    web_search: bool = True


@app.get("/api/companies")
def list_companies():
    return [db.get_company(r["id"]) for r in db.rows("SELECT id FROM companies ORDER BY updated_at DESC")]


@app.post("/api/companies/analyze")
def analyze_company(body: CompanyIn):
    if not body.name.strip():
        raise HTTPException(400, "회사명을 입력하세요.")
    return company_svc.analyze(body.name.strip(), body.position.strip(), body.jd, body.notes, body.web_search, body.urls)


class CompanyUpdate(BaseModel):
    name: str | None = None
    position: str | None = None
    system_prompt: str | None = None
    profile: dict | None = None


@app.put("/api/companies/{cid}")
def update_company(cid: str, body: CompanyUpdate):
    c = db.get_company(cid)
    if not c:
        raise HTTPException(404)
    db.execute(
        "UPDATE companies SET name=?, position=?, system_prompt=?, profile_json=?, updated_at=? WHERE id=?",
        (body.name or c["name"], body.position if body.position is not None else c["position"],
         body.system_prompt if body.system_prompt is not None else c["system_prompt"],
         json.dumps(body.profile if body.profile is not None else c["profile"], ensure_ascii=False),
         db.now(), cid),
    )
    return db.get_company(cid)


@app.post("/api/companies/{cid}/regenerate")
def regenerate_company_prompt(cid: str):
    try:
        return company_svc.regenerate_prompt(cid)
    except KeyError:
        raise HTTPException(404)


@app.delete("/api/companies/{cid}")
def delete_company(cid: str):
    db.execute("DELETE FROM companies WHERE id=?", (cid,))
    db.execute("UPDATE sessions SET company_id=NULL WHERE company_id=?", (cid,))
    return {"ok": True}


# ---------------- 작성 세션 ----------------

class SessionIn(BaseModel):
    title: str = "새 문항"
    company_id: str | None = None
    question: str = ""
    char_min: int | None = None
    char_limit: int | None = None
    model: str | None = None


@app.get("/api/sessions")
def list_sessions():
    return db.rows(
        "SELECT s.*, c.name AS company_name FROM sessions s LEFT JOIN companies c ON c.id=s.company_id"
        " ORDER BY s.created_at, s.rowid")  # 새 문항은 목록 아래에 추가


def _check_range(body: SessionIn):
    if body.char_min is not None and body.char_limit is not None and body.char_min > body.char_limit:
        raise HTTPException(400, "최소 글자수가 최대 글자수보다 클 수 없습니다.")


@app.post("/api/sessions")
def create_session(body: SessionIn):
    _check_range(body)
    sid, ts = db.new_id(), db.now()
    db.execute(
        "INSERT INTO sessions(id, title, company_id, question, char_min, char_limit, model, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (sid, body.title, body.company_id or None, body.question, body.char_min, body.char_limit,
         body.model or settings.writer_model, ts, ts),
    )
    return db.row("SELECT * FROM sessions WHERE id=?", (sid,))


@app.put("/api/sessions/{sid}")
def update_session(sid: str, body: SessionIn):
    _check_range(body)
    db.execute(
        "UPDATE sessions SET title=?, company_id=?, question=?, char_min=?, char_limit=?, model=?, updated_at=? WHERE id=?",
        (body.title, body.company_id or None, body.question, body.char_min, body.char_limit,
         body.model or settings.writer_model, db.now(), sid),
    )
    return db.row("SELECT * FROM sessions WHERE id=?", (sid,))


@app.delete("/api/sessions/{sid}")
def delete_session(sid: str):
    db.execute("DELETE FROM messages WHERE session_id=?", (sid,))
    db.execute("DELETE FROM sessions WHERE id=?", (sid,))
    return {"ok": True}


@app.get("/api/sessions/{sid}/messages")
def session_messages(sid: str):
    return db.get_messages(sid)


@app.delete("/api/sessions/{sid}/messages")
def clear_messages(sid: str):
    db.execute("DELETE FROM messages WHERE session_id=?", (sid,))
    return {"ok": True}


class ChatIn(BaseModel):
    message: str = ""
    action: str = "chat"


@app.post("/api/sessions/{sid}/chat")
def chat(sid: str, body: ChatIn):
    if body.action == "chat" and not body.message.strip():
        raise HTTPException(400, "메시지를 입력하세요.")
    return StreamingResponse(writer.chat(sid, body.message.strip(), body.action), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------- 마스터 프로필 ----------------

@app.get("/api/profile")
def list_profile():
    return {"entries": profile.list_entries(), "presets": profile.SECTION_PRESETS, "subtopics": profile.SUBTOPIC_PRESETS}


@app.post("/api/profile")
def create_profile_entry(body: dict):
    try:
        return profile.save(body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/api/profile/{entry_id}")
def update_profile_entry(entry_id: str, body: dict):
    if not profile.get(entry_id):
        raise HTTPException(404)
    try:
        return profile.save(body, entry_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/profile/{entry_id}")
def delete_profile_entry(entry_id: str):
    profile.delete(entry_id)
    return {"ok": True}


@app.post("/api/profile/extract")
def extract_profile(body: dict):
    try:
        return profile.extract(body.get("doc_ids") or [])
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/profile/import")
def import_profile(body: dict):
    return profile.import_entries(body.get("entries") or [])


@app.post("/api/profile/reindex")
def reindex_profile():
    return profile.reindex_all()


# ---------------- 기타 문항 작성 ----------------

@app.get("/api/extra")
def list_extra():
    return extra.list_records()


@app.get("/api/extra/{rec_id}")
def get_extra(rec_id: str):
    rec = extra.get(rec_id)
    if not rec:
        raise HTTPException(404)
    return rec


@app.post("/api/extra")
def create_extra(body: dict):
    try:
        return extra.create(body)
    except ValueError as e:
        raise HTTPException(400, str(e))


class ExtraRegenIn(BaseModel):
    label: str
    instruction: str = ""


@app.post("/api/extra/{rec_id}/regenerate")
def regenerate_extra(rec_id: str, body: ExtraRegenIn):
    try:
        return extra.regenerate(rec_id, body.label, body.instruction)
    except KeyError:
        raise HTTPException(404)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/api/extra/{rec_id}")
def update_extra(rec_id: str, body: dict):
    try:
        return extra.update_results(rec_id, body.get("results") or {})
    except KeyError:
        raise HTTPException(404)


@app.delete("/api/extra/{rec_id}")
def delete_extra(rec_id: str):
    extra.delete(rec_id)
    return {"ok": True}


# ---------------- 사용량 ----------------

@app.get("/api/usage")
def usage_summary():
    return usage.summary()


@app.get("/api/usage/official")
def usage_official():
    return usage.official()
