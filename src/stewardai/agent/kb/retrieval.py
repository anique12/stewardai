# src/stewardai/agent/kb/retrieval.py
"""L2 retrieval: embed the question, cosine top-k via the match_kb_chunks RPC.

User-scoped (RPC filters p_user_id; service-role bypasses RLS so this is the real
tenant boundary). Optionally scoped to one Space. Returns rows with provenance.
"""
from __future__ import annotations

import json

from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.retrieval")


async def retrieve(client, llm, *, user_id: str, query: str,
                   space_id: str | None = None, k: int = 8) -> list[dict]:
    if not query or not query.strip():
        return []
    vectors = await llm.aembed([query.strip()], query=True)
    if not vectors:
        return []
    resp = await client.rpc("match_kb_chunks", {
        "p_user_id": user_id,
        "query_embedding": json.dumps(vectors[0]),  # array-as-text → ::vector in SQL
        "match_count": k,
        "p_space_id": space_id,
    }).execute()
    rows = resp.data or []
    _log.info("kb_retrieved", user_id=user_id, space_id=space_id, hits=len(rows))
    return rows
