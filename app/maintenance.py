"""시작 시 실행하는 가벼운 데이터 정리 (API 호출 없음)."""
import logging
import unicodedata

from . import db, rag
from .config import settings

log = logging.getLogger("app.maintenance")
NFC_NOTE = "한글 자모가 분해된 형태(NFD)로 저장돼 있어 정규화했습니다. 검색 정확도를 위해 '재색인'을 눌러주세요."


def normalize_hangul():
    """macOS 파일명 등에서 들어온 분해형 한글(NFD)을 완성형(NFC)으로 정리.
    - 자료 이름·검색 메타데이터: 바로 수정
    - 원본 텍스트가 바뀐 자료: 파일만 고치고 '재색인 권장' 표시 (임베딩은 비용이 들어 자동 실행하지 않음)
    """
    nfc = lambda s: unicodedata.normalize("NFC", s or "")
    fixed_names = flagged = 0
    for d in db.rows("SELECT * FROM documents"):
        if nfc(d["name"]) != d["name"] or nfc(d["source"]) != (d["source"] or ""):
            db.execute("UPDATE documents SET name=?, source=? WHERE id=?", (nfc(d["name"]), nfc(d["source"]), d["id"]))
            rag.update_metadata(d["id"], nfc(d["name"]), d["category"])
            fixed_names += 1
        raw = settings.raw_dir / f"{d['id']}.txt"
        if raw.exists():
            text = raw.read_text(encoding="utf-8")
            if nfc(text) != text:
                raw.write_text(nfc(text), encoding="utf-8")
                note = "\n".join(x for x in [d["note"], NFC_NOTE] if x)
                db.execute("UPDATE documents SET note=? WHERE id=?", (note, d["id"]))
                flagged += 1
    if fixed_names or flagged:
        log.info("한글 정규화: 이름 %d개 수정, 재색인 권장 %d개", fixed_names, flagged)


def clear_nfc_note(doc_id: str):
    d = db.row("SELECT note FROM documents WHERE id=?", (doc_id,))
    if d and d["note"] and NFC_NOTE in d["note"]:
        rest = "\n".join(x for x in d["note"].split("\n") if x != NFC_NOTE) or None
        db.execute("UPDATE documents SET note=? WHERE id=?", (rest, doc_id))
