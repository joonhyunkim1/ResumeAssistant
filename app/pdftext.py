"""PDF 텍스트 추출: 엔진(pdfium → pypdf 예비) + 정제 + 품질 검사.

모두 로컬에서 처리하며 API 비용이 들지 않는다.
- pypdfium2 (BSD-3/Apache-2.0): Chrome의 PDF 엔진. 한글 띄어쓰기·글자 순서가 pypdf보다 정확
- pypdf (BSD-3): pdfium 결과가 나쁠 때 비교용 예비 엔진
"""
import io
import re
import statistics
from collections import Counter

import pypdfium2 as pdfium
from pypdf import PdfReader

# ---------------- 엔진 ----------------


def _pages_pdfium(data: bytes) -> list[str]:
    pdf = pdfium.PdfDocument(data)
    try:
        pages = []
        for i in range(len(pdf)):
            page = pdf[i]
            tp = page.get_textpage()
            pages.append(tp.get_text_range())
            tp.close()
            page.close()
        return pages
    finally:
        pdf.close()


def _pages_pypdf(data: bytes) -> list[str]:
    return [(p.extract_text() or "") for p in PdfReader(io.BytesIO(data)).pages]


# ---------------- 품질 검사 ----------------

_BAD_CHARS = re.compile(
    "[�-\x01-\x08\x0b\x0c\x0e-\x1f]"  # 대체문자, 사용자정의영역(폰트 매핑 실패), 제어문자
)
_LATIN1_MOJIBAKE = re.compile("[À-ÿ]")  # 한글 폰트 매핑 실패 시 흔한 'ÇÑ±Û' 류
_HANGUL = re.compile("[가-힣]")


def quality(pages: list[str]) -> dict:
    text = "".join(pages)
    chars = len(re.sub(r"\s", "", text)) or 1
    bad = len(_BAD_CHARS.findall(text))
    hangul = len(_HANGUL.findall(text))
    latin1 = len(_LATIN1_MOJIBAKE.findall(text))
    # 한글이 거의 없는데 Latin-1 확장 문자가 많으면 한글 폰트가 깨진 것으로 본다
    if latin1 > 20 and latin1 > hangul:
        bad += latin1
    tokens = re.findall(r"[가-힣]+", text)
    single = sum(1 for t in tokens if len(t) == 1)
    return {
        "bad_ratio": bad / chars,
        "spaced_ratio": single / len(tokens) if len(tokens) > 30 else 0.0,  # '안 녕 하 세 요' 식 분리
        "empty_pages": sum(1 for p in pages if len(p.strip()) < 20),
        "total_pages": len(pages),
        "chars": chars,
    }


def _score(q: dict) -> float:
    return q["bad_ratio"] * 5 + q["spaced_ratio"] + q["empty_pages"] / max(q["total_pages"], 1)


# ---------------- 정제 ----------------

_INVISIBLE = re.compile("[­​-‏⁠﻿]")  # soft hyphen, zero-width 문자
_LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", " ": " ", "　": " "}
_PAGE_NUM = re.compile(
    r"^\s*(?:[-–—]\s*)?(?:page\s*)?\d{1,4}(?:\s*(?:/|of)\s*\d{1,4})?(?:\s*[-–—])?\s*$|^\s*\d{1,4}\s*쪽\s*$",
    re.I,
)
_LIST_START = re.compile(
    r"^\s*(?:[-–•·▪◦*●○■□▶►✓※]|\d{1,2}[.)]\s|\(\d{1,2}\)|[①-⑳]|[가-하][.)]\s|[IVX]{1,4}\.\s|#"
    r"|(?:19|20)\d{2}\s*[.\-/년])"  # 이력서의 날짜로 시작하는 항목
)
_SENT_END = re.compile(r"[.!?。:;)\]」』\"'”’]$|[다요음함됨임]\.?$")


def _normalize_line(line: str) -> str:
    line = _INVISIBLE.sub("", line)
    for a, b in _LIGATURES.items():
        line = line.replace(a, b)
    return re.sub(r"[ \t]{2,}", " ", line).strip()


