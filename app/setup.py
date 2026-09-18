"""웹 '초기 설정' 화면: 로컬 .env 파일 읽기/쓰기와 API 키 검증.

- .env는 이 PC의 프로젝트 폴더에만 저장된다(권한 600). 외부 서버로 보내지 않는다.
- 브라우저에는 비밀 키를 마스킹해서만 돌려준다.
- 키 검증은 OpenAI에 직접 요청한다(모델 목록 조회 — 과금 없음).
"""
import os
import re
import shutil
import tempfile

import httpx
from openai import OpenAI

from .config import ENV_EXAMPLE_PATH, ENV_PATH, is_valid_api_key, settings

# 화면에서 편집할 수 있는 항목. HOST/PORT/DATA_DIR은 재시작이 필요해 제외.
FIELDS: list[dict] = [
    {"key": "OPENAI_API_KEY", "type": "secret", "default": ""},
    {"key": "OPENAI_ADMIN_KEY", "type": "secret", "default": ""},
    {"key": "WRITER_MODEL", "type": "str", "default": "gpt-5.6-terra"},
    {"key": "ANALYZER_MODEL", "type": "str", "default": "gpt-5.6-terra"},
    {"key": "UTILITY_MODEL", "type": "str", "default": "gpt-5.6-luna"},
    {"key": "EMBEDDING_MODEL", "type": "str", "default": "text-embedding-3-small"},
    {"key": "AVAILABLE_MODELS", "type": "str", "default": "gpt-5.6-terra,gpt-5.6-sol,gpt-5.6-luna,gpt-6-astra"},
    {"key": "REASONING_EFFORT", "type": "choice", "default": "medium", "choices": ["low", "medium", "high"]},
    {"key": "RAG_TOP_K", "type": "int", "default": "8", "min": 1, "max": 30},
    {"key": "RAG_QUERY_EXPANSION", "type": "bool", "default": "true"},
    {"key": "CHUNK_SIZE", "type": "int", "default": "700", "min": 200, "max": 3000},
    {"key": "CHUNK_OVERLAP", "type": "int", "default": "120", "min": 0, "max": 1000},
    {"key": "HISTORY_TURNS", "type": "int", "default": "10", "min": 0, "max": 50},
    {"key": "PII_MASKING", "type": "bool", "default": "true"},
    {"key": "PII_CUSTOM_TERMS", "type": "str", "default": ""},
    {"key": "USD_KRW", "type": "float", "default": "1400", "min": 1, "max": 100000},
    {"key": "MONTHLY_BUDGET_USD", "type": "float", "default": "10", "min": 0, "max": 100000},
]
_BY_KEY = {f["key"]: f for f in FIELDS}
_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


class SetupError(ValueError):
    pass


def mask_secret(v: str) -> str:
    if not v:
        return ""
    return v[:7] + "…" + v[-4:] if len(v) > 14 else "…" + v[-2:]


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return re.split(r"\s+#", v, maxsplit=1)[0].strip()  # 인라인 주석 제거


def read_env() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    out = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        m = _LINE.match(line)
        if m:
            out[m.group(1)] = _unquote(m.group(2))
    return out


def _quote(v: str) -> str:
    return f'"{v}"' if re.search(r"[\s#'\"]", v) else v


def write_env(updates: dict[str, str]):
    """기존 주석·순서를 유지하며 값만 교체하고, 없는 키는 끝에 추가. 원자적으로 저장."""
    if not ENV_PATH.exists():
        if ENV_EXAMPLE_PATH.exists():
            shutil.copyfile(ENV_EXAMPLE_PATH, ENV_PATH)
        else:
            ENV_PATH.write_text("", encoding="utf-8")
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    remaining = dict(updates)
    for i, line in enumerate(lines):
        m = _LINE.match(line)
        if m and m.group(1) in remaining:
            k = m.group(1)
            lines[i] = f"{k}={_quote(remaining.pop(k))}"
    if remaining:
        lines.append("")
        lines.extend(f"{k}={_quote(v)}" for k, v in remaining.items())
    fd, tmp = tempfile.mkstemp(dir=ENV_PATH.parent, prefix=".env.", text=True)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, ENV_PATH)


