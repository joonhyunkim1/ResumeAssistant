"""로컬 Chroma 벡터DB 기반 RAG. 임베딩만 OpenAI를 사용하고 벡터·원문은 로컬에 저장."""
import re

import chromadb
from chromadb.config import Settings as ChromaSettings

from . import db, llm, pii
from .config import settings

_client = chromadb.PersistentClient(
    path=str(settings.chroma_dir), settings=ChromaSettings(anonymized_telemetry=False)
)
_col = _client.get_or_create_collection(
    "documents", metadata={"hnsw:space": "cosine"}, embedding_function=None
)

_SENT_SPLIT = re.compile(r"(?<=[.!?。])\s+|\n")


def _split_long(text: str, size: int) -> list[str]:
    pieces, cur = [], ""
    for sent in _SENT_SPLIT.split(text):
        if not sent:
            continue
        if len(cur) + len(sent) + 1 > size and cur:
            pieces.append(cur)
            cur = ""
        while len(sent) > size:  # 문장 자체가 너무 긴 경우
            pieces.append(sent[:size])
            sent = sent[size:]
        cur = f"{cur} {sent}".strip()
    if cur:
        pieces.append(cur)
    return pieces


def chunk_text(text: str, size: int | None = None, overlap: int | None = None) -> list[str]:
    """문단 단위로 묶되 size를 넘지 않게 자르고, 앞 청크의 끝부분을 overlap만큼 이어붙인다."""
    size = size or settings.chunk_size
    overlap = overlap if overlap is not None else settings.chunk_overlap
    units: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        units.extend([para] if len(para) <= size else _split_long(para, size))

    chunks, cur = [], ""
    for u in units:
        if cur and len(cur) + len(u) + 2 > size:
            chunks.append(cur)
            tail = cur[-overlap:] if overlap else ""
            cur = f"{tail}\n\n{u}" if tail else u
        else:
            cur = f"{cur}\n\n{u}" if cur else u
    if cur:
        chunks.append(cur)
    return chunks


def index_document(doc_id: str, name: str, category: str, text: str) -> int:
    delete_document(doc_id)
    chunks = [pii.mask(c) for c in chunk_text(text)]
    if not chunks:
        return 0
    # 임베딩 시 문서명·분류를 앞에 붙이면 검색 정확도가 올라간다
    to_embed = [f"[{category}] {name}\n{c}" for c in chunks]
    vectors = llm.embed(to_embed, purpose="자료 색인")
    _col.add(
        ids=[f"{doc_id}:{i}" for i in range(len(chunks))],
        documents=chunks,
        embeddings=vectors,
        metadatas=[{"doc_id": doc_id, "name": name, "category": category, "idx": i} for i in range(len(chunks))],
    )
    return len(chunks)


def update_metadata(doc_id: str, name: str, category: str):
    got = _col.get(where={"doc_id": doc_id}, include=["metadatas"])
    if got["ids"]:
        metas = [{**m, "name": name, "category": category} for m in got["metadatas"]]
        _col.update(ids=got["ids"], metadatas=metas)


def delete_document(doc_id: str):
    _col.delete(where={"doc_id": doc_id})


def get_chunks(doc_id: str) -> list[str]:
    got = _col.get(where={"doc_id": doc_id}, include=["documents", "metadatas"])
    pairs = sorted(zip(got["metadatas"], got["documents"]), key=lambda p: p[0]["idx"])
    return [d for _, d in pairs]


PROFILE_PREFIX = "profile-"  # 마스터 프로필 항목은 doc_id = "profile-<항목 id>"로 색인


def search(queries: list[str], k: int | None = None, exclude: set[str] | None = None) -> list[dict]:
    """여러 검색어로 조회 후 청크별 최고 유사도로 병합. 비활성화된 자료는 제외, 마스터 프로필은 항상 포함."""
    k = k or settings.rag_top_k
    enabled = [r["id"] for r in db.rows("SELECT id FROM documents WHERE enabled=1")]
    enabled += [PROFILE_PREFIX + r["id"] for r in db.rows("SELECT id FROM profile_entries WHERE indexed=1")]
    enabled = [d for d in enabled if d not in (exclude or set())]
    queries = [q for q in queries if q.strip()]
    if not enabled or not queries or _col.count() == 0:
        return []
    vectors = llm.embed([pii.mask(q) for q in queries], purpose="검색")
    where = {"doc_id": {"$in": enabled}} if len(enabled) > 1 else {"doc_id": enabled[0]}
    res = _col.query(query_embeddings=vectors, n_results=k, where=where,
                     include=["documents", "metadatas", "distances"])
    best: dict[str, dict] = {}
    for ids, docs, metas, dists in zip(res["ids"], res["documents"], res["metadatas"], res["distances"]):
        for cid, doc, meta, dist in zip(ids, docs, metas, dists):
            score = 1 - dist
            if cid not in best or score > best[cid]["score"]:
                best[cid] = {"id": cid, "text": doc, "name": meta["name"], "category": meta["category"],
                             "doc_id": meta["doc_id"], "score": round(score, 3)}
    return sorted(best.values(), key=lambda x: x["score"], reverse=True)[:k]
