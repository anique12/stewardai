"""Fan a single bot's results out to every opted-in MeetBase user in the same
call (dedup-per-meeting + fan-out). One bot runs for the lead; at teardown the
shared artifacts are copied to each sibling row, per-user action extraction runs
with each user's own tools, and a per-user notes email is enqueued.

Every function is best-effort and guarded — a failure for one sibling never
affects the others or the lead's own teardown.
"""
from __future__ import annotations

import contextlib
from typing import Any

from stewardai.agent.action_link import close_agent_owned_items
from stewardai.agent.actions import AgentActionsWriter, extract_post_meeting_actions
from stewardai.agent.persistence import persist_meeting_artifacts
from stewardai.common.logging import get_logger
from stewardai.email.outbox import enqueue_meeting_notes, resolve_owner_email

_log = get_logger("agent.fanout")

# Rows whose bot actually participated in this call (so fan-out applies).
_PARTICIPATED = {"joining", "in_meeting", "grouped", "done"}


async def resolve_group_meetings(client, native_meeting_id: str) -> list[dict]:  # noqa: ANN001
    """All opted-in rows sharing this native_meeting_id whose bot participated."""
    try:
        resp = await (
            client.table("meetings")
            .select("id, user_id, title, notes_recipients, attendees, bot_status")
            .eq("native_meeting_id", native_meeting_id)
            .eq("opted_in", True)
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if r.get("bot_status") in _PARTICIPATED]
    except Exception as exc:  # noqa: BLE001
        _log.warning("fanout_resolve_failed", native=native_meeting_id, error=str(exc))
        return []


async def fanout_shared_artifacts(
    client, siblings: list[dict], transcript: list[str], summary: dict  # noqa: ANN001
) -> None:
    """Write the shared transcript + summary to each sibling row and mark done."""
    for s in siblings:
        mid = s.get("id")
        if not mid:
            continue
        with contextlib.suppress(Exception):
            await persist_meeting_artifacts(client, mid, transcript, summary)
        with contextlib.suppress(Exception):
            await client.table("meetings").update({"bot_status": "done"}).eq("id", mid).execute()


async def _user_timezone(client, user_id: str, fallback: str) -> str:  # noqa: ANN001
    """This user's own profiles.timezone, falling back when unset/missing. Best-
    effort — any failure (missing column, RLS, no row) returns the fallback."""
    try:
        resp = await (
            client.table("profiles").select("timezone").eq("user_id", user_id).limit(1).execute()
        )
        rows = resp.data or []
        tz = ((rows[0].get("timezone") if rows else None) or "").strip()
        return tz or fallback
    except Exception:  # noqa: BLE001
        return fallback


async def _user_bot_label(client, user_id: str) -> str:  # noqa: ANN001
    """This user's own profiles.bot_name, falling back to "MeetBase" when unset/
    missing. Best-effort — any failure (missing column, RLS, no row) returns the
    fallback, mirroring ``_user_timezone``."""
    try:
        resp = await (
            client.table("profiles").select("bot_name").eq("user_id", user_id).limit(1).execute()
        )
        rows = resp.data or []
        name = ((rows[0].get("bot_name") if rows else None) or "").strip()
        return name or "MeetBase"
    except Exception:  # noqa: BLE001
        return "MeetBase"


async def fanout_per_user_actions(
    llm: Any,
    composio: Any,
    client,  # noqa: ANN001
    siblings: list[dict],
    transcript: list[str],
    *,
    default_timezone: str = "UTC",
) -> None:
    """Run post-meeting action extraction once per sibling user, with THAT user's
    connected tools, writing agent_actions on that user's meeting_id. Each
    follower's OWN timezone (profiles.timezone) drives their extraction — using
    the lead's default_timezone for everyone would give a follower in another
    tz wrong calendar due-dates."""
    for s in siblings:
        mid, uid = s.get("id"), s.get("user_id")
        if not mid or not uid:
            continue
        with contextlib.suppress(Exception):
            tz = await _user_timezone(client, uid, default_timezone)
            writer = AgentActionsWriter(meeting_id=mid, user_id=uid, client=client)
            await extract_post_meeting_actions(
                llm,
                transcript,
                user_id=uid,
                meeting_id=mid,
                composio_service=composio,
                writer=writer,
                default_timezone=tz,
            )
        with contextlib.suppress(Exception):
            bot_label = await _user_bot_label(client, uid)
            await close_agent_owned_items(client, mid, bot_label)


