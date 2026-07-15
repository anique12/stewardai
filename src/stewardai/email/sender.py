"""Drain email_outbox: render + send via Resend, with suppression, retries, idempotency."""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta

from stewardai.common.logging import get_logger
from stewardai.email.suppressions import is_suppressed
from stewardai.email.templates import render

_log = get_logger("email.sender")
_MAX_ATTEMPTS = 5


async def run_pending_emails_once(client, resend, settings) -> int:  # noqa: ANN001
    """Process due pending outbox rows once. Returns the number sent. Never raises."""
    now = datetime.now(UTC)
    try:
        resp = await (
            client.table("email_outbox")
            .select("id, kind, to_email, dedup_key, payload, attempts")
            .eq("status", "pending")
            .lte("scheduled_for", now.isoformat())
            .limit(100)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:  # noqa: BLE001
        _log.warning("email_poll_failed", error=str(exc))
        return 0

    sent = 0
    for row in rows:
        rid, to_email = row["id"], row["to_email"]
        # Suppression: skip + mark, never send.
        if await is_suppressed(client, to_email):
            await _update(client, rid, {"status": "suppressed"})
            continue
        try:
            payload = dict(row.get("payload") or {})
            payload.setdefault("app_url", settings.public_app_url)
            subject, html = render(row["kind"], payload)
            await resend.send(
                sender=settings.email_from,
                to=to_email,
                subject=subject,
                html=html,
                reply_to=settings.email_reply_to,
                idempotency_key=row["dedup_key"],
            )
            await _update(client, rid, {"status": "sent", "sent_at": now.isoformat()})
            sent += 1
        except Exception as exc:  # noqa: BLE001
            attempts = int(row.get("attempts") or 0) + 1
            patch = {"attempts": attempts, "last_error": str(exc)[:500]}
            if attempts >= _MAX_ATTEMPTS:
                patch["status"] = "failed"
            else:
                backoff = timedelta(minutes=2**attempts)
                patch["scheduled_for"] = (now + backoff).isoformat()
            await _update(client, rid, patch)
            _log.warning(
                "email_send_failed",
                kind=row.get("kind"),
                attempts=attempts,
                error=str(exc)[:200],
            )
    return sent


async def _update(client, rid: str, patch: dict) -> None:  # noqa: ANN001
    with contextlib.suppress(Exception):
        await client.table("email_outbox").update(patch).eq("id", rid).execute()
