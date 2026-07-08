"""DB-driven integration registry: which app integrations are available.

The ``integrations`` table is the single source of truth shared with the portal,
so the chat never offers an app the portal can't connect (or vice versa). Cached
briefly so it isn't a DB hit per turn; falls back to the always-safe base set on
any error or before the migration is applied, so chat never breaks.
"""
from __future__ import annotations

import time

from stewardai.common.logging import get_logger

_log = get_logger("agent.chat.registry")

# Safe fallback (the previously-hardcoded enabled set) used when the integrations
# table is missing/unreadable, so behavior is unchanged before the migration.
_FALLBACK_AVAILABLE: list[str] = ["gmail", "googlecalendar"]

_CACHE_TTL_S = 60.0
_cache: tuple[float, list[str]] | None = None


async def load_available(client) -> list[str]:  # noqa: ANN001
    """Return the slugs of available integrations (cached ~60s; safe fallback)."""
    global _cache
    now = time.monotonic()
    if _cache is not None and (now - _cache[0]) < _CACHE_TTL_S:
        return _cache[1]
    slugs = await _fetch_available(client)
    _cache = (now, slugs)
    return slugs


async def _fetch_available(client) -> list[str]:  # noqa: ANN001
    if client is None:
        return list(_FALLBACK_AVAILABLE)
    try:
        resp = (
            await client.table("integrations").select("slug").eq("available", True).execute()
        )
        slugs = [r["slug"] for r in (resp.data or []) if r.get("slug")]
        return slugs or list(_FALLBACK_AVAILABLE)
    except Exception as exc:  # noqa: BLE001 - missing table / DB error → safe fallback
        _log.warning("integration_registry_unavailable", error=str(exc))
        return list(_FALLBACK_AVAILABLE)


def _reset_cache_for_tests() -> None:
    global _cache
    _cache = None
