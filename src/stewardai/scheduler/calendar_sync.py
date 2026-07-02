"""Calendar auto-join sync (+ per-meeting STT keyterms).

Pulls upcoming Google Calendar events the user ORGANIZES (with a Meet link) into
the ``meetings`` table with ``opted_in=true`` so the scheduler auto-joins them.
Reuses the user's existing Composio ``googlecalendar`` connection — no separate
Google OAuth flow.

Also derives per-meeting **keyterms** to bias the per-speaker Deepgram STT:
attendee display names + LLM-extracted domain terms (product/company/people names,
jargon) from the event title/description. Stored on ``meetings.keyterms`` and read
by the meeting agent. Computed once per event (skipped if already stored) and fully
guarded — if the ``keyterms`` column isn't migrated yet, the join sync still works.
"""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from stewardai.common.logging import get_logger

if TYPE_CHECKING:
    from supabase import AsyncClient

    from stewardai.integrations.composio_service import ComposioService

_log = get_logger("scheduler.calendar_sync")
_LIST_SLUG = "GOOGLECALENDAR_EVENTS_LIST"

_TERMS_SYSTEM = (
    "From a meeting title and description, extract proper nouns and domain-specific "
    "terms a speech-to-text system is likely to mis-hear: product names, company "
    "names, people names, project codenames, acronyms, technical jargon. Respond "
    "ONLY with a JSON array of short strings (max 12). Skip ordinary English words. "
    "If there are none, respond with []. No text outside the JSON array."
)


def _meet_url(event: dict) -> str | None:
    link = event.get("hangoutLink")
    if isinstance(link, str) and "meet.google.com" in link:
        return link
    for ep in (event.get("conferenceData") or {}).get("entryPoints") or []:
        uri = ep.get("uri") if isinstance(ep, dict) else None
        if ep.get("entryPointType") == "video" and isinstance(uri, str) and "meet.google.com" in uri:
            return uri
    return None


def _native_id(meet_url: str) -> str | None:
    try:
        u = urlparse(meet_url)
        if u.netloc != "meet.google.com":
            return None
        code = u.path.strip("/").split("/")[0]
        return code or None
    except Exception:  # noqa: BLE001
        return None


def _attendee_names(event: dict) -> list[str]:
    """Human attendee names (skip self + resource rooms), for STT keyterms."""
    names: list[str] = []
    for a in event.get("attendees") or []:
        if not isinstance(a, dict) or a.get("self") or a.get("resource"):
            continue
        nm = (a.get("displayName") or "").strip()
        if not nm:
            email = (a.get("email") or "").strip()
            nm = email.split("@")[0].replace(".", " ").replace("_", " ").strip()
        if nm:
            names.append(nm)
    return names


def _dedup(terms: list[str]) -> list[str]:
    """Case-insensitive de-dup, preserving first-seen order + original casing."""
    seen: dict[str, str] = {}
    for t in terms:
        t = (t or "").strip()
        if t and t.lower() not in seen:
            seen[t.lower()] = t
    return list(seen.values())


def _rows_and_events(user_id: str, items: list) -> list[tuple[dict, dict]]:
    """(upsert row, raw event) for organizer-owned, Meet-linked, timed events."""
    out: list[tuple[dict, dict]] = []
    for e in items:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        if not (e.get("organizer") or {}).get("self"):  # only meetings I organize
            continue
        meet = _meet_url(e)
        if not meet:
            continue
        start = (e.get("start") or {}).get("dateTime")  # skip all-day
        if not start:
            continue
        native = _native_id(meet)
        if not native:
            continue
        out.append(
            (
                {
                    "user_id": user_id,
                    "google_event_id": e["id"],
                    "start_time": start,
                    "meet_url": meet,
                    "native_meeting_id": native,
                    "opted_in": True,
                },
                e,
            )
        )
    return out


