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
import contextlib
import time
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import httpx

from stewardai.common.logging import get_logger
from stewardai.scheduler.calendar_sync import _native_id

if TYPE_CHECKING:
    from supabase import AsyncClient

    from stewardai.config import Settings

_log = get_logger("scheduler.meeting_scheduler")

# Join window: catch meetings that started up to LOOK_BEHIND_S ago (join grace
# for already-running meetings) and that will start within LOOK_AHEAD_S.
# LOOK_AHEAD_S controls how early the bot joins: with a 30s poll, a 60s lookahead
# dispatches the bot ~30–60s before start (it should be in the room about a
# minute before). Raise it to join earlier.
LOOK_BEHIND_S = 300   # 5 minutes grace for already-started meetings
LOOK_AHEAD_S = 60     # join ~1 minute before start

# Calendar sync runs on this cadence (not every dispatch poll) — events change
# slowly and each sync is a Composio API call.
CALENDAR_SYNC_INTERVAL_S = 300  # 5 minutes

# Reconciliation: our meetings.bot_status is written by the agent's teardown, so
# a bot that leaves cleanly transitions joining/in_meeting -> done. But if the
# agent process is restarted or the connection drops, teardown never runs and the
# row is stranded "live" forever. We resync against Vexa's authoritative meeting
# status: Vexa itself ends the bot when it's alone (left_alone) or the call ends,
# so if Vexa no longer reports an ACTIVE meeting for a native id, our row is stale.
# Vexa MeetingStatus values that mean "still in the call" (anything else = ended).
_VEXA_ACTIVE_STATUSES = frozenset(
    {"requested", "joining", "awaiting_admission", "active", "needs_human_help", "stopping"}
)
# Only reconcile rows untouched for at least this long, so a just-dispatched bot
# that Vexa's /bots list hasn't registered yet is never closed prematurely.
RECONCILE_GRACE_S = 180

# Bot identity shown in the meeting participant list.
BOT_NAME = "MeetBase"

# How long the bot stays after it's the ONLY participant left before leaving
# on its own (ms). Vexa's default is 900000 (15 min), which leaves the bot
# lingering long after everyone has gone; 60s leaves promptly once alone.
# "Alone" = only the bot remains, so this never fires while a human is present.
ALONE_LEAVE_MS = 60_000


def _group_key(meeting: dict) -> str | None:
    """Dedup key for a due row: stored native_meeting_id, else derived from the
    meet_url (instant-join rows may not have the column populated yet)."""
    return meeting.get("native_meeting_id") or _native_id(
        meeting.get("meet_url") or ""
    )


def _partition_due(
    meetings: list[dict],
) -> tuple[list[list[dict]], list[dict]]:
    """Split due rows into (groups, singletons). Rows sharing a non-null
    _group_key form one group (one bot for all of them); rows with no key are
    dispatched individually as before."""
    by_key: dict[str, list[dict]] = {}
    singletons: list[dict] = []
    for m in meetings:
        key = _group_key(m)
        if key:
            by_key.setdefault(key, []).append(m)
        else:
            singletons.append(m)
    return list(by_key.values()), singletons


def _is_organizer(meeting: dict) -> bool:
    """True if the row's owner organizes the event (its own attendee entry is
    marked self+organizer). Derived from stored attendees — no extra column."""
    for a in meeting.get("attendees") or []:
        if isinstance(a, dict) and a.get("self") and a.get("organizer"):
            return True
    return False


def _pick_lead(group: list[dict]) -> dict:
    """Choose the row whose bot joins: organizer → most attendees → earliest
    created_at → smallest id. Total order, so selection is deterministic."""
    return sorted(
        group,
        key=lambda r: (
            not _is_organizer(r),  # organizers first
            -len(r.get("attendees") or []),  # then most attendees
            str(r.get("created_at") or ""),  # then earliest created
            str(r.get("id") or ""),  # tie-break: smallest id
        ),
    )[0]


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
        .select(
            "id, user_id, meet_url, native_meeting_id, opted_in, bot_status, "
            "start_time, title, attendees, created_at"
        )
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
) -> bool:
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
        return True
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

        with contextlib.suppress(Exception):
            from stewardai.email.outbox import enqueue_bot_failed

            await enqueue_bot_failed(
                client, settings,
                user_id=meeting.get("user_id"),
                meeting_id=meeting_id,
                title=meeting.get("title"),
                reason=str(exc)[:200],
            )

        return False


