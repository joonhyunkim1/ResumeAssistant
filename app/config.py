"""환경 변수(.env) 로드 및 전역 설정."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v.strip() == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _list(name: str, default: str = "") -> list[str]:
    return [s.strip() for s in os.getenv(name, default).split(",") if s.strip()]


class Settings:
    # OpenAI
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_admin_key: str = os.getenv("OPENAI_ADMIN_KEY", "")  # 선택: 공식 비용 조회용

    writer_model: str = os.getenv("WRITER_MODEL", "gpt-5.6-terra")
    analyzer_model: str = os.getenv("ANALYZER_MODEL", "gpt-5.6-terra")
    utility_model: str = os.getenv("UTILITY_MODEL", "gpt-5.6-luna")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    available_models: list[str] = _list(
        "AVAILABLE_MODELS", "gpt-5.6-terra,gpt-5.6-sol,gpt-5.6-luna,gpt-6-astra"
    )
    reasoning_effort: str = os.getenv("REASONING_EFFORT", "medium")

    # RAG
    rag_top_k: int = _int("RAG_TOP_K", 8)
    rag_query_expansion: bool = _bool("RAG_QUERY_EXPANSION", True)
    chunk_size: int = _int("CHUNK_SIZE", 700)
    chunk_overlap: int = _int("CHUNK_OVERLAP", 120)
    history_turns: int = _int("HISTORY_TURNS", 10)

    # 개인정보
    pii_masking: bool = _bool("PII_MASKING", True)
    pii_custom_terms: list[str] = _list("PII_CUSTOM_TERMS")

    # 비용 표시
    usd_krw: float = _float("USD_KRW", 1400)
    monthly_budget_usd: float = _float("MONTHLY_BUDGET_USD", 0)

    # 서버
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = _int("PORT", 8000)

    # 경로
    data_dir: Path = Path(os.getenv("DATA_DIR") or BASE_DIR / "data")
    raw_dir: Path = data_dir / "raw"
    chroma_dir: Path = data_dir / "chroma"
    db_path: Path = data_dir / "app.db"


settings = Settings()
settings.raw_dir.mkdir(parents=True, exist_ok=True)
settings.chroma_dir.mkdir(parents=True, exist_ok=True)
