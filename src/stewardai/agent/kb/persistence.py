"""Write KB rows via the async Supabase service client. Mirrors
stewardai.agent.persistence: user_id on every row, idempotent delete-then-insert
for link tables, each guarded by the caller. No ORM.
"""
from __future__ import annotations

import re
from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.persistence")

# space_facts.due is a DATE column — only accept real ISO calendar dates; the
# LLM often emits vague strings ("Friday", "next week") which must become NULL.
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _coerce_due(value: Any) -> str | None:
    """Keep only real YYYY-MM-DD values; everything else → None (date column)."""
    if isinstance(value, str) and _ISO_DATE_RE.match(value.strip()):
        return value.strip()
    return None


def _coerce_seq(value: Any) -> int | None:
    """Keep only real integer transcript indices; everything else → None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


async def create_space(client, *, user_id: str, name: str) -> str:
    resp = await client.table("spaces").insert({"user_id": user_id, "name": name}).execute()
    return resp.data[0]["id"]


async def set_meeting_space(client, *, user_id, meeting_id, space_id, confidence, source) -> None:
    await (
        client.table("meetings")
        .update({"space_id": space_id, "space_confidence": confidence, "space_source": source})
        .eq("id", meeting_id).eq("user_id", user_id).execute()
    )


async def link_meeting_entities(client, *, user_id, meeting_id, entity_ids) -> None:
    if not entity_ids:
        return
    rows = [{"user_id": user_id, "meeting_id": meeting_id, "entity_id": eid} for eid in entity_ids]
    # upsert on (meeting_id, entity_id) unique constraint -> idempotent re-runs
    await client.table("meeting_entities").upsert(
        rows, on_conflict="meeting_id,entity_id").execute()


async def set_meeting_tags(client, *, user_id, meeting_id, tags) -> None:
    await client.table("meeting_tags").delete().eq("meeting_id", meeting_id).execute()
    if tags:
        rows = [{"user_id": user_id, "meeting_id": meeting_id, "tag": t} for t in tags]
        await client.table("meeting_tags").insert(rows).execute()


async def insert_facts(client, *, user_id, space_id, meeting_id, facts) -> int:
    if space_id is None or not facts:
        return 0
    rows = [{
        "user_id": user_id, "space_id": space_id, "meeting_id": meeting_id,
        "kind": f.get("kind"), "text": f.get("text"),
        "source_seq": _coerce_seq(f.get("source_line")), "due": _coerce_due(f.get("due")),
    } for f in facts if f.get("kind") and f.get("text")]
    if not rows:
        return 0
    await client.table("space_facts").insert(rows).execute()
    return len(rows)


async def record_filing_hints(client, *, user_id, space_id, attendee_emails, domains) -> None:
    """Upsert signal->space hints so future filing for this user gets more confident."""
    rows = []
    for email in attendee_emails or []:
        rows.append({"user_id": user_id, "kind": "attendee_email", "value": email.lower(),
                     "space_id": space_id, "weight": 1})
    for dom in domains or []:
        rows.append({"user_id": user_id, "kind": "domain", "value": dom.lower(),
                     "space_id": space_id, "weight": 1})
    if rows:
        await client.table("filing_hints").upsert(
            rows, on_conflict="user_id,kind,value,space_id").execute()
