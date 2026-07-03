"""Meeting scheduler: watch Supabase for due opted-in meetings and spawn a bot
for each.

This automates both "instant join" (a meeting created moments before it starts)
and calendar-driven joins: a poll worker selects meetings whose `start_time`
falls inside the join window and spawns a Vexa bot into each Google Meet.

MULTIPLEXER MODEL
-----------------
The agent is a SINGLE long-lived multiplexing process (``run_multiplexer`` in
``stewardai.agent.meeting_runner``): one process listens on one port and each
Vexa bot dials in to get its OWN per-connection ``MeetingSession`` (identity is
resolved from the handshake). The scheduler therefore NO LONGER spawns a
per-meeting agent process and has NO single-meeting slot — it simply dispatches
a bot for EVERY due meeting each cycle (concurrent meetings are fine). The
multiplexer owns the agent lifecycle and the ``in_meeting``/``done`` writeback.

vexa_meeting_id COLUMN NOTE
---------------------------
The `meetings.vexa_meeting_id` column is a UUID, but Vexa's meeting id is an
INTEGER (e.g. 130). We deliberately do NOT write the int into that column
(type mismatch); we leave it null. The multiplexer resolves each connection's
owner via ``native_meeting_id`` instead.
"""
from __future__ import annotations

import asyncio
import time
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

# Calendar sync runs on this cadence (not every dispatch poll) — events change
# slowly and each sync is a Composio API call.
CALENDAR_SYNC_INTERVAL_S = 300  # 5 minutes

# Bot identity shown in the meeting participant list.
BOT_NAME = "StewardAI"

# How long the bot stays after it's the ONLY participant left before leaving
# on its own (ms). Vexa's default is 900000 (15 min), which leaves the bot
# lingering long after everyone has gone; 60s leaves promptly once alone.
# "Alone" = only the bot remains, so this never fires while a human is present.
ALONE_LEAVE_MS = 60_000


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


async def _bot_name_for(client: AsyncClient, user_id: str | None) -> str:
    """The owner's configured display name (profiles.bot_name), or the default.

    Set in the portal Settings page (profiles.bot_name); the scheduler used to
    hardcode "StewardAI" and ignore it. Best-effort — falls back to the default.
    """
    if not user_id:
        return BOT_NAME
    try:
        resp = await (
            client.table("profiles")
            .select("bot_name")
            .eq("user_id", user_id)
            .execute()
        )
        rows = resp.data or []
        name = ((rows[0].get("bot_name") if rows else None) or "").strip()
        return name or BOT_NAME
    except Exception as exc:  # noqa: BLE001 — fall back to the default name
        _log.warning("bot_name_lookup_failed", user_id=user_id, error=str(exc))
        return BOT_NAME


