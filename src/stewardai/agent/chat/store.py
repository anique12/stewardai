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
) -> None:
    """Append a message to a thread. On DB failure, log and no-op."""
    try:
        # Get the next seq number for this thread
        count_resp = await client.table("chat_messages").select(
            "seq", count="exact"
        ).eq("thread_id", thread_id).execute()
        seq = count_resp.count + 1 if count_resp.count else 1

        await client.table("chat_messages").insert({
            "thread_id": thread_id,
            "user_id": user_id,
            "role": role,
            "seq": seq,
            "parts": parts,
        }).execute()
    except Exception as e:
        if "relation" in str(e) or "does not exist" in str(e):
            _log.warning("chat_store_unavailable", exc_info=e)
        else:
            _log.exception("chat_store_error")
        # No-op on error; don't raise


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
