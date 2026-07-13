# src/stewardai/agent/kb/briefing.py
"""Build a short "prior context" brief injected into the live meeting system
prompt when Steward joins — so the agent walks in already knowing the space's
recent decisions/open items and, for a recurring series, what happened last
time. Only worth building when speaking is enabled (see meeting_runner.py's
gate) — a silent notetaker makes zero LLM calls, so a brief would never be read.

Best-effort, end to end: every DB call is wrapped so a missing column (e.g.
``meetings.attendees`` before migration 0016), an RLS/policy hiccup, or any
other failure degrades to "" rather than raising into the meeting build path.
"""
from __future__ import annotations

from stewardai.agent.kb.filing import LOW_CONFIDENCE, score_candidates
from stewardai.agent.kb.ingest import _hint_scores, _recurring_space_id
from stewardai.common.logging import get_logger

_log = get_logger("agent.kb.briefing")

_MAX_CHARS = 1500
_FACT_KINDS = ("decision", "open_question", "risk")
_FACT_LIMIT = 8
_RECENT_MEETINGS_LIMIT = 2
_ACTION_ITEM_LIMIT = 5


def _domains(emails: list[str]) -> list[str]:
    out = []
    for e in emails:
        if "@" in e:
            d = e.split("@", 1)[1].strip().lower()
            if d:
                out.append(d)
    return sorted(set(out))


def _attendee_emails(meeting: dict) -> list[str]:
    attendees = meeting.get("attendees") or []
    emails = []
    for a in attendees:
        if isinstance(a, dict):
            e = (a.get("email") or "").strip()
            if e:
                emails.append(e)
    return emails


async def _resolve_space_id(client, *, user_id: str, meeting: dict,
                            attendee_emails: list[str], domains: list[str]) -> str | None:
    if meeting.get("space_id"):
        return meeting["space_id"]
    recurring_event_id = meeting.get("recurring_event_id")
    if recurring_event_id:
        space_id = await _recurring_space_id(
            client, user_id=user_id, recurring_event_id=recurring_event_id)
        if space_id:
            return space_id
    scores = await _hint_scores(client, user_id=user_id,
                                attendee_emails=attendee_emails, domains=domains)
    candidates = score_candidates(hint_scores=scores)
    top = candidates[0] if candidates else None
    if top and top.score >= LOW_CONFIDENCE:
        return top.space_id
    return None


async def _space_facts(client, *, space_id: str) -> list[dict]:
    resp = await (
        client.table("space_facts").select("kind,text,created_at")
        .eq("space_id", space_id).is_("superseded_by", "null")
        .in_("kind", list(_FACT_KINDS))
        .order("created_at", desc=True).limit(_FACT_LIMIT).execute()
    )
    return resp.data or []


async def _recent_done_meeting_ids(client, *, user_id: str, space_id: str | None,
                                   recurring_event_id: str | None, exclude_meeting_id,
                                   limit: int) -> list[str]:
    q = client.table("meetings").select("id,end_time").eq("user_id", user_id).eq(
        "bot_status", "done")
    if space_id:
        q = q.eq("space_id", space_id)
    else:
        q = q.eq("recurring_event_id", recurring_event_id)
    resp = await q.order("end_time", desc=True).limit(limit + 1).execute()
    ids = [r["id"] for r in (resp.data or []) if r.get("id") != exclude_meeting_id]
    return ids[:limit]


async def _tldrs(client, *, meeting_ids: list[str]) -> list[str]:
    if not meeting_ids:
        return []
    resp = await (
        client.table("summaries").select("tldr,meeting_id")
        .in_("meeting_id", meeting_ids).execute()
    )
    return [r["tldr"] for r in (resp.data or []) if r.get("tldr")]


async def _open_action_items(client, *, meeting_ids: list[str]) -> list[str]:
    if not meeting_ids:
        return []
    resp = await (
        client.table("action_items").select("task,owner,done")
        .in_("meeting_id", meeting_ids).eq("done", False)
        .limit(_ACTION_ITEM_LIMIT).execute()
    )
    return [r["task"] for r in (resp.data or []) if r.get("task")]


def _dedup_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for it in items:
        key = it.strip()
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _compose(*, decisions: list[str], open_items: list[str], recap: list[str]) -> str:
    decisions = _dedup_keep_order(decisions)
    open_items = _dedup_keep_order(open_items)
    recap = _dedup_keep_order(recap)
    if not decisions and not open_items and not recap:
        return ""
    lines = ["Context from earlier related meetings (use when relevant; don't recite unprompted):"]
    if decisions:
        lines.append("Decisions so far: " + "; ".join(decisions))
    if open_items:
        lines.append("Still open: " + "; ".join(open_items))
    if recap:
        lines.append("Recent recap: " + " | ".join(recap))
    brief = "\n".join(lines)
    if len(brief) > _MAX_CHARS:
        brief = brief[:_MAX_CHARS - 1].rstrip() + "…"
    return brief


async def build_meeting_brief(client, *, user_id: str, meeting: dict) -> str:
    """Best-effort: returns "" on any failure or when there's nothing to brief."""
    if client is None or not user_id or not meeting:
        return ""
    try:
        meeting_id = meeting.get("id")
        recurring_event_id = meeting.get("recurring_event_id")
        attendee_emails = _attendee_emails(meeting)
        domains = _domains(attendee_emails)

        decisions: list[str] = []
        open_items: list[str] = []
        recap: list[str] = []

        space_id = await _resolve_space_id(
            client, user_id=user_id, meeting=meeting,
            attendee_emails=attendee_emails, domains=domains)

        if space_id:
            facts = await _space_facts(client, space_id=space_id)
            for f in facts:
                text = (f.get("text") or "").strip()
                if not text:
                    continue
                if f.get("kind") == "decision":
                    decisions.append(text)
                else:
                    open_items.append(text)
            space_meeting_ids = await _recent_done_meeting_ids(
                client, user_id=user_id, space_id=space_id, recurring_event_id=None,
                exclude_meeting_id=meeting_id, limit=_RECENT_MEETINGS_LIMIT)
            recap.extend(await _tldrs(client, meeting_ids=space_meeting_ids))

        if recurring_event_id:
            series_meeting_ids = await _recent_done_meeting_ids(
                client, user_id=user_id, space_id=None,
                recurring_event_id=recurring_event_id,
                exclude_meeting_id=meeting_id, limit=_RECENT_MEETINGS_LIMIT)
            recap.extend(await _tldrs(client, meeting_ids=series_meeting_ids))
            open_items.extend(await _open_action_items(client, meeting_ids=series_meeting_ids))

        return _compose(decisions=decisions, open_items=open_items, recap=recap)
    except Exception as exc:  # noqa: BLE001 - a brief must never break meeting join
        _log.warning("meeting_brief_failed", error=str(exc))
        return ""
