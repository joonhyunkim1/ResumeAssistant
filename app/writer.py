"""자소서 작성 대화: 검색어 확장 → RAG 검색 → 스트리밍 생성 → 글자수 계산."""
import json
import logging
import re
from typing import Iterator

from . import db, llm, pii, prompts, rag
from .config import settings

log = logging.getLogger("app.writer")
_DRAFT = re.compile(r"###\s*초안\s*\n(.*?)(?=\n###\s|\Z)", re.S)


def extract_draft(text: str) -> str | None:
    m = _DRAFT.search(text)
    return m.group(1).strip() if m else None


def count_chars(text: str) -> dict:
    return {"with_spaces": len(text), "without_spaces": len(re.sub(r"\s", "", text))}


def _expand_queries(message: str, session: dict, company: dict | None) -> list[str]:
    ctx = [f"문항: {session.get('question') or '(없음)'}", f"요청: {pii.mask(message)}"]
    if company:
        p = company["profile"]
        ctx.append(f"기업: {company['name']} / 직무: {company.get('position') or ''}")
        ctx.append(f"인재상: {', '.join(p.get('talent_values', [])[:5])}")
        ctx.append(f"직무 키워드: {', '.join(p.get('jd_keywords', [])[:10])}")
    try:
        resp, _ = llm.complete(settings.utility_model, prompts.QUERY_EXPANSION, "\n".join(ctx),
                               "검색어 생성", effort="low", json_mode=True)
        return [q for q in llm.parse_json(resp.output_text).get("queries", []) if isinstance(q, str)][:4]
    except Exception as e:  # noqa: BLE001 — 확장 실패 시 기본 검색어만 사용하되 기록은 남긴다
        log.warning("검색어 확장 실패, 기본 검색어로 진행: %s", e)
        return []


def _last_draft(history: list[dict]) -> str | None:
    for m in reversed(history):
        if m["role"] == "assistant" and m["meta"].get("draft"):
            return m["meta"]["draft"]
    return None


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def chat(session_id: str, message: str, action: str = "chat") -> Iterator[str]:
    session = db.row("SELECT * FROM sessions WHERE id=?", (session_id,))
    if not session:
        yield _sse({"type": "error", "message": "세션을 찾을 수 없습니다."})
        return
    company = db.get_company(session["company_id"])
    history = db.get_messages(session_id)
    usage_start = (db.row("SELECT MAX(id) AS m FROM usage") or {}).get("m") or 0

    try:
        sources: list[dict] = []
        if action == "adjust_length":
            draft = _last_draft(history)
            lo, hi = prompts.char_range(session)
            if not draft or not (lo or hi):
                yield _sse({"type": "error", "message": "조정할 초안 또는 글자수 설정이 없습니다."})
                return
            cur = len(draft)
            if hi and cur > hi:
                direction = f"약 {cur - hi + 20}자 이상 줄이세요. 중복 표현·수식어·부차적 배경 설명부터 줄이세요."
            elif lo and cur < lo:
                direction = f"약 {lo - cur + 20}자 이상 늘리세요. 행동의 구체적 과정과 결과의 근거를 보강하되 새로운 사실을 지어내지 마세요."
            else:
                direction = "이미 범위 안이지만, 범위의 가운데에 가깝게 다듬으세요."
            message = prompts.LENGTH_ADJUST.format(current=cur, target=prompts.range_text(lo, hi), direction=direction)
            turn_input = message
        else:
            queries = [message, session.get("question") or ""]
            if settings.rag_query_expansion:
                queries += _expand_queries(message, session, company)
            sources = rag.search(queries)
            turn_input = prompts.build_turn_input(pii.mask(message), session, company, sources)

        db.add_message(session_id, "user", message, {"action": action})
        yield _sse({"type": "sources", "sources": sources})

        recent = history[-settings.history_turns * 2:]
        convo = [{"role": m["role"], "content": pii.mask(m["content"])} for m in recent]
        convo.append({"role": "user", "content": turn_input})
        instructions = prompts.WRITER_SYSTEM + prompts.company_block(company)
        model = session.get("model") or settings.writer_model

        text = ""
        for ev in llm.stream(model, instructions, convo, "자소서 작성"):
            if ev["type"] == "delta":
                text += ev["text"]
                yield _sse(ev)
    except llm.LLMError as e:
        yield _sse({"type": "error", "message": str(e)})
        return
    except Exception as e:  # noqa: BLE001 — DB·검색 오류도 화면에 알림
        log.exception("자소서 작성 중 오류")
        yield _sse({"type": "error", "message": f"처리 중 오류가 발생했습니다: {e}"})
        return

    draft = extract_draft(text)
    turn_cost = (db.row("SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE id>?", (usage_start,)) or {})["c"]
    meta = {
        "model": model,
        "draft": draft,
        "chars": count_chars(draft) if draft else None,
        "char_min": prompts.char_range(session)[0],
        "char_limit": session.get("char_limit"),
        "cost_usd": round(turn_cost, 6),
        "sources": [{k: s[k] for k in ("name", "category", "score", "text")} for s in sources],
    }
    mid = db.add_message(session_id, "assistant", text, meta)
    yield _sse({"type": "done", "message_id": mid, "meta": meta})
