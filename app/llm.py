"""OpenAI 호출 래퍼. 모든 호출의 토큰 사용량을 기록해 실시간 추정 비용을 계산한다."""
import json
from pathlib import Path
from typing import Iterator

from openai import OpenAI

from . import db
from .config import settings

_PRICING = json.loads((Path(__file__).parent / "pricing.json").read_text(encoding="utf-8"))
_client: OpenAI | None = None
_client_key = ""


class LLMError(RuntimeError):
    pass


def client() -> OpenAI:
    global _client, _client_key
    if not settings.api_key_ok:
        raise LLMError("OpenAI API 키가 설정되지 않았습니다. 왼쪽 메뉴의 '초기 설정'에서 키를 입력하세요.")
    if _client is None or _client_key != settings.openai_api_key:  # 설정 화면에서 키가 바뀌면 재생성
        _client = OpenAI(api_key=settings.openai_api_key)
        _client_key = settings.openai_api_key
    return _client


def pricing() -> dict:
    return _PRICING


def _price(model: str) -> dict | None:
    models = _PRICING["models"]
    if model in models:
        return models[model]
    # 날짜 스냅샷(e.g. gpt-5-2025-08-07) → 가장 긴 접두사 매칭
    cands = [k for k in models if model.startswith(k)]
    return models[max(cands, key=len)] if cands else None


def record_usage(model: str, purpose: str, input_tokens: int, cached_tokens: int = 0,
                 output_tokens: int = 0, web_search_calls: int = 0) -> dict:
    p = _price(model)
    cost = 0.0
    if p:
        cost = ((input_tokens - cached_tokens) * p["input"] + cached_tokens * p["cached"]
                + output_tokens * p["output"]) / 1_000_000
    cost += web_search_calls * _PRICING["web_search_per_call"]
    db.execute(
        "INSERT INTO usage(ts, model, purpose, input_tokens, cached_tokens, output_tokens, web_search_calls, cost_usd, priced)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (db.now(), model, purpose, input_tokens, cached_tokens, output_tokens, web_search_calls, cost, 1 if p else 0),
    )
    return {"model": model, "input_tokens": input_tokens, "output_tokens": output_tokens,
            "web_search_calls": web_search_calls, "cost_usd": round(cost, 6), "priced": bool(p)}


def _record_response(model: str, purpose: str, resp) -> dict:
    u = resp.usage
    cached = getattr(getattr(u, "input_tokens_details", None), "cached_tokens", 0) or 0
    web_calls = sum(1 for item in (resp.output or []) if getattr(item, "type", "") == "web_search_call")
    return record_usage(model, purpose, u.input_tokens, cached, u.output_tokens, web_calls)


def _reasoning_kwargs(model: str, effort: str | None) -> dict:
    if model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
        return {"reasoning": {"effort": effort or settings.reasoning_effort}}
    return {}


# ---------------- 임베딩 ----------------

def embed(texts: list[str], purpose: str = "임베딩") -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), 96):
        batch = texts[i:i + 96]
        resp = client().embeddings.create(model=settings.embedding_model, input=batch)
        record_usage(settings.embedding_model, purpose, resp.usage.prompt_tokens)
        out.extend(d.embedding for d in resp.data)
    return out


# ---------------- 텍스트 생성 ----------------

def complete(model: str, instructions: str, input, purpose: str, tools: list | None = None,
             effort: str | None = None, json_mode: bool = False):
    """단발성 호출. (응답 객체, 비용 정보) 반환."""
    kwargs = dict(model=model, instructions=instructions, input=input, store=False,
                  **_reasoning_kwargs(model, effort))
    if tools:
        kwargs["tools"] = tools
    if json_mode:
        kwargs["text"] = {"format": {"type": "json_object"}}
    try:
        resp = client().responses.create(**kwargs)
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001
        raise LLMError(f"OpenAI 호출 실패: {e}") from e
    return resp, _record_response(model, purpose, resp)


def stream(model: str, instructions: str, input, purpose: str, effort: str | None = None) -> Iterator[dict]:
    """스트리밍 호출. {'type':'delta','text'} ... {'type':'usage', ...} 이벤트를 순서대로 yield."""
    try:
        events = client().responses.create(model=model, instructions=instructions, input=input,
                                           store=False, stream=True, **_reasoning_kwargs(model, effort))
        for ev in events:
            if ev.type == "response.output_text.delta":
                yield {"type": "delta", "text": ev.delta}
            elif ev.type == "response.completed":
                yield {"type": "usage", **_record_response(model, purpose, ev.response)}
            elif ev.type in ("response.failed", "error"):
                msg = getattr(getattr(ev, "response", None), "error", None) or getattr(ev, "message", "")
                raise LLMError(f"OpenAI 응답 실패: {msg}")
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001
        raise LLMError(f"OpenAI 호출 실패: {e}") from e


def parse_json(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        s, e = text.find("{"), text.rfind("}")
        if s >= 0 and e > s:
            return json.loads(text[s:e + 1])
        raise
