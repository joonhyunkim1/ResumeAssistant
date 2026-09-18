"""기업 맞춤형 프롬프트 생성 (2단계).

1) 기업 분석: 회사명·직무·JD·사용자 메모 (+웹 검색) → 구조화된 기업 프로필(JSON)
2) 프롬프트 생성: 기업 프로필 → 작성 AI에 덧붙일 '기업 맞춤 지침'
"""
import json

from . import db, llm, prompts
from .config import settings


def _citations(resp) -> list[dict]:
    seen, out = set(), []
    for item in resp.output or []:
        if getattr(item, "type", "") != "message":
            continue
        for part in item.content or []:
            for ann in getattr(part, "annotations", None) or []:
                if getattr(ann, "type", "") == "url_citation" and ann.url not in seen:
                    seen.add(ann.url)
                    out.append({"title": ann.title or ann.url, "url": ann.url})
    return out


def _analysis_input(name: str, position: str, jd: str, notes: str) -> str:
    return (
        f"회사명: {name}\n지원 직무: {position or '(미입력)'}\n\n"
        f"[채용공고/JD]\n{jd.strip() or '(미입력)'}\n\n"
        f"[사용자가 제공한 인재상·핵심가치·메모 — 최우선 반영]\n{notes.strip() or '(없음)'}"
    )


def generate_prompt(profile: dict, jd: str) -> tuple[str, dict]:
    payload = f"[기업 분석 결과]\n{json.dumps(profile, ensure_ascii=False, indent=2)}\n\n[JD 원문]\n{jd.strip() or '(없음)'}"
    resp, usage = llm.complete(settings.analyzer_model, prompts.PROMPT_ENGINEER, payload, "맞춤 프롬프트 생성")
    return resp.output_text.strip(), usage


def analyze(name: str, position: str, jd: str, notes: str, web_search: bool) -> dict:
    tools = [{"type": "web_search", "search_context_size": "medium"}] if web_search else None
    resp, u1 = llm.complete(
        settings.analyzer_model, prompts.COMPANY_ANALYZER, _analysis_input(name, position, jd, notes),
        "기업 분석", tools=tools, json_mode=not web_search,
    )
    try:
        profile = llm.parse_json(resp.output_text)
    except (json.JSONDecodeError, ValueError) as e:
        raise llm.LLMError("기업 분석 결과(JSON)를 해석하지 못했습니다. 다시 시도해주세요.") from e
    profile["sources"] = _citations(resp)

    system_prompt, u2 = generate_prompt(profile, jd)

    cid, ts = db.new_id(), db.now()
    db.execute(
        "INSERT INTO companies(id, name, position, jd, user_notes, profile_json, system_prompt, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (cid, name, position, jd, notes, json.dumps(profile, ensure_ascii=False), system_prompt, ts, ts),
    )
    company = db.get_company(cid)
    company["cost_usd"] = round(u1["cost_usd"] + u2["cost_usd"], 6)
    return company


def regenerate_prompt(company_id: str) -> dict:
    c = db.get_company(company_id)
    if not c:
        raise KeyError(company_id)
    system_prompt, usage = generate_prompt(c["profile"], c.get("jd") or "")
    db.execute("UPDATE companies SET system_prompt=?, updated_at=? WHERE id=?", (system_prompt, db.now(), company_id))
    c = db.get_company(company_id)
    c["cost_usd"] = usage["cost_usd"]
    return c
