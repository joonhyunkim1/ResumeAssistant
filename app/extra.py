"""기타 문항 작성: 대주제·소주제·출력 항목 → 항목별 서술 생성.

근거 우선순위: ① 마스터 프로필 항목(직접 포함) → ② RAG 검색 결과(보충) → ③ 기업 맞춤 지침(선택)
"""
import json

from . import db, llm, pii, profile, prompts, rag
from .config import settings
from .writer import count_chars


def _range(item: dict) -> tuple[int | None, int | None]:
    return prompts.char_range({"char_min": item.get("min"), "char_limit": item.get("max")})


def _items_block(items: list[dict]) -> str:
    out = []
    for i, it in enumerate(items, 1):
        lo, hi = _range(it)
        rng = f" — 공백 포함 {prompts.range_text(lo, hi)}" + (f", 최대 {hi}자 절대 초과 금지" if hi else "") if (lo or hi) else ""
        out.append(f"{i}. {it['label']}{rng}")
    return "\n".join(out)


def _context(section: str, subtopic: str, title: str, entry: dict | None, company: dict | None, sources: list[dict]) -> str:
    prof = pii.mask(profile.entry_text(entry)) if entry else \
        "(마스터 프로필 없음 — <참고자료>만 근거로 작성하고, 확인되지 않는 사실은 [확인 필요]로 표시하세요)"
    refs = "\n\n".join(f"[{i}] ({s['category']}) {s['name']}\n{s['text']}" for i, s in enumerate(sources, 1)) \
        or "(검색된 참고자료 없음)"
    comp = f"{company['name']} / {company.get('position') or '직무 미입력'}" if company else "(선택 안 함)"
    return (f"<작성 대상>\n- 대주제: {section}\n- 소주제(구분): {subtopic or '(없음)'}\n- 이름: {title}\n"
            f"- 지원 기업·직무: {comp}\n</작성 대상>\n\n"
            f"<마스터 프로필 — 최우선 근거>\n{prof}\n</마스터 프로필>\n\n<참고자료>\n{refs}\n</참고자료>")


def _call(model: str, company: dict | None, user_input: str) -> tuple[dict, float]:
    resp, usage = llm.complete(model, prompts.EXTRA_SYSTEM + prompts.company_block(company), user_input,
                               "기타 문항 작성", json_mode=True)
    try:
        data = llm.parse_json(resp.output_text)
    except (json.JSONDecodeError, ValueError) as e:
        raise llm.LLMError("AI 응답(JSON)을 해석하지 못했습니다. 다시 시도해주세요.") from e
    return data, usage["cost_usd"]


def _results_map(data: dict, items: list[dict]) -> dict[str, str]:
    got = {str(x.get("label", "")).strip(): str(x.get("text", "")).strip() for x in data.get("items", []) if isinstance(x, dict)}
    # 라벨을 조금 바꿔 답하는 경우 순서로 대응
    ordered = [str(x.get("text", "")).strip() for x in data.get("items", []) if isinstance(x, dict)]
    return {it["label"]: got.get(it["label"]) or (ordered[i] if i < len(ordered) else "") for i, it in enumerate(items)}


def _out_of_range(text: str, item: dict) -> bool:
    lo, hi = _range(item)
    n = len(text)
    return bool((hi and n > hi) or (lo and n < lo))


def _adjust(model, company, base_input, items, results) -> tuple[dict, float]:
    """범위를 벗어난 항목만 1회 재작성."""
    bad = [it for it in items if results.get(it["label"]) and _out_of_range(results[it["label"]], it)]
    if not bad:
        return results, 0.0
    lines = []
    for it in bad:
        lo, hi = _range(it)
        lines.append(f"- {it['label']}: 현재 {len(results[it['label']])}자 → 목표 {prompts.range_text(lo, hi)}\n  현재 글: {results[it['label']]}")
    req = (f"{base_input}\n\n<글자수 조정>\n아래 항목의 글자수가 목표 범위를 벗어났습니다. 사실과 핵심 내용은 유지하고 길이만 조정해 "
           f"해당 항목만 같은 JSON 형식으로 다시 작성하세요.\n" + "\n".join(lines) + "\n</글자수 조정>")
    data, cost = _call(model, company, req)
    fixed = _results_map(data, bad)
    return {**results, **{k: v for k, v in fixed.items() if v}}, cost


def _clean_items(items: list[dict]) -> list[dict]:
    out, seen = [], set()
    for it in items:
        label = (it.get("label") or "").strip()
        if not label or label in seen:
            continue
        seen.add(label)
        lo, hi = it.get("min") or None, it.get("max") or None
        if lo and hi and lo > hi:
            raise ValueError(f"'{label}'의 최소 글자수가 최대보다 큽니다.")
        out.append({"label": label, "min": lo, "max": hi})
    if not out:
        raise ValueError("출력할 내용을 1개 이상 입력하세요.")
    return out


