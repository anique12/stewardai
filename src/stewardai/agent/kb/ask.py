# src/stewardai/agent/kb/ask.py
"""L2 Ask: retrieve → synthesize a source-cited answer. Answers ONLY from the
retrieved context; if the context lacks the answer, says so (no fabrication).
"""
from __future__ import annotations

from stewardai.agent.kb.retrieval import retrieve
from stewardai.common.audio import Message
from stewardai.common.logging import get_logger
from stewardai.config import get_settings
from stewardai.observability.usage_context import usage_scope

_log = get_logger("agent.kb.ask")

_NO_CONTEXT = (
    "I don't have anything in your knowledge base about that yet."
)

_SYSTEM = (
    "You are Steward, answering the user's question about their meetings and work. "
    "Use ONLY the numbered context below. Cite the sources you use with [n] markers "
    "that match the context numbers. If the context does not contain the answer, say "
    "you don't have that information — do not guess. Be concise."
)


def _snippet(text: str, limit: int = 160) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def answer_question(client, llm, *, user_id: str, query: str,
                          space_id: str | None = None) -> dict:
    # Attribute the embedding (retrieve) + the synthesis LLM call to feature="ask".
    with usage_scope(
        feature="ask",
        user_id=user_id,
        context={"space_id": space_id} if space_id else None,
    ):
        rows = await retrieve(client, llm, user_id=user_id, query=query, space_id=space_id,
                              k=get_settings().ask_top_k)
        if not rows:
            return {"answer": _NO_CONTEXT, "citations": []}

        citations = [{
            "n": i + 1,
            "meeting_id": r.get("meeting_id"),
            "source_seq": r.get("source_seq"),
            "kind": r.get("kind"),
            "snippet": _snippet(r.get("text", "")),
        } for i, r in enumerate(rows)]

        context = "\n".join(
            f"[{c['n']}] {r.get('text', '')}" for c, r in zip(citations, rows, strict=True)
        )
        user_msg = f"Question: {query}\n\nContext:\n{context}"

        parts: list[str] = []
        async for token in llm.complete([Message(role="user", content=user_msg)],
                                        system=_SYSTEM, temperature=0.2):
            parts.append(token)
        answer = "".join(parts).strip()
        _log.info("kb_ask_answered", user_id=user_id, space_id=space_id,
                  hits=len(rows), chars=len(answer))
        return {"answer": answer, "citations": citations}
