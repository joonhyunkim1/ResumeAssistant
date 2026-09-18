"""환경 변수(.env) 로드 및 전역 설정.

웹의 '초기 설정' 화면에서 .env를 수정하면 settings.reload()로 서버 재시작 없이 반영된다.
(HOST, PORT, DATA_DIR은 실행 시점에만 읽으므로 변경 시 재시작 필요)
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"
ENV_EXAMPLE_PATH = BASE_DIR / ".env.example"


def _str(name: str, default: str = "") -> str:
    v = os.getenv(name)
    return v.strip() if v and v.strip() else default


def _bool(name: str, default: bool) -> bool:
    v = _str(name)
    return default if not v else v.lower() in ("1", "true", "yes", "on")


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(_str(name, str(default)))
    except ValueError:
        return default


def _list(name: str, default: str = "") -> list[str]:
    return [s.strip() for s in _str(name, default).split(",") if s.strip()]


def is_valid_api_key(key: str) -> bool:
    """형식만 검사 (.env.example의 자리표시자 'sk-...' 등을 미설정으로 취급)."""
    return key.startswith("sk-") and len(key) >= 20 and "..." not in key


class Settings:
    def __init__(self):
        # 실행 시점에만 읽는 값
        load_dotenv(ENV_PATH)
        self.host = _str("HOST", "127.0.0.1")
        self.port = _int("PORT", 8000)
        self.data_dir = Path(_str("DATA_DIR") or BASE_DIR / "data")
        self.raw_dir = self.data_dir / "raw"
        self.chroma_dir = self.data_dir / "chroma"
        self.db_path = self.data_dir / "app.db"
        self.reload()

    def reload(self):
        load_dotenv(ENV_PATH, override=True)
        # OpenAI
        self.openai_api_key = _str("OPENAI_API_KEY")
        self.openai_admin_key = _str("OPENAI_ADMIN_KEY")  # 선택: 공식 비용 조회용
        # 모델
        self.writer_model = _str("WRITER_MODEL", "gpt-5.6-terra")
        self.analyzer_model = _str("ANALYZER_MODEL", "gpt-5.6-terra")
        self.utility_model = _str("UTILITY_MODEL", "gpt-5.6-luna")
        self.embedding_model = _str("EMBEDDING_MODEL", "text-embedding-3-small")
        self.available_models = _list("AVAILABLE_MODELS", "gpt-5.6-terra,gpt-5.6-sol,gpt-5.6-luna,gpt-6-astra")
        self.reasoning_effort = _str("REASONING_EFFORT", "medium")
        # RAG
        self.rag_top_k = _int("RAG_TOP_K", 8)
        self.rag_query_expansion = _bool("RAG_QUERY_EXPANSION", True)
        self.chunk_size = _int("CHUNK_SIZE", 700)
        self.chunk_overlap = _int("CHUNK_OVERLAP", 120)
        self.history_turns = _int("HISTORY_TURNS", 10)
        # 개인정보
        self.pii_masking = _bool("PII_MASKING", True)
        self.pii_custom_terms = _list("PII_CUSTOM_TERMS")
        # 비용 표시
        self.usd_krw = _float("USD_KRW", 1400)
        self.monthly_budget_usd = _float("MONTHLY_BUDGET_USD", 0)

    @property
    def api_key_ok(self) -> bool:
        return is_valid_api_key(self.openai_api_key)


settings = Settings()
settings.raw_dir.mkdir(parents=True, exist_ok=True)
settings.chroma_dir.mkdir(parents=True, exist_ok=True)
