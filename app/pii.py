"""OpenAI로 전송하기 전에 개인정보를 가리는 마스킹.

원본 파일은 로컬(data/raw)에만 남고, 임베딩·생성 요청에는 마스킹된 텍스트만 전송된다.
"""
import re

from .config import settings

_SIDO = "서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청북도|충청남도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|강원특별자치도|전북특별자치도"

PATTERNS: list[tuple[re.Pattern, str]] = [
    # 주민등록번호 / 외국인등록번호
    (re.compile(r"(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)"), "[주민번호]"),
    # 이메일
    (re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[이메일]"),
    # 휴대폰 / 유선 전화
    (re.compile(r"(?<!\d)(?:\+82[-\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"), "[전화번호]"),
    (re.compile(r"(?<!\d)0(?:2|[3-6][1-5])[-.\s)]\s?\d{3,4}[-.\s]\d{4}(?!\d)"), "[전화번호]"),
    # 도로명/지번 상세주소 (시·도 ~ 번지까지)
    (
        re.compile(
            rf"(?:{_SIDO})(?:특별시|광역시|특별자치시|도)?\s+\S+(?:시|군|구)(?:\s+\S+(?:구|읍|면|동|로|길))*\s+\d+(?:-\d+)?(?:\s*\S*(?:동|호|층))*"
        ),
        "[주소]",
    ),
]


def mask(text: str) -> str:
    if not settings.pii_masking or not text:
        return text
    for pat, repl in PATTERNS:
        text = pat.sub(repl, text)
    for term in settings.pii_custom_terms:
        text = text.replace(term, "[지원자]")
    return text