async def fail_grouped_followers(
    client, native_meeting_id: str, *, exclude_meeting_uuid: str | None = None  # noqa: ANN001
) -> None:
    """Mark still-'grouped' rows for this native meeting as 'failed' (the lead
    never produced results). Best-effort; excludes the lead's own row."""
    try:
        resp = await (
            client.table("meetings")
            .select("id")
            .eq("native_meeting_id", native_meeting_id)
            .eq("bot_status", "grouped")
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:  # noqa: BLE001
        _log.warning("fanout_fail_grouped_resolve_failed", native=native_meeting_id, error=str(exc))
        return
    for r in rows:
        mid = r.get("id")
        if not mid or mid == exclude_meeting_uuid:
            continue
        with contextlib.suppress(Exception):
            await client.table("meetings").update({"bot_status": "failed"}).eq("id", mid).execute()


async def _fetch_notes_content(client, meeting_id: str) -> tuple[str, list[str], list[dict]]:  # noqa: ANN001
    """(tldr, decisions:list[str], action_items:list[dict]) for a meeting.
    Guarded — any failure returns empties."""
    tldr = ""
    decisions: list[str] = []
    action_items: list[dict] = []
    try:
        resp = await (
            client.table("summaries")
            .select("tldr,decisions")
            .eq("meeting_id", meeting_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            row = rows[0]
            tldr = row.get("tldr") or ""
            decisions = [
                d.get("text", "")
                for d in (row.get("decisions") or [])
                if isinstance(d, dict)
            ]
    except Exception:  # noqa: BLE001
        return "", [], []
    try:
        resp = await (
            client.table("action_items")
            .select("owner,task,due")
            .eq("meeting_id", meeting_id)
            .execute()
        )
        rows = resp.data or []
        action_items = [
            {"owner": r.get("owner"), "task": r.get("task"), "due": r.get("due")}
            for r in rows
        ]
    except Exception:  # noqa: BLE001
        return tldr, decisions, []
    return tldr, decisions, action_items


def _host_name(meeting_row: dict) -> str | None:  # noqa: ANN001
    """Display name of the attendee who is 'self' (else 'organizer') on this row."""
    attendees = meeting_row.get("attendees") or []
    self_attendee = None
    organizer_attendee = None
    for a in attendees:
        if not isinstance(a, dict):
            continue
        if a.get("self") and self_attendee is None:
            self_attendee = a
        if a.get("organizer") and organizer_attendee is None:
            organizer_attendee = a
    chosen = self_attendee or organizer_attendee
    if not chosen:
        return None
    return chosen.get("name") or None


async def fanout_notes_emails(client, settings, group: list[dict]) -> None:  # noqa: ANN001
    """Enqueue a meeting_notes email per user in the group (owner-only by default;
    also to non-self attendees when that user's notes_recipients is 'everyone')."""
    for m in group:
        mid, uid = m.get("id"), m.get("user_id")
        if not mid or not uid:
            continue
        title = m.get("title")
        tldr, decisions, action_items = await _fetch_notes_content(client, mid)
        host_name = _host_name(m)
        owner_email = await resolve_owner_email(client, uid)
        if owner_email:
            with contextlib.suppress(Exception):
                await enqueue_meeting_notes(
                    client, settings, user_id=uid, meeting_id=mid,
                    to_email=owner_email, title=title, shared=False,
                    host_name=host_name, tldr=tldr, decisions=decisions,
                    action_items=action_items,
                )
        if (m.get("notes_recipients") or "only_me") == "everyone":
            for a in m.get("attendees") or []:
                if not isinstance(a, dict) or a.get("self"):
                    continue
                ae = (a.get("email") or "").strip()
                if not ae:
                    continue
                with contextlib.suppress(Exception):
                    await enqueue_meeting_notes(
                        client, settings, user_id=uid, meeting_id=mid,
                        to_email=ae, title=title, shared=True,
                        host_name=host_name, tldr=tldr, decisions=decisions,
                        action_items=action_items,
                    )