def _generate(section, subtopic, title, entry, company, items, request, model, auto_adjust, fixed_texts=None):
    queries = [title, f"{section} {subtopic} {title}".replace("  ", " ")] + [f"{title} {it['label']}" for it in items]
    exclude = {rag.PROFILE_PREFIX + entry["id"]} if entry else None  # 이미 직접 포함한 항목은 검색에서 제외
    sources = rag.search(queries, exclude=exclude)
    base = _context(section, subtopic, title, entry, company, sources)
    other = ""
    if fixed_texts:  # 한 항목만 다시 쓸 때: 나머지 항목과 겹치지 않도록 제공
        other = "\n\n<이미 작성된 다른 항목 — 내용 중복 피하기>\n" + "\n".join(f"- {k}: {v}" for k, v in fixed_texts.items() if v) + "\n</이미 작성된 다른 항목>"
    user_input = (f"{base}{other}\n\n<출력 항목>\n{_items_block(items)}\n</출력 항목>"
                  f"\n\n<추가 요청>\n{pii.mask(request) if request.strip() else '(없음)'}\n</추가 요청>")
    data, cost = _call(model, company, user_input)
    results = _results_map(data, items)
    if auto_adjust:
        results, c2 = _adjust(model, company, user_input, items, results)
        cost += c2
    questions = [str(q) for q in data.get("questions", []) if str(q).strip()][:5]
    return results, questions, sources, cost


def _public(rec: dict) -> dict:
    rec["items"] = json.loads(rec.pop("items_json") or "[]")
    rec["results"] = json.loads(rec.pop("results_json") or "{}")
    rec["meta"] = json.loads(rec.pop("meta_json") or "{}")
    rec["chars"] = {k: count_chars(v) for k, v in rec["results"].items()}
    return rec


def get(rec_id: str) -> dict | None:
    r = db.row("SELECT * FROM extra_answers WHERE id=?", (rec_id,))
    return _public(r) if r else None


def list_records() -> list[dict]:
    return db.rows("SELECT e.id, e.section, e.subtopic, e.title, e.updated_at, c.name AS company_name FROM extra_answers e"
                   " LEFT JOIN companies c ON c.id=e.company_id ORDER BY e.updated_at DESC")


def create(body: dict) -> dict:
    section, title = (body.get("section") or "").strip(), (body.get("title") or "").strip()
    subtopic = (body.get("subtopic") or "").strip()
    if not section or not title:
        raise ValueError("대주제와 이름(논문명·프로젝트명·회사명 등)을 입력하세요.")
    items = _clean_items(body.get("items") or [])
    entry = profile.get(body.get("entry_id")) or profile.find(section, title)
    company = db.get_company(body.get("company_id"))
    model = body.get("model") or settings.writer_model
    request = body.get("request") or ""
    if entry:  # 마스터 프로필과 연결되면 프로필의 정식 명칭·소주제를 사용
        title = entry["title"]
        subtopic = subtopic or entry.get("subtopic") or ""
    results, questions, sources, cost = _generate(section, subtopic, title, entry, company, items, request, model,
                                                  body.get("auto_adjust", True))
    meta = {"questions": questions, "cost_usd": round(cost, 6), "profile_used": bool(entry),
            "sources": [{k: s[k] for k in ("name", "category", "score", "text")} for s in sources]}
    rid, ts = db.new_id(), db.now()
    db.execute(
        "INSERT INTO extra_answers(id, company_id, section, subtopic, title, entry_id, request, model, items_json,"
        " results_json, meta_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (rid, company["id"] if company else None, section, subtopic, title, entry["id"] if entry else None, request, model,
         json.dumps(items, ensure_ascii=False), json.dumps(results, ensure_ascii=False),
         json.dumps(meta, ensure_ascii=False), ts, ts),
    )
    return get(rid)


def regenerate(rec_id: str, label: str, instruction: str = "") -> dict:
    rec = get(rec_id)
    if not rec:
        raise KeyError(rec_id)
    item = next((it for it in rec["items"] if it["label"] == label), None)
    if not item:
        raise ValueError("해당 항목이 없습니다.")
    entry = profile.get(rec.get("entry_id"))
    company = db.get_company(rec.get("company_id"))
    others = {k: v for k, v in rec["results"].items() if k != label}
    request = "\n".join(x for x in [rec.get("request") or "", f"[이번 요청] {instruction}" if instruction else
                                    "[이번 요청] 이전과 다른 관점·표현으로 다시 작성"] if x)
    results, questions, _, cost = _generate(rec["section"], rec.get("subtopic") or "", rec["title"], entry, company, [item], request,
                                            rec.get("model") or settings.writer_model, True, fixed_texts=others)
    rec["results"][label] = results.get(label) or rec["results"].get(label, "")
    meta = rec["meta"]
    meta["cost_usd"] = round(meta.get("cost_usd", 0) + cost, 6)
    if questions:
        meta["questions"] = questions
    db.execute("UPDATE extra_answers SET results_json=?, meta_json=?, updated_at=? WHERE id=?",
               (json.dumps(rec["results"], ensure_ascii=False), json.dumps(meta, ensure_ascii=False), db.now(), rec_id))
    return {**get(rec_id), "last_cost_usd": round(cost, 6)}


def update_results(rec_id: str, results: dict) -> dict:
    rec = get(rec_id)
    if not rec:
        raise KeyError(rec_id)
    merged = {**rec["results"], **{k: str(v) for k, v in results.items() if k in rec["results"]}}
    db.execute("UPDATE extra_answers SET results_json=?, updated_at=? WHERE id=?",
               (json.dumps(merged, ensure_ascii=False), db.now(), rec_id))
    return get(rec_id)


def delete(rec_id: str):
    db.execute("DELETE FROM extra_answers WHERE id=?", (rec_id,))
