# src/stewardai/agent/kb/embeddings.py
"""Embed a meeting's chunks into kb_chunks (L1). Best-effort: callers run this
inside ingest_meeting_kb's try/except, so a failure here never breaks teardown.

Idempotent: existing kb_chunks for the meeting are deleted before re-insert, so a
re-ingest replaces cleanly. space_id may be None (unfiled meeting) — still indexed.
"""
from __future__ import annotations

from stewardai.agent.kb.chunking import build_chunks
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.embeddings")


async def _fetch_summary_tldr(client, *, user_id: str, meeting_id: str) -> str | None:
    resp = await (
        client.table("summaries").select("tldr")
        .eq("meeting_id", meeting_id).execute()
    )
    for row in resp.data or []:
        if row.get("tldr"):
            return row["tldr"]
    return None


async def index_meeting_chunks(client, llm, *, user_id: str, space_id: str | None,
                               meeting_id: str, transcript: list[str],
                               facts: list[dict]) -> int:
    summary_tldr = await _fetch_summary_tldr(client, user_id=user_id, meeting_id=meeting_id)
    chunks = build_chunks(transcript, summary_tldr, facts)
    if not chunks:
        _log.info("kb_index_skipped", meeting_id=meeting_id, reason="no_chunks")
        return 0

    vectors = await llm.aembed([c["text"] for c in chunks], query=False)
    if len(vectors) != len(chunks):
        _log.warning("kb_index_embed_mismatch", meeting_id=meeting_id,
                     chunks=len(chunks), vectors=len(vectors))
        return 0

    rows = [{
        "user_id": user_id, "space_id": space_id, "meeting_id": meeting_id,
        "kind": c["kind"], "source_seq": c["source_seq"], "text": c["text"],
        "embedding": vec,
    } for c, vec in zip(chunks, vectors, strict=True)]

    # Idempotent replace: drop any prior chunks for this meeting, then insert.
    await client.table("kb_chunks").delete().eq("meeting_id", meeting_id).eq(
        "user_id", user_id).execute()
    await client.table("kb_chunks").insert(rows).execute()
    _log.info("kb_indexed", meeting_id=meeting_id, chunks=len(rows), space_id=space_id)
    return len(rows)
