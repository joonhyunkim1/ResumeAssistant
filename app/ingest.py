"""자료(PDF, DOCX, MD/TXT, HTML, 노션 export ZIP, URL)에서 텍스트 추출."""
import io
import re
import zipfile
from pathlib import PurePosixPath

import httpx
import trafilatura
from docx import Document

from . import pdftext

TEXT_EXTS = {".md", ".markdown", ".txt", ".csv"}
HTML_EXTS = {".html", ".htm"}
SUPPORTED = TEXT_EXTS | HTML_EXTS | {".pdf", ".docx", ".zip"}

# 노션 export 파일명 끝의 32자리 해시 제거: "프로젝트 회고 1a2b...ef.md"
_NOTION_HASH = re.compile(r"\s+[0-9a-f]{32}$")


class IngestError(ValueError):
    pass


def clean_name(filename: str) -> str:
    stem = PurePosixPath(filename).stem
    return _NOTION_HASH.sub("", stem) or stem


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for r in table.rows:
            parts.append(" | ".join(c.text.strip() for c in r.cells))
    return "\n".join(parts)


def _html(html: str) -> str:
    text = trafilatura.extract(html, include_tables=True, include_links=False, favor_recall=True)
    return text or ""


def _zip(data: bytes, depth: int = 0) -> tuple[str, list[str]]:
    """노션 'Markdown & CSV' export ZIP. 중첩 ZIP(Part-1.zip 등)도 1단계 처리."""
    parts, warnings = [], []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in sorted(zf.infolist(), key=lambda i: i.filename):
            if info.is_dir() or info.filename.startswith("__MACOSX"):
                continue
            ext = PurePosixPath(info.filename).suffix.lower()
            if ext == ".zip" and depth < 2:
                body, w = _zip(zf.read(info), depth + 1)
                parts.append(body)
                warnings += w
            elif ext in TEXT_EXTS | HTML_EXTS | {".pdf", ".docx"}:
                body, w = extract_file(info.filename, zf.read(info), inner=True)
                warnings += [f"{clean_name(info.filename)}: {x}" for x in w]
                if body.strip():
                    parts.append(f"# {clean_name(info.filename)}\n\n{body}")
    return "\n\n".join(p for p in parts if p.strip()), warnings


def extract_file(filename: str, data: bytes, inner: bool = False) -> tuple[str, list[str]]:
    """(텍스트, 품질 경고 목록) 반환."""
    ext = PurePosixPath(filename).suffix.lower()
    if ext not in SUPPORTED:
        raise IngestError(f"지원하지 않는 형식입니다: {ext} (지원: {', '.join(sorted(SUPPORTED))})")
    warnings: list[str] = []
    if ext == ".pdf":
        text, warnings = pdftext.extract(data)
    elif ext == ".docx":
        text = _docx(data)
    elif ext in HTML_EXTS:
        text = _html(_decode(data))
    elif ext == ".zip":
        text, warnings = _zip(data)
    else:
        text = _decode(data)
    text = _normalize(text)
    if not inner and len(text) < 20:
        hint = " 스캔(이미지) PDF는 텍스트 추출이 안 됩니다. 텍스트 PDF나 문서로 변환해 올려주세요." if ext == ".pdf" else ""
        raise IngestError(f"'{filename}'에서 추출된 텍스트가 거의 없습니다.{hint}")
    return text, warnings


def fetch_url(url: str) -> tuple[str, str]:
    """URL 본문 추출. (제목, 본문) 반환."""
    if not re.match(r"^https?://", url):
        raise IngestError("http:// 또는 https:// 로 시작하는 URL을 입력하세요.")
    try:
        r = httpx.get(url, follow_redirects=True, timeout=20,
                      headers={"User-Agent": "Mozilla/5.0 (Macintosh) CoverLetterHelper/1.0"})
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise IngestError(f"URL을 가져오지 못했습니다: {e}") from e
    html = r.text
    meta = trafilatura.extract_metadata(html)
    title = (meta.title if meta and meta.title else "") or url
    text = _normalize(_html(html))
    if len(text) < 100:
        raise IngestError(
            "본문을 거의 추출하지 못했습니다. JavaScript로 그려지는 페이지(SPA, 노션 공개 페이지 등)일 수 있습니다. "
            "페이지를 PDF로 저장하거나 텍스트를 복사해 '직접 입력'으로 추가해주세요."
        )
    return title, text