def _validate(key: str, raw) -> str:
    f = _BY_KEY.get(key)
    if not f:
        raise SetupError(f"편집할 수 없는 항목입니다: {key}")
    v = str(raw if raw is not None else "").replace("\r", "").replace("\n", "").replace('"', "").strip()
    t = f["type"]
    if t == "secret" and v:
        if key == "OPENAI_API_KEY" and not is_valid_api_key(v):
            raise SetupError("OpenAI API 키 형식이 올바르지 않습니다. 'sk-'로 시작하는 전체 키를 붙여넣으세요.")
        if key == "OPENAI_ADMIN_KEY" and not v.startswith("sk-admin-"):
            raise SetupError("Admin 키는 'sk-admin-'으로 시작합니다. 일반 API 키와 다릅니다.")
    elif t in ("int", "float"):
        try:
            n = int(v) if t == "int" else float(v)
        except ValueError:
            raise SetupError(f"{key}: 숫자를 입력하세요.")
        if not (f["min"] <= n <= f["max"]):
            raise SetupError(f"{key}: {f['min']}~{f['max']} 범위로 입력하세요.")
    elif t == "bool":
        v = "true" if v.lower() in ("1", "true", "yes", "on") else "false"
    elif t == "choice" and v not in f["choices"]:
        raise SetupError(f"{key}: {', '.join(f['choices'])} 중 하나를 선택하세요.")
    elif t == "str" and key.endswith("_MODEL") and not v:
        raise SetupError(f"{key}: 모델을 선택하세요.")
    return v


def get_state() -> dict:
    env = read_env()
    values = {}
    for f in FIELDS:
        v = env.get(f["key"], "")
        if f["type"] == "secret":
            ok = is_valid_api_key(v) if f["key"] == "OPENAI_API_KEY" else bool(v)
            values[f["key"]] = {"set": ok, "masked": mask_secret(v) if ok else ""}
        else:
            values[f["key"]] = v if v != "" else f["default"]
    return {
        "env_exists": ENV_PATH.exists(),
        "env_path": str(ENV_PATH),
        "api_key_ok": settings.api_key_ok,
        "values": values,
        "fields": FIELDS,
    }


def save(values: dict) -> dict:
    updates = {}
    for key, raw in values.items():
        f = _BY_KEY.get(key)
        # 비밀 키: 빈 값이면 '변경 안 함'. 삭제는 명시적으로 {"__clear__": true}
        if f and f["type"] == "secret":
            if isinstance(raw, dict) and raw.get("__clear__"):
                updates[key] = ""
                continue
            if not raw:
                continue
        updates[key] = _validate(key, raw)
    if updates:
        write_env(updates)
    settings.reload()
    return get_state()


# ---------------- 키 검증 (과금 없음) ----------------

def test_api_key(key: str | None, models: list[str]) -> dict:
    key = (key or "").strip() or settings.openai_api_key
    if not is_valid_api_key(key):
        return {"ok": False, "error": "API 키가 입력되지 않았거나 형식이 올바르지 않습니다."}
    try:
        ids = {m.id for m in OpenAI(api_key=key, timeout=15).models.list()}
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "401" in msg or "invalid_api_key" in msg or "Incorrect API key" in msg:
            msg = "유효하지 않은 키입니다. 복사할 때 앞뒤가 잘리지 않았는지 확인하세요."
        elif "429" in msg or "quota" in msg:
            msg = "크레딧이 없거나 한도를 넘었습니다. Billing에서 크레딧을 충전하세요."
        return {"ok": False, "error": msg}
    return {"ok": True, "model_count": len(ids),
            "models": {m: (m in ids) for m in dict.fromkeys(models) if m}}


def test_admin_key(key: str | None) -> dict:
    key = (key or "").strip() or settings.openai_admin_key
    if not key:
        return {"ok": False, "error": "Admin 키가 입력되지 않았습니다."}
    try:
        r = httpx.get("https://api.openai.com/v1/organization/costs",
                      params={"start_time": 1735689600, "limit": 1},
                      headers={"Authorization": f"Bearer {key}"}, timeout=15)
        if r.status_code == 200:
            return {"ok": True}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.json().get('error', {}).get('message', r.text)[:200]}"}
    except httpx.HTTPError as e:
        return {"ok": False, "error": str(e)}