async def _extract_terms(llm: Any, text: str) -> list[str]:
    """One small LLM pass → domain terms from the event title/description."""
    if llm is None or not text.strip():
        return []
    from stewardai.common.audio import Message

    chunks: list[str] = []
    try:
        async for d in llm.complete(
            [Message(role="user", content=text[:2000])],
            system=_TERMS_SYSTEM,
            temperature=0.0,
        ):
            if d:
                chunks.append(d)
    except Exception as exc:  # noqa: BLE001
        _log.warning("calendar_terms_llm_failed", error=str(exc))
        return []
    raw = "".join(chunks).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        idx = raw.find("[")
        raw = raw[idx:] if idx != -1 else raw
    try:
        arr = json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return []
    if not isinstance(arr, list):
        return []
    return [str(x).strip() for x in arr if str(x).strip()][:12]


async def _apply_keyterms(
    client: AsyncClient, uid: str, pairs: list[tuple[dict, dict]], llm: Any
) -> None:
    """Compute + store keyterms for events that don't have them yet (best-effort)."""
    eids = [r["google_event_id"] for r, _ in pairs]
    try:
        resp = await (
            client.table("meetings")
            .select("google_event_id, keyterms")
            .eq("user_id", uid)
            .in_("google_event_id", eids)
            .execute()
        )
        existing = {r["google_event_id"]: (r.get("keyterms") or "") for r in (resp.data or [])}
    except Exception:  # noqa: BLE001 — keyterms column not migrated yet → skip entirely
        _log.info("calendar_keyterms_unsupported", user_id=uid)
        return

    for row, event in pairs:
        eid = row["google_event_id"]
        if existing.get(eid):  # already computed — don't re-run the LLM
            continue
        text = " ".join(x for x in (event.get("summary"), event.get("description")) if x)
        keyterms = _dedup(_attendee_names(event) + await _extract_terms(llm, text))
        if not keyterms:
            continue
        try:
            await (
                client.table("meetings")
                .update({"keyterms": ",".join(keyterms)})
                .eq("user_id", uid)
                .eq("google_event_id", eid)
                .execute()
            )
            _log.info("calendar_keyterms_set", user_id=uid, event=eid, count=len(keyterms))
        except Exception as exc:  # noqa: BLE001
            _log.warning("calendar_keyterms_update_failed", user_id=uid, error=str(exc))


async def sync_calendars_once(
    client: AsyncClient,
    composio: ComposioService,
    *,
    llm: Any = None,
    window_days: int = 1,
) -> int:
    """Sync every connected user's organizer-owned Meet events into ``meetings``
    (opted_in=true) and populate per-meeting keyterms. Returns rows upserted."""
    try:
        resp = await (
            client.table("connected_apps")
            .select("user_id")
            .eq("app", "googlecalendar")
            .eq("status", "connected")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning("calendar_sync_users_query_failed", error=str(exc))
        return 0

    user_ids = [r["user_id"] for r in (resp.data or []) if r.get("user_id")]
    if not user_ids:
        return 0

    now = datetime.now(UTC)
    args = {
        "calendar_id": "primary",
        "timeMin": now.isoformat(),
        "timeMax": (now + timedelta(days=window_days)).isoformat(),
        "single_events": True,
        "max_results": 50,
    }
    total = 0
    for uid in user_ids:
        try:
            result = await asyncio.to_thread(composio.execute, uid, _LIST_SLUG, args)
        except Exception as exc:  # noqa: BLE001
            _log.warning("calendar_sync_list_failed", user_id=uid, error=str(exc))
            continue
        if not result.get("successful"):
            _log.warning(
                "calendar_sync_list_unsuccessful",
                user_id=uid,
                error=str(result.get("error"))[:150],
            )
            continue
        items = (result.get("data") or {}).get("items") or []
        pairs = _rows_and_events(uid, items)
        if not pairs:
            continue
        try:
            await (
                client.table("meetings")
                .upsert([r for r, _ in pairs], on_conflict="user_id,google_event_id")
                .execute()
            )
            total += len(pairs)
            _log.info("calendar_sync_upserted", user_id=uid, count=len(pairs))
        except Exception as exc:  # noqa: BLE001
            _log.warning("calendar_sync_upsert_failed", user_id=uid, error=str(exc))
            continue
        await _apply_keyterms(client, uid, pairs, llm)
    return total
