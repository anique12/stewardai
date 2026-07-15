"""Enqueue emails into email_outbox + owner-email resolution. Best-effort, never raises."""

from __future__ import annotations

from stewardai.common.logging import get_logger

_log = get_logger("email.outbox")


async def enqueue(
    client,  # noqa: ANN001
    *,
    user_id: str,
    kind: str,
    to_email: str,
    dedup_key: str,
    meeting_id: str | None = None,
    payload: dict | None = None,
    scheduled_for: str | None = None,
    enabled: bool = True,
) -> bool:
    """Insert one pending outbox row. No-op when disabled. Swallows the unique
    dedup_key violation (a repeated trigger never double-sends). Never raises."""
    if not enabled or not to_email:
        return False
    row = {
        "user_id": user_id,
        "kind": kind,
        "to_email": to_email,
        "dedup_key": dedup_key,
        "status": "pending",
        "payload": payload or {},
    }
    if meeting_id:
        row["meeting_id"] = meeting_id
    if scheduled_for:
        row["scheduled_for"] = scheduled_for
    try:
        await client.table("email_outbox").insert(row).execute()
        _log.info("email_enqueued", kind=kind, dedup_key=dedup_key)
        return True
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        if "duplicate key" in msg or "unique constraint" in msg:
            return False  # already enqueued — expected, not an error
        _log.warning("email_enqueue_failed", kind=kind, error=msg[:200])
        return False


async def resolve_owner_email(client, user_id: str) -> str | None:  # noqa: ANN001
    """Owner's email from profiles.email (best-effort)."""
    try:
        resp = await (
            client.table("profiles")
            .select("email")
            .eq("user_id", user_id)
            .limit(1)
            .maybe_single()
            .execute()
        )
        data = resp.data or {}
        return (data.get("email") or None) if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        return None


async def enqueue_bot_failed(
    client,  # noqa: ANN001
    settings,  # noqa: ANN001
    *,
    user_id: str,
    meeting_id: str,
    title: str | None,
    reason: str | None,
) -> None:
    """Enqueue the owner-only 'MeetBase couldn't join' email. Best-effort."""
    from stewardai.email.keys import dedup_key_for

    email = await resolve_owner_email(client, user_id)
    if not email:
        return
    await enqueue(
        client,
        user_id=user_id,
        kind="bot_failed",
        to_email=email,
        dedup_key=dedup_key_for("bot_failed", meeting_id=meeting_id),
        meeting_id=meeting_id,
        payload={"title": title, "reason": reason},
        enabled=getattr(settings, "email_enabled", False),
    )
