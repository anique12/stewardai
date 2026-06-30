"""Supabase async service-role client factory."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from supabase import AsyncClient


async def create_service_client(settings) -> AsyncClient:
    """Create an async Supabase client using the service-role key.

    Raises RuntimeError if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are unset.
    """
    from supabase import acreate_client

    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is not set")
    if not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")
    return await acreate_client(settings.supabase_url, settings.supabase_service_role_key)
