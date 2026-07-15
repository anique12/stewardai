"""Suppression-list check (unsubscribed / bounced / complained)."""

from __future__ import annotations


async def is_suppressed(client, email: str) -> bool:  # noqa: ANN001
    try:
        resp = await (
            client.table("email_suppressions").select("email").eq("email", email).limit(1).execute()
        )
        return bool(resp.data)
    except Exception:  # noqa: BLE001
        return False