def _strip_headers_footers(pages: list[list[str]]) -> list[list[str]]:
    """여러 페이지의 위·아래 2줄에 반복되는 문구(머리글·바닥글)와 페이지 번호를 제거.
    - 완전히 같은 줄이 절반 이상 페이지에 반복되면 제거
    - 숫자만 다른 줄('Page 3 of 12')은 짧고 목록·제목 형식이 아닐 때만 제거 ('1. 경력' 같은 제목 보호)
    """
    n = len(pages)
    if n < 3:
        return [[l for l in p if not _PAGE_NUM.match(l)] for p in pages]
    norm = lambda l: re.sub(r"\d+", "#", l)
    exact, numbered = Counter(), Counter()
    for p in pages:
        edge = [l for l in p[:2] + p[-2:] if l]
        exact.update(set(edge))
        numbered.update(set(norm(l) for l in edge if len(l) <= 40 and not _LIST_START.match(l)))
    threshold = max(3, n * 0.5)
    rep_exact = {k for k, c in exact.items() if c >= threshold}
    rep_num = {k for k, c in numbered.items() if c >= threshold and "#" in k}

    def is_header(l: str) -> bool:
        # 100자 넘는 줄은 본문일 가능성이 높아 반복돼도 유지
        return (l in rep_exact and len(l) <= 100) or (len(l) <= 40 and not _LIST_START.match(l) and norm(l) in rep_num)

    out = []
    for p in pages:
        keep = [l for i, l in enumerate(p)
                if not (_PAGE_NUM.match(l) or ((i < 2 or i >= len(p) - 2) and is_header(l)))]
        out.append(keep)
    return out


def _join_lines(lines: list[str], typical: float) -> str:
    """PDF 줄바꿈으로 끊긴 문장을 잇고, 문단·목록·제목 경계는 유지."""
    paras, cur = [], ""
    for line in lines:
        if not line:
            if cur:
                paras.append(cur)
                cur = ""
            continue
        if not cur:
            cur = line
            continue
        prev_short = len(cur.split("\n")[-1]) < typical * 0.6  # 짧은 줄은 문단 끝·제목일 가능성
        # 문장이 끝난 줄 다음은 줄만 바꿈(이력서 항목이 섞이지 않게), 문장 중간에서 끊긴 줄만 이어 붙임
        if _LIST_START.match(line) or prev_short or _SENT_END.search(cur):
            cur += "\n" + line
        elif re.search(r"[A-Za-z]-$", cur) and line[:1].islower():
            cur = cur[:-1] + line  # 영어 하이픈 줄바꿈: "infor-\nmation" → "information"
        else:
            cur += " " + line
    if cur:
        paras.append(cur)
    return "\n\n".join(paras)


def clean(pages: list[str]) -> str:
    # pdfium은 줄 끝 하이픈(soft hyphen)을 U+FFFE로 표시 → 단어를 이어 붙인다
    pages = [re.sub("\ufffe\\s*", "", p.replace("\r\n", "\n").replace("\r", "\n")) for p in pages]
    split = [[_normalize_line(l) for l in p.split("\n")] for p in pages]
    split = _strip_headers_footers(split)
    lengths = [len(l) for p in split for l in p if len(l) > 5]
    typical = statistics.median(lengths) if lengths else 60
    return "\n\n".join(t for t in (_join_lines(p, typical) for p in split) if t.strip())


# ---------------- 진입점 ----------------


def extract(data: bytes) -> tuple[str, list[str]]:
    """(정제된 텍스트, 경고 목록) 반환."""
    candidates = []
    for name, fn in (("pdfium", _pages_pdfium), ("pypdf", _pages_pypdf)):
        try:
            pages = fn(data)
        except Exception:  # noqa: BLE001 — 한 엔진이 실패해도 다른 엔진으로 계속
            continue
        q = quality(pages)
        candidates.append((name, pages, q))
        if name == "pdfium" and _score(q) < 0.05:  # 충분히 깨끗하면 비교 생략
            break
    if not candidates:
        return "", ["PDF를 열 수 없습니다. 파일이 손상되었거나 암호가 걸려 있을 수 있습니다."]

    _, pages, q = min(candidates, key=lambda c: (_score(c[2]), -c[2]["chars"]))
    warnings = []
    if q["bad_ratio"] > 0.02:
        warnings.append(
            f"깨진 문자 비율 {q['bad_ratio']:.0%}: PDF 폰트 문제로 일부 글자가 깨졌을 수 있습니다. "
            "미리보기로 확인하고, 중요한 내용은 '직접 입력'으로 보충하세요."
        )
    if q["empty_pages"]:
        warnings.append(
            f"{q['total_pages']}페이지 중 {q['empty_pages']}페이지에서 텍스트를 찾지 못했습니다 "
            "(스캔 이미지일 가능성, OCR 필요)."
        )
    if q["spaced_ratio"] > 0.5:
        warnings.append("글자 단위로 띄어쓰기가 분리된 부분이 많습니다. 검색 정확도가 떨어질 수 있습니다.")
    return clean(pages), warnings
