"""로컬 SQLite 저장소 (자료 목록, 기업 프로필, 작성 세션, 메시지, 사용량)."""
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,          -- file | url | text
    source TEXT,
    category TEXT DEFAULT '기타',
    chunk_count INTEGER DEFAULT 0,
    char_count INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    note TEXT,                          -- 추출 품질 경고
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT,
    jd TEXT,
    user_notes TEXT,
    profile_json TEXT,
    system_prompt TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company_id TEXT,
    question TEXT,
    char_limit INTEGER,
    model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta_json TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    cached_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    web_search_calls INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    priced INTEGER DEFAULT 1
);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


@contextmanager
def conn():
    c = sqlite3.connect(settings.db_path)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init():
    with conn() as c:
        c.executescript(SCHEMA)
        # 기존 DB 마이그레이션 (컬럼 추가만, 데이터는 그대로)
        cols = {r["name"] for r in c.execute("PRAGMA table_info(documents)")}
        if "note" not in cols:
            c.execute("ALTER TABLE documents ADD COLUMN note TEXT")


def rows(sql: str, params=()) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute(sql, params).fetchall()]


def row(sql: str, params=()) -> dict | None:
    with conn() as c:
        r = c.execute(sql, params).fetchone()
        return dict(r) if r else None


def execute(sql: str, params=()) -> int:
    with conn() as c:
        cur = c.execute(sql, params)
        return cur.lastrowid


# ---------- 편의 함수 ----------

def add_message(session_id: str, role: str, content: str, meta: dict | None = None) -> int:
    mid = execute(
        "INSERT INTO messages(session_id, role, content, meta_json, created_at) VALUES (?,?,?,?,?)",
        (session_id, role, content, json.dumps(meta or {}, ensure_ascii=False), now()),
    )
    execute("UPDATE sessions SET updated_at=? WHERE id=?", (now(), session_id))
    return mid


def get_messages(session_id: str) -> list[dict]:
    out = rows("SELECT * FROM messages WHERE session_id=? ORDER BY id", (session_id,))
    for m in out:
        m["meta"] = json.loads(m.pop("meta_json") or "{}")
    return out


def get_company(company_id: str | None) -> dict | None:
    if not company_id:
        return None
    c = row("SELECT * FROM companies WHERE id=?", (company_id,))
    if c:
        c["profile"] = json.loads(c.pop("profile_json") or "{}")
    return c
