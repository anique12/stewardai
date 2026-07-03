"""One LLM pass that pulls entities, topic tags, and facts from a transcript.

Mirrors stewardai.agent.summary.generate_summary: build a Message, stream
llm.complete deltas, join, strip markdown fences, json.loads with a safe fallback.
Action items are NOT re-extracted here — they already come from generate_summary;
this adds entities + decisions/dates/risks/open-questions only (DRY).
"""
from __future__ import annotations

import json

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.extraction")

_EMPTY = {"entities": [], "tags": [], "facts": []}

_SYSTEM = (
    "You extract structured knowledge from a meeting transcript. Return ONLY JSON "
    "with keys: 'entities' (array of {kind:'person'|'company', name, email(or null)}), "
    "'tags' (array of short lowercase topic strings), and 'facts' (array of "
    "{kind:'decision'|'date'|'risk'|'open_question', text, source_line(0-based line "
    "index or null), due('YYYY-MM-DD' or null)}). Only include entities actually "
    "named. Keep tags to at most 6. Do not invent facts."
)


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: -3]
    return t.strip()


async def extract_entities_and_facts(llm, transcript: list[str]) -> dict:
    """Return {"entities": [...], "tags": [...], "facts": [...]}; empty shape on failure."""
    if not transcript:
        return {"entities": [], "tags": [], "facts": []}
    body = "\n".join(f"{i}: {line}" for i, line in enumerate(transcript))
    chunks: list[str] = []
    async for delta in llm.complete(
        [Message(role="user", content=body)], system=_SYSTEM, temperature=0.2
    ):
        if delta:
            chunks.append(delta)
    raw = _strip_fences("".join(chunks))
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        _log.warning("kb_extraction_parse_failed", head=raw[:120])
        return {"entities": [], "tags": [], "facts": []}
    return {
        "entities": data.get("entities") or [],
        "tags": data.get("tags") or [],
        "facts": data.get("facts") or [],
    }
