"""Write chat threads + messages via async Supabase client. Best-effort store:
every DB call wrapped so relation errors return safe defaults, never raise.
"""
from __future__ import annotations

from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.chat.store")


async def create_thread(client, *, user_id: str, title: str) -> str | None:
    """Create a chat thread. On DB failure, log and return None."""
    try:
        resp = await client.table("chat_threads").insert({
            "user_id": user_id,
            "title": title,
        }).execute()
        return resp.data[0]["id"]
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        return None


async def append_message(
    client, *, user_id: str, thread_id: str, role: str, parts: list[Any]
) -> str | None:
    """Append a message to a thread; return its row id (or None on failure)."""
    try:
        # Get the next seq number for this thread
        count_resp = await client.table("chat_messages").select(
            "seq", count="exact"
        ).eq("thread_id", thread_id).execute()
        seq = count_resp.count + 1 if count_resp.count else 1

        resp = await client.table("chat_messages").insert({
            "thread_id": thread_id,
            "user_id": user_id,
            "role": role,
            "seq": seq,
            "parts": parts,
        }).execute()
        data = resp.data or []
        return data[0].get("id") if data else None
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        return None  # No-op on error; don't raise


async def update_message(client, *, message_id: str, parts: list[Any]) -> None:
    """Overwrite a message's ``parts`` (used to finalize a paused turn's row in
    place, so a resumed turn updates its persisted card instead of duplicating).
    Best-effort: log and no-op on failure."""
    try:
        await client.table("chat_messages").update({"parts": parts}).eq(
            "id", message_id
        ).execute()
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")


async def thread_owned(client, *, user_id: str, thread_id: str) -> bool:
    """Check whether ``thread_id`` belongs to ``user_id``. Best-effort: any DB
    error (including a missing table or a malformed/nonexistent thread_id) is
    treated as "not owned" rather than raised, so callers can safely fall back
    to creating a fresh thread instead of trusting a client-supplied id."""
    try:
        resp = await client.table("chat_threads").select("id").eq(
            "id", thread_id
        ).eq("user_id", user_id).execute()
        return bool(resp.data)
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        return False


async def list_threads(client, *, user_id: str) -> list:
    """List all threads for a user. On DB failure, return empty list."""
    try:
        resp = await client.table("chat_threads").select(
            "id, title, created_at, updated_at"
        ).eq("user_id", user_id).order("updated_at", desc=True).execute()
        return resp.data or []
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        return []


async def get_thread_messages(
    client, *, user_id: str, thread_id: str
) -> list:
    """Get all messages for a thread. On DB failure, return empty list."""
    try:
        resp = await client.table("chat_messages").select(
            "id, role, seq, parts, created_at"
        ).eq("user_id", user_id).eq("thread_id", thread_id).order(
            "seq", desc=False
        ).execute()
        return resp.data or []
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        return []


async def is_allowed(client, *, user_id: str, tool_name: str) -> bool:
    """Check whether ``user_id`` has "always allow"-ed ``tool_name``. Best-effort:
    any DB error (including a missing table) is treated as not-allowed rather
    than raised."""
    try:
        resp = await client.table("tool_permissions").select("id").eq(
            "user_id", user_id
        ).eq("tool_name", tool_name).eq("allowed", True).limit(1).execute()
        return bool(resp.data)
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        return False


async def set_allowed(client, *, user_id: str, tool_name: str) -> None:
    """Record that ``user_id`` always allows ``tool_name``. Best-effort no-op
    on DB failure."""
    try:
        await client.table("tool_permissions").upsert(
            {
                "user_id": user_id,
                "tool_name": tool_name,
                "scope": None,
                "allowed": True,
            },
            on_conflict="user_id,tool_name,scope",
        ).execute()
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")


async def get_allowlist(client, *, user_id: str) -> list:
    """List all tool permission rows for a user. On DB failure, return empty list."""
    try:
        resp = await client.table("tool_permissions").select(
            "id, tool_name, scope, allowed, created_at"
        ).eq("user_id", user_id).execute()
        return resp.data or []
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        return []
