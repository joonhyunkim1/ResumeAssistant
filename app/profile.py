"""마스터 프로필: 대주제(경력·연구실적 등)별 이력 항목.

- 저장하면 RAG에 자동 등록(임베딩만 사용, 비용 극소) → 자소서 작성 검색에도 쓰인다.
- private_note(연봉 등)는 AI로 보내지 않는다.
"""
from . import db, llm, rag

SECTION_PRESETS = ["학력", "경력", "연구실적", "프로젝트", "자격증", "어학", "수상", "대외활동", "교육이수"]
# 대주제별 소주제(구분) 추천
SUBTOPIC_PRESETS = {
    "학력": ["학사", "석사", "박사"], "경력": ["정규직", "인턴", "계약직", "아르바이트"],
    "연구실적": ["논문", "특허", "학회 발표", "연구 과제"], "프로젝트": ["개인", "팀", "사내", "산학협력"],
    "대외활동": ["동아리", "봉사", "공모전", "서포터즈"], "수상": ["교내", "교외"], "자격증": ["국가기술", "민간"],
}
FIELDS = [("period", "기간"), ("org", "소속·기관"), ("role", "역할"), ("achievements", "성과·수치"), ("keywords", "기술·키워드")]
EDITABLE = ["section", "subtopic", "title", *[k for k, _ in FIELDS], "details", "private_note"]


def entry_text(e: dict) -> str:
    """AI에 보내는 형태 (private_note 제외)."""
    lines = [f"[{label(e)}] {e['title']}"]
    lines += [f"{name}: {e[key]}" for key, name in FIELDS if (e.get(key) or "").strip()]
    if (e.get("details") or "").strip():
        lines.append(f"상세 내용:\n{e['details'].strip()}")
    return "\n".join(lines)


def label(e: dict) -> str:
    """'연구실적 > 논문' 형태의 분류 표기."""
    return f"{e['section']} > {e['subtopic']}" if (e.get("subtopic") or "").strip() else e["section"]


def list_entries() -> list[dict]:
    return db.rows("SELECT * FROM profile_entries ORDER BY section, subtopic, created_at")


def get(entry_id: str | None) -> dict | None:
    return db.row("SELECT * FROM profile_entries WHERE id=?", (entry_id,)) if entry_id else None


def find(section: str, title: str) -> dict | None:
    """대주제·이름이 일치하는 항목 (공백·대소문자 무시). 소주제는 선택 칸이라 매칭에 쓰지 않는다."""
    norm = lambda s: "".join((s or "").split()).lower()
    for e in list_entries():
        if norm(e["section"]) == norm(section) and norm(e["title"]) == norm(title):
            return e
    return None


def _index(e: dict) -> str | None:
    """RAG 등록. 실패해도 항목 저장은 유지하고 경고 문구 반환."""
    try:
        rag.index_document(rag.PROFILE_PREFIX + e["id"], f"{label(e)} · {e['title']}", "마스터 프로필", entry_text(e))
        db.execute("UPDATE profile_entries SET indexed=1 WHERE id=?", (e["id"],))
        return None
    except llm.LLMError as ex:
        db.execute("UPDATE profile_entries SET indexed=0 WHERE id=?", (e["id"],))
        return f"저장은 됐지만 검색 등록에 실패했습니다: {ex}"


def save(data: dict, entry_id: str | None = None) -> dict:
    vals = {k: (data.get(k) or "").strip() for k in EDITABLE}
    if not vals["section"] or not vals["title"]:
        raise ValueError("대주제와 이름(논문명·프로젝트명·회사명 등)을 입력하세요.")
    ts = db.now()
    if entry_id:
        db.execute(f"UPDATE profile_entries SET {', '.join(f'{k}=?' for k in EDITABLE)}, updated_at=? WHERE id=?",
                   (*vals.values(), ts, entry_id))
    else:
        entry_id = db.new_id()
        db.execute(f"INSERT INTO profile_entries(id, {', '.join(EDITABLE)}, created_at, updated_at)"
                   f" VALUES (?, {', '.join('?' * len(EDITABLE))}, ?, ?)", (entry_id, *vals.values(), ts, ts))
    e = get(entry_id)
    warning = _index(e)
    return {**get(entry_id), "warning": warning}


def delete(entry_id: str):
    rag.delete_document(rag.PROFILE_PREFIX + entry_id)
    db.execute("DELETE FROM profile_entries WHERE id=?", (entry_id,))


def reindex_all() -> dict:
    fails = [w for e in list_entries() if (w := _index(e))]
    return {"count": len(list_entries()), "failed": len(fails), "error": fails[0] if fails else None}