async def spawn_bot(
    meeting: dict, settings: Settings, *, bot_name: str = BOT_NAME
) -> dict:
    """Spawn a Vexa bot for the meeting via the gateway; return the response JSON.

    POSTs {gateway}/bots with the X-API-Key header. Raises on a non-2xx response
    (the caller marks the meeting failed). ``bot_name`` is the display name shown
    in the participant list (the meeting owner's configured name).
    """
    payload = {
        "meeting_url": meeting["meet_url"],
        "bot_name": bot_name,
        # Leave promptly once everyone else has gone (Vexa default is 15 min).
        "automatic_leave": {"max_time_left_alone": ALONE_LEAVE_MS},
        # Authenticated join (logged-in Google account) so Google's anti-bot doesn't
        # remove the anonymous bot ~13s after admission. meeting-api injects the
        # userdataS3Path + MinIO config; the bot restores the staged session cookies.
        "authenticated": settings.vexa_bot_authenticated,
    }
    async with httpx.AsyncClient() as http:
        resp = await http.post(
            f"{settings.vexa_gateway_url}/bots",
            json=payload,
            headers={"X-API-Key": settings.vexa_api_key or ""},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()


async def dispatch_meeting(
    client: AsyncClient, settings: Settings, meeting: dict
) -> None:
    """Spawn the Vexa bot for one meeting, transitioning bot_status.

    On success: mark the row bot_status='joining' (+ native_meeting_id from the
    response when present). On any failure: mark bot_status='failed'.

    No agent process is launched — the long-lived multiplexer accepts the bot's
    connection and resolves the meeting owner per-connection via native_meeting_id.
    The Vexa id (an int) is NOT written to the row's UUID vexa_meeting_id column
    (type mismatch; see module docstring).
    """
    meeting_id = meeting["id"]
    try:
        bot_name = await _bot_name_for(client, meeting.get("user_id"))
        resp = await spawn_bot(meeting, settings, bot_name=bot_name)

        update: dict = {"bot_status": "joining"}
        native_id = resp.get("native_meeting_id")
        if native_id:
            update["native_meeting_id"] = native_id
        await (
            client.table("meetings").update(update).eq("id", meeting_id).execute()
        )

        _log.info(
            "meeting_dispatched",
            meeting_id=meeting_id,
            vexa_meeting_id=resp.get("id"),
            native_meeting_id=native_id,
            user_id=meeting.get("user_id"),
        )
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


async def run_once(client: AsyncClient, settings: Settings) -> None:
    """One scheduler cycle: dispatch a bot for EVERY due meeting.

    Concurrent meetings are fine — the multiplexer serves them all — so there is
    no slot limit and no agent reaping here. Each dispatch is independent and
    already guarded internally (marks the row failed on its own errors).
    """
    meetings = await get_due_meetings(client)
    if not meetings:
        return

    _log.info("scheduler_dispatching", count=len(meetings))
    for meeting in meetings:
        await dispatch_meeting(client, settings, meeting)


async def run_forever(interval_s: int = 30) -> None:
    """Poll for due meetings on a recurring interval, dispatching a bot for each.

    Builds the service-role Supabase client + settings once, then loops
    run_once + sleep(interval_s). Each cycle is guarded so one bad cycle can't
    kill the loop.
    """
    from stewardai.config import get_settings
    from stewardai.integrations.supabase_client import create_service_client

    settings = get_settings()
    client = await create_service_client(settings)

    # Calendar auto-join: reuse each user's Composio googlecalendar connection to
    # pull organizer-owned Meet events into `meetings` (opted_in=true) before we
    # dispatch. Guarded + best-effort; only when Composio is enabled.
    composio = None
    llm = None
    if settings.composio_enabled:
        try:
            from stewardai.factory import make_llm
            from stewardai.integrations.composio_service import ComposioService

            composio = ComposioService()
            llm = make_llm(settings)  # for calendar keyterm (domain-term) extraction
        except Exception as exc:  # noqa: BLE001
            _log.warning("scheduler_composio_init_failed", error=str(exc))

    # Calendar events don't change every 30s (and each sync is a Composio call), so
    # run the sync on a slower cadence than the dispatch poll.
    last_sync = 0.0
    _log.info("meeting_scheduler_started", interval_s=interval_s)
    while True:
        if composio is not None and (time.monotonic() - last_sync) >= CALENDAR_SYNC_INTERVAL_S:
            last_sync = time.monotonic()
            try:
                from stewardai.scheduler.calendar_sync import sync_calendars_once

                n = await sync_calendars_once(client, composio, llm=llm)
                if n:
                    _log.info("calendar_synced", meetings=n)
            except Exception as exc:  # noqa: BLE001 — sync failure can't stop dispatch
                _log.warning("calendar_sync_cycle_error", error=str(exc))
        try:
            await run_once(client, settings)
        except Exception as exc:  # noqa: BLE001 — never let one cycle kill the loop
            _log.warning("meeting_scheduler_cycle_error", error=str(exc))
        await asyncio.sleep(interval_s)


if __name__ == "__main__":
    asyncio.run(run_forever())
