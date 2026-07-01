"""Meeting scheduler: watch Supabase for due opted-in meetings and, for each,
spawn the Vexa bot plus a fresh agent pinned to that meeting.

This automates both "instant join" (a meeting created moments before it starts)
and calendar-driven joins: a poll worker selects meetings whose `start_time`
falls inside the join window, spawns a Vexa bot into the Google Meet, and
launches `stewardai.agent.meeting_runner` pinned to that Vexa meeting.

SINGLE-MEETING CONSTRAINT (v1)
------------------------------
The agent binds ONE TCP bridge on BRIDGE_TCP_PORT (default 8765) and every bot's
audio forwarder dials that same port, so only ONE agent process can run at a
time. The scheduler therefore supports exactly ONE active meeting: it holds a
single-slot `SchedulerState` and skips dispatch while that slot is occupied.
Lifting this requires per-meeting bridge ports (not yet built).

vexa_meeting_id COLUMN NOTE
---------------------------
The `meetings.vexa_meeting_id` column is a UUID, but Vexa's meeting id is an
INTEGER (e.g. 130). We deliberately do NOT write the int into that column
(type mismatch); we leave it null and instead pass the id to the agent via the
`VEXA_MEETING_ID` env override.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import httpx

from stewardai.common.logging import get_logger

if TYPE_CHECKING:
    from supabase import AsyncClient

    from stewardai.config import Settings

_log = get_logger("scheduler.meeting_scheduler")

# Join window: catch meetings that started up to LOOK_BEHIND_S ago (join grace
# for already-running meetings) and that will start within LOOK_AHEAD_S.
LOOK_BEHIND_S = 300   # 5 minutes grace for already-started meetings
LOOK_AHEAD_S = 600    # 10 minutes lookahead

# Bot identity shown in the meeting participant list.
BOT_NAME = "StewardAI"

# Command that launches the meeting agent (run from the repo root).
AGENT_CMD = ["bash", "scripts/run_meeting.sh"]


async def get_due_meetings(client: AsyncClient) -> list[dict]:
    """Return opted-in, pending meetings whose start_time is inside the join window.

    Filters: opted_in is True, bot_status == 'pending', start_time within
    [now - LOOK_BEHIND_S, now + LOOK_AHEAD_S], and a meet_url is present.
    """
    now = datetime.now(UTC)
    window_start = (now - timedelta(seconds=LOOK_BEHIND_S)).isoformat()
    window_end = (now + timedelta(seconds=LOOK_AHEAD_S)).isoformat()
    resp = (
        await client.table("meetings")
        .select("id, user_id, meet_url, native_meeting_id, opted_in, bot_status, start_time")
        .eq("opted_in", True)
        .eq("bot_status", "pending")
        .gte("start_time", window_start)
        .lte("start_time", window_end)
        .execute()
    )
    rows = resp.data or []
    # meet_url must be present to spawn a bot; drop rows without one.
    return [r for r in rows if r.get("meet_url")]


async def spawn_bot(meeting: dict, settings: Settings) -> dict:
    """Spawn a Vexa bot for the meeting via the gateway; return the response JSON.

    POSTs {gateway}/bots with the X-API-Key header. Raises on a non-2xx response
    (the caller marks the meeting failed).
    """
    payload = {"meeting_url": meeting["meet_url"], "bot_name": BOT_NAME}
    async with httpx.AsyncClient() as http:
        resp = await http.post(
            f"{settings.vexa_gateway_url}/bots",
            json=payload,
            headers={"X-API-Key": settings.vexa_api_key or ""},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()


def spawn_agent(vexa_meeting_id: str, user_id: str) -> subprocess.Popen:
    """Launch the meeting agent pinned to a Vexa meeting + owner.

    Runs scripts/run_meeting.sh from the repo root, inheriting the current env
    (STT/TTS/GEMINI/COMPOSIO/SUPABASE/...) and overriding VEXA_MEETING_ID (the
    Vexa integer id, as a string) and VEXA_USER_ID (the meeting owner's UUID, so
    the agent loads that owner's Composio tools).
    """
    env = {**os.environ, "VEXA_MEETING_ID": str(vexa_meeting_id), "VEXA_USER_ID": user_id}
    return subprocess.Popen(AGENT_CMD, env=env)  # noqa: S603 — fixed command, no shell


@dataclass
class SchedulerState:
    """In-memory single-slot lifecycle for the one active meeting.

    Holds the currently-active meeting id and its agent process handle. Empty
    (both None) when the slot is free.
    """

    meeting_id: str | None = None
    proc: subprocess.Popen | None = None

    @property
    def busy(self) -> bool:
        return self.proc is not None

    def clear(self) -> None:
        self.meeting_id = None
        self.proc = None


async def dispatch_meeting(
    client: AsyncClient, settings: Settings, meeting: dict
) -> subprocess.Popen | None:
    """Spawn the Vexa bot + agent for one meeting, transitioning bot_status.

    On success: mark the row bot_status='joining' (+ native_meeting_id from the
    response when present), launch the agent pinned to the Vexa id, and return
    the process handle. On any failure: mark bot_status='failed' and return None.

    The Vexa id (an int) is passed to the agent via env — it is NOT written to
    the row's UUID vexa_meeting_id column (type mismatch; see module docstring).
    """
    meeting_id = meeting["id"]
    try:
        resp = await spawn_bot(meeting, settings)
        vexa_id = resp["id"]

        update: dict = {"bot_status": "joining"}
        native_id = resp.get("native_meeting_id")
        if native_id:
            update["native_meeting_id"] = native_id
        await (
            client.table("meetings").update(update).eq("id", meeting_id).execute()
        )

        proc = spawn_agent(str(vexa_id), meeting["user_id"])
        _log.info(
            "meeting_dispatched",
            meeting_id=meeting_id,
            vexa_meeting_id=vexa_id,
            user_id=meeting["user_id"],
        )
        return proc
    except Exception as exc:
        _log.warning("meeting_dispatch_failed", meeting_id=meeting_id, error=str(exc))
        try:
            await (
                client.table("meetings")
                .update({"bot_status": "failed"})
                .eq("id", meeting_id)
                .execute()
            )
        except Exception as exc2:  # noqa: BLE001 — best-effort failure marking
            _log.warning(
                "meeting_failed_mark_failed", meeting_id=meeting_id, error=str(exc2)
            )
        return None


async def run_once(client: AsyncClient, settings: Settings, state: SchedulerState) -> None:
    """One scheduler cycle: reap a finished agent, then fill the free slot.

    1. Reap: if the slot holds a process that has exited (poll() is not None),
       the agent is done -> mark its meeting bot_status='done' and free the slot.
    2. Dispatch: only if the slot is free, fetch due meetings and dispatch the
       first one (single-meeting constraint). If busy, log and skip.
    """
    # 1. Reap a finished agent.
    if state.busy and state.proc is not None and state.proc.poll() is not None:
        finished_id = state.meeting_id
        _log.info("meeting_agent_exited", meeting_id=finished_id, code=state.proc.returncode)
        try:
            await (
                client.table("meetings")
                .update({"bot_status": "done"})
                .eq("id", finished_id)
                .execute()
            )
        except Exception as exc:  # noqa: BLE001 — best-effort completion marking
            _log.warning("meeting_done_mark_failed", meeting_id=finished_id, error=str(exc))
        state.clear()

    # 2. Only dispatch when the slot is free (single-meeting constraint).
    if state.busy:
        _log.info("scheduler_slot_busy", active_meeting_id=state.meeting_id)
        return

    meetings = await get_due_meetings(client)
    if not meetings:
        return

    meeting = meetings[0]
    if len(meetings) > 1:
        _log.info(
            "scheduler_deferring_extra_meetings",
            dispatching=meeting["id"],
            deferred=len(meetings) - 1,
        )
    proc = await dispatch_meeting(client, settings, meeting)
    if proc is not None:
        state.meeting_id = meeting["id"]
        state.proc = proc


async def run_forever(interval_s: int = 30) -> None:
    """Poll for due meetings on a recurring interval, dispatching one at a time.

    Builds the service-role Supabase client + settings once, holds a single-slot
    SchedulerState, then loops run_once + sleep(interval_s). Each cycle is
    guarded so one bad cycle can't kill the loop.
    """
    from stewardai.config import get_settings
    from stewardai.integrations.supabase_client import create_service_client

    settings = get_settings()
    client = await create_service_client(settings)
    state = SchedulerState()

    _log.info("meeting_scheduler_started", interval_s=interval_s)
    while True:
        try:
            await run_once(client, settings, state)
        except Exception as exc:  # noqa: BLE001 — never let one cycle kill the loop
            _log.warning("meeting_scheduler_cycle_error", error=str(exc))
        await asyncio.sleep(interval_s)


if __name__ == "__main__":
    asyncio.run(run_forever())
