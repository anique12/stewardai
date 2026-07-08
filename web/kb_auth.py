# web/kb_auth.py
"""Verify a Supabase access token (Bearer) and return the user id, or None.

Uses the Supabase auth server to validate the JWT (no local secret needed): the
async client's auth.get_user(jwt) round-trips to GoTrue and returns the user.
"""
from __future__ import annotations

from contextlib import suppress

from stewardai.common.logging import get_logger

_log = get_logger("web.kb_auth")


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


async def user_id_from_bearer(authorization: str | None, client) -> str | None:
    token = _bearer(authorization)
    if not token:
        return None
    with suppress(Exception):
        resp = await client.auth.get_user(token)
        user = getattr(resp, "user", None)
        if user is not None and getattr(user, "id", None):
            return user.id
    _log.info("ask_auth_rejected")
    return None
