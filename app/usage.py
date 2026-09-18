"""사용량/비용 집계.

- 추정 비용(실시간): 이 앱이 보낸 모든 요청의 토큰 사용량 × pricing.json 단가
- 공식 비용(선택): OPENAI_ADMIN_KEY가 있으면 OpenAI Costs API로 조직 전체 청구 금액 조회 (일 단위, 수 시간 지연)
"""
from datetime import date, datetime, timedelta, timezone

import httpx

from . import db
from .config import settings


def _sum(where: str, params=()) -> float:
    r = db.row(f"SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE {where}", params)
    return round(r["c"], 6)


def summary() -> dict:
    today = date.today()
    month = today.strftime("%Y-%m")
    since = (today - timedelta(days=29)).isoformat()
    month_cost = _sum("ts LIKE ?", (f"{month}%",))
    return {
        "today_usd": _sum("ts LIKE ?", (f"{today.isoformat()}%",)),
        "month_usd": month_cost,
        "total_usd": _sum("1=1"),
        "usd_krw": settings.usd_krw,
        "monthly_budget_usd": settings.monthly_budget_usd,
        "budget_exceeded": bool(settings.monthly_budget_usd and month_cost >= settings.monthly_budget_usd),
        "by_purpose": db.rows(
            "SELECT purpose, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage WHERE ts LIKE ? GROUP BY purpose ORDER BY cost DESC",
            (f"{month}%",)),
        "by_model": db.rows(
            "SELECT model, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,"
            " SUM(cost_usd) AS cost, MIN(priced) AS priced FROM usage WHERE ts LIKE ? GROUP BY model ORDER BY cost DESC",
            (f"{month}%",)),
        "daily": db.rows(
            "SELECT substr(ts,1,10) AS day, SUM(cost_usd) AS cost FROM usage WHERE ts >= ? GROUP BY day ORDER BY day",
            (since,)),
        "recent": db.rows("SELECT * FROM usage ORDER BY id DESC LIMIT 30"),
        "official_available": bool(settings.openai_admin_key),
    }


def official() -> dict:
    if not settings.openai_admin_key:
        return {"available": False}
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    params = {"start_time": int(start.timestamp()), "bucket_width": "1d", "limit": 31}
    headers = {"Authorization": f"Bearer {settings.openai_admin_key}"}
    days, total, page = [], 0.0, None
    try:
        for _ in range(5):
            if page:
                params["page"] = page
            r = httpx.get("https://api.openai.com/v1/organization/costs", params=params, headers=headers, timeout=20)
            r.raise_for_status()
            body = r.json()
            for b in body.get("data", []):
                amt = sum(float(x.get("amount", {}).get("value", 0) or 0) for x in b.get("results", []))
                day = datetime.fromtimestamp(b["start_time"], timezone.utc).date().isoformat()
                days.append({"day": day, "cost": round(amt, 4)})
                total += amt
            if not body.get("has_more"):
                break
            page = body.get("next_page")
    except httpx.HTTPError as e:
        return {"available": True, "error": f"공식 비용 조회 실패: {e}"}
    return {"available": True, "month_usd": round(total, 4), "daily": days}
