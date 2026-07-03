"""Resolve extracted people/companies to existing global entities, or create them.

Match order: exact email (case-insensitive) -> exact name+kind (exact case).
No fuzzy matching in v1 (spec risk: merging the wrong 'John' — stay conservative).
"""
from __future__ import annotations

from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.entities")


def _domain_of(email: str | None) -> str | None:
    if email and "@" in email:
        return email.split("@", 1)[1].strip().lower() or None
    return None


async def resolve_entities(client, *, user_id: str, extracted: list[dict]) -> list[str]:
    """Return entity UUIDs for the extracted entities (matched or created)."""
    resolved: list[str] = []
    seen_keys: dict[tuple, str] = {}  # de-dupe within this call
    for ent in extracted:
        kind = (ent.get("kind") or "").strip()
        name = (ent.get("name") or "").strip()
        email = (ent.get("email") or None)
        if kind not in ("person", "company") or not name:
            continue
        key = (kind, (email or "").lower(), name.lower())
        if key in seen_keys:
            continue

        row_id: str | None = None
        if email:
            resp = await (
                client.table("entities").select("id")
                .eq("user_id", user_id).eq("kind", kind).eq("email", email.lower()).limit(1).execute()
            )
            if resp.data:
                row_id = resp.data[0]["id"]
        if row_id is None:
            resp = await (
                client.table("entities").select("id")
                .eq("user_id", user_id).eq("kind", kind).eq("name", name).limit(1).execute()
            )
            if resp.data:
                row_id = resp.data[0]["id"]
        if row_id is None:
            resp = await client.table("entities").insert({
                "user_id": user_id, "kind": kind, "name": name,
                "email": email.lower() if email else None, "domain": _domain_of(email),
            }).execute()
            row_id = resp.data[0]["id"]
            _log.info("entity_created", kind=kind, has_email=bool(email))

        seen_keys[key] = row_id
        resolved.append(row_id)
    return resolved
