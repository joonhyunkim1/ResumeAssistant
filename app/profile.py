"""마스터 프로필: 대주제(경력·연구실적 등)별 이력 항목.

- 저장하면 RAG에 자동 등록(임베딩만 사용, 비용 극소) → 자소서 작성 검색에도 쓰인다.
- private_note(연봉 등)는 AI로 보내지 않는다.
"""
import json
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from . import db, llm, pii, prompts, rag
from .config import settings

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
    norm = _norm
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
    vals = {k: unicodedata.normalize("NFC", data.get(k) or "").strip() for k in EDITABLE}
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


# ---------------- 자료에서 자동 추출 ----------------

MAX_DOC_CHARS = 15000  # 긴 자료(논문 등)는 앞부분 12,000자 + 끝부분 3,000자만 사용 (제목·초록·결론 위주)


def _doc_text(doc_id: str) -> tuple[str, bool]:
    raw = settings.raw_dir / f"{doc_id}.txt"
    text = raw.read_text(encoding="utf-8") if raw.exists() else ""
    if len(text) > MAX_DOC_CHARS:
        return text[:12000] + "\n\n...(중략)...\n\n" + text[-3000:], True
    return text, False


def _norm(s: str) -> str:
    return "".join(unicodedata.normalize("NFC", s or "").split()).lower()


def _clean_candidate(c: dict, source: str) -> dict | None:
    keys = ["section", "subtopic", "title", *[k for k, _ in FIELDS], "details"]
    e = {k: str(c.get(k) or "").strip() for k in keys}
    if not e["section"] or not e["title"]:
        return None
    e["sources"] = [source]
    return e


def _merge_into(base: dict, extra: dict) -> dict:
    """빈 칸은 채우고, 상세 내용은 겹치지 않으면 덧붙인다."""
    for k, v in extra.items():
        if k == "sources":
            base["sources"] = sorted(set(base.get("sources", []) + v))
        elif k == "details":
            if v and v not in (base.get("details") or ""):
                base["details"] = f"{base['details']}\n\n{v}".strip() if base.get("details") else v
        elif v and not (base.get(k) or "").strip():
            base[k] = v
    return base


def _extract_one(doc: dict) -> tuple[list[dict], float, str | None]:
    text, truncated = _doc_text(doc["id"])
    if len(text.strip()) < 30:
        return [], 0.0, f"'{doc['name']}': 원본 텍스트가 없어 건너뜀"
    user_input = (f"<자료 정보>\n- 이름: {doc['name']}\n- 분류: {doc['category']}\n</자료 정보>\n\n"
                  f"<자료>\n{pii.mask(text)}\n</자료>")
    try:
        resp, usage = llm.complete(settings.analyzer_model, prompts.PROFILE_EXTRACT, user_input,
                                   "마스터 프로필 추출", json_mode=True)
        data = llm.parse_json(resp.output_text)
    except (llm.LLMError, json.JSONDecodeError, ValueError) as ex:
        return [], 0.0, f"'{doc['name']}': 추출 실패 ({ex})"
    out = [e for c in data.get("entries", []) if isinstance(c, dict) and (e := _clean_candidate(c, doc["name"]))]
    note = f"'{doc['name']}': 분량이 길어 앞·뒤 일부만 사용했습니다" if truncated else None
    return out, usage["cost_usd"], note


def extract(doc_ids: list[str]) -> dict:
    """선택한 자료에서 항목 후보를 추출 → 중복 병합 → 기존 항목과 대조. 저장은 하지 않는다."""
    ids = list(dict.fromkeys(doc_ids))
    if not ids:
        raise ValueError("추출할 자료를 1개 이상 선택하세요.")
    docs = db.rows(f"SELECT * FROM documents WHERE id IN ({','.join('?' * len(ids))})", tuple(ids))
    if not docs:
        raise ValueError("선택한 자료를 찾을 수 없습니다.")
    llm.client()  # 키 미설정이면 여기서 바로 안내
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(_extract_one, docs))

    merged: dict[str, dict] = {}
    cost, notes = 0.0, []
    for cands, c, note in results:
        cost += c
        if note:
            notes.append(note)
        for e in cands:
            key = _norm(e["section"]) + "|" + _norm(e["title"])
            merged[key] = _merge_into(merged[key], e) if key in merged else e

    candidates = []
    for e in merged.values():
        existing = find(e["section"], e["title"])
        e["exists_id"] = existing["id"] if existing else None
        candidates.append(e)
    order = {s: i for i, s in enumerate(SECTION_PRESETS)}
    candidates.sort(key=lambda e: (order.get(e["section"], 99), e["section"], e["subtopic"], e["title"]))
    return {"candidates": candidates, "cost_usd": round(cost, 6), "notes": notes}


def import_entries(entries: list[dict]) -> dict:
    """검토한 후보 저장. mode=merge면 기존 항목의 빈 칸만 채우고 상세 내용을 덧붙인다."""
    added = merged = 0
    warnings = []
    for c in entries:
        data = {k: c.get(k, "") for k in EDITABLE if k != "private_note"}
        target = get(c.get("exists_id")) if c.get("mode") == "merge" else None
        try:
            if target:
                base = {k: target.get(k) or "" for k in EDITABLE}
                res = save(_merge_into(base, {k: v for k, v in data.items() if k not in ("section", "title")}), target["id"])
                merged += 1
            else:
                res = save(data)
                added += 1
            if res.get("warning"):
                warnings.append(res["warning"])
        except ValueError as ex:
            warnings.append(str(ex))
    return {"added": added, "merged": merged, "warning": warnings[0] if warnings else None}