async def _active_lead_for(client, native_meeting_id: str):  # noqa: ANN001, ANN201
    """Return an existing row already hosting a bot for this native meeting
    (bot_status joining/in_meeting), or None. Guarded → None on error."""
    if not native_meeting_id:
        return None
    try:
        resp = await (
            client.table("meetings")
            .select("id, bot_status")
            .eq("native_meeting_id", native_meeting_id)
            .in_("bot_status", ["joining", "in_meeting"])
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:  # noqa: BLE001
        _log.warning("active_lead_lookup_failed", native=native_meeting_id, error=str(exc))
        return None


async def dispatch_group(client, settings, group: list[dict]) -> None:  # noqa: ANN001
    """Dispatch ONE bot for a group of due rows sharing a native meeting.

    Picks the lead, spawns one bot for it, and — only if that succeeds — marks
    the other rows 'grouped' (pointing at the lead) so later polls never
    re-dispatch them. If the lead fails, followers stay 'pending' to be retried
    (a new lead may be chosen) on the next cycle.

    Cross-cycle guard: if a bot is ALREADY joining/in_meeting for this native
    meeting (from a prior cycle), attach every row in this group to it instead
    of dispatching a second bot into the same call (late calendar sync / a
    mid-meeting opt-in can otherwise resurface a new 'pending' row).
    """
    native = _group_key(group[0])
    active = await _active_lead_for(client, native)
    if active is not None:
        for m in group:
            if m.get("id") == active["id"]:
                continue
            with contextlib.suppress(Exception):
                await (
                    client.table("meetings")
                    .update({"bot_status": "grouped", "bot_lead_meeting_id": active["id"]})
                    .eq("id", m["id"])
                    .execute()
                )
        _log.info(
            "meeting_group_attached_to_active_lead",
            native=native,
            active_id=active["id"],
            rows=len(group),
        )
        return

    lead = _pick_lead(group)
    followers = [m for m in group if m.get("id") != lead.get("id")]

    ok = await dispatch_meeting(client, settings, lead)
    if not ok:
        return
    for f in followers:
        with contextlib.suppress(Exception):
            await (
                client.table("meetings")
                .update({"bot_status": "grouped", "bot_lead_meeting_id": lead["id"]})
                .eq("id", f["id"])
                .execute()
            )
    if followers:
        _log.info(
            "meeting_group_dispatched",
            lead_id=lead["id"],
            followers=len(followers),
            native=_group_key(lead),
        )


async def run_once(client: AsyncClient, settings: Settings) -> None:
    """One scheduler cycle: dedup due rows by native meeting, dispatch one bot
    per group (+ one per keyless singleton)."""
    meetings = await get_due_meetings(client)
    if not meetings:
        return

    groups, singletons = _partition_due(meetings)
    _log.info("scheduler_dispatching", groups=len(groups), singletons=len(singletons))
    for meeting in singletons:
        await dispatch_meeting(client, settings, meeting)
    for group in groups:
        await dispatch_group(client, settings, group)


async def reconcile_stuck_meetings(client: AsyncClient, settings: Settings) -> None:
    """Close meetings stranded 'live' by syncing against Vexa's meeting status.

    Our teardown normally writes the final 'done'/'failed', but if the agent is
    restarted or the connection drops mid-meeting it never runs and the row stays
    joining/in_meeting forever (shown as live). Vexa is authoritative: it ends the
    bot when the call ends or it's left alone. So for each of our rows still
    joining/in_meeting (and untouched for RECONCILE_GRACE_S), if Vexa reports no
    ACTIVE meeting for that native id, the call is over — close the row
    (in_meeting -> done, joining -> failed). Fully guarded; a live meeting Vexa
    still reports active (even past its scheduled end) is left untouched.
    """
    now = datetime.now(UTC)
    stale_before = (now - timedelta(seconds=RECONCILE_GRACE_S)).isoformat()
    try:
        resp = await (
            client.table("meetings")
            .select("id, native_meeting_id, bot_status, updated_at")
            .in_("bot_status", ["joining", "in_meeting"])
            .lte("updated_at", stale_before)
            .execute()
        )
        rows = [r for r in (resp.data or []) if r.get("native_meeting_id")]
    except Exception as exc:  # noqa: BLE001 — reconcile is best-effort
        _log.warning("reconcile_query_failed", error=str(exc))
        return
    if not rows:
        return

    from stewardai.bridge.vexa_client import VexaClient

    vexa = VexaClient(settings.vexa_gateway_url, settings.vexa_api_key)
    bots = await vexa.list_bots()
    # native_meeting_ids Vexa still reports as in-the-call.
    active_natives = {
        str(b.get("native_meeting_id"))
        for b in bots
        if isinstance(b, dict)
        and str(b.get("status") or "").lower() in _VEXA_ACTIVE_STATUSES
        and b.get("native_meeting_id")
    }

    for r in rows:
        if str(r["native_meeting_id"]) in active_natives:
            continue  # genuinely still live per Vexa — leave it
        final = "done" if r["bot_status"] == "in_meeting" else "failed"
        with contextlib.suppress(Exception):
            await (
                client.table("meetings")
                .update({"bot_status": final})
                .eq("id", r["id"])
                .execute()
            )
            _log.info(
                "meeting_reconciled_closed",
                meeting_id=r["id"],
                native=r["native_meeting_id"],
                was=r["bot_status"],
                now=final,
            )


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
        try:
            await reconcile_stuck_meetings(client, settings)
        except Exception as exc:  # noqa: BLE001 — reconcile can't stop the loop
            _log.warning("reconcile_cycle_error", error=str(exc))
        await asyncio.sleep(interval_s)


if __name__ == "__main__":
    asyncio.run(run_forever())
