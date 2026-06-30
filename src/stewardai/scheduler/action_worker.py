"""Action worker: execute approved agent_actions rows.

Polls agent_actions for state='approved', transitions them through
running -> done/failed. Idempotent: only rows currently 'approved' are touched.
"""
from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING

from stewardai.common.logging import get_logger

if TYPE_CHECKING:
    from supabase import AsyncClient

    from stewardai.integrations.composio_service import ComposioService

_log = get_logger("scheduler.action_worker")


async def run_pending_actions_once(
    client: AsyncClient,
    service: ComposioService,
) -> int:
    """Execute all approved agent_actions rows once.

    Selects rows where state='approved', transitions each to 'running',
    executes via ComposioService, then marks 'done' or 'failed'.

    Returns the number of rows processed.
    """
    resp = (
        await client.table("agent_actions")
        .select("id, user_id, action_slug, args")
        .eq("state", "approved")
        .execute()
    )
    rows = resp.data or []
    count = 0
    for row in rows:
        row_id = row["id"]
        user_id = row["user_id"]
        slug = row["action_slug"]
        args = row.get("args") or {}

        # Transition to running first (idempotent: skip if another worker grabbed it)
        try:
            await (
                client.table("agent_actions")
                .update({"state": "running"})
                .eq("id", row_id)
                .eq("state", "approved")  # guard against races
                .execute()
            )
        except Exception as exc:
            _log.warning("action_worker_running_transition_failed", row_id=row_id, error=str(exc))
            continue

        # Execute
        try:
            result = service.execute(user_id, slug, args)
            await (
                client.table("agent_actions")
                .update({"state": "done", "result": result})
                .eq("id", row_id)
                .execute()
            )
            _log.info("action_worker_done", row_id=row_id, slug=slug)
            count += 1
        except Exception as exc:
            _log.warning("action_worker_failed", row_id=row_id, slug=slug, error=str(exc))
            with contextlib.suppress(Exception):
                await (
                    client.table("agent_actions")
                    .update({"state": "failed", "error": str(exc)})
                    .eq("id", row_id)
                    .execute()
                )

    return count


async def run_forever(interval_s: int = 60) -> None:
    """Poll and execute approved actions on a recurring interval.

    Builds the service-role Supabase client and ComposioService once,
    then loops run_pending_actions_once + sleep(interval_s).
    """
    from stewardai.config import get_settings
    from stewardai.integrations.composio_service import ComposioService
    from stewardai.integrations.supabase_client import create_service_client

    s = get_settings()
    client = await create_service_client(s)
    service = ComposioService()

    _log.info("action_worker_started", interval_s=interval_s)
    while True:
        try:
            n = await run_pending_actions_once(client, service)
            if n:
                _log.info("action_worker_cycle_done", processed=n)
        except Exception as exc:
            _log.warning("action_worker_cycle_error", error=str(exc))
        await asyncio.sleep(interval_s)
