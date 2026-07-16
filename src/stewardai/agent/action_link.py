"""Auto-close action items that MeetBase itself already fulfilled.

After a meeting, two independent tables describe overlapping work:

    action_items   the human-readable to-do list (owner/task/due), written from
                   the LLM summary by ``persistence.persist_meeting_artifacts``.
    agent_actions  executable actions MeetBase actually ran (state='done' means
                   it completed), written by ``live_tools``/``actions``.

When an ``action_items`` row is owned by MeetBase itself (owner == the bot's
display name) and a ``done`` agent_action clearly fulfilled it, we link the two
(``agent_action_id``) and close the item (``done=true``) so the user's to-do
list doesn't show MeetBase a task MeetBase already completed.

This is intentionally conservative: a keyword heuristic proposes candidates,
and an item is only closed when EXACTLY ONE done agent_action matches. Zero or
multiple matches leave the item open — guessing wrong corrupts the user's
to-do list, which is worse than leaving a stale item for them to close by hand.
Every step is best-effort and guarded; a failure here must never break teardown.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.action_link")

# Curated intent keywords for the action slugs post-meeting extraction commonly
# proposes (see actions._EXTRACT_SYSTEM / live_tools). Matched by substring
# against the action_slug (case-insensitive) so e.g. GMAIL_SEND_EMAIL and
# GMAIL_SEND_EMAIL_REPLY both hit the SEND_EMAIL rule.
_KEYWORD_RULES: tuple[tuple[str, frozenset[str]], ...] = (
    ("CREATE_EMAIL_DRAFT", frozenset({"draft", "email"})),
    ("SEND_EMAIL", frozenset({"email", "send"})),
    ("CREATE_EVENT", frozenset({"calendar", "event", "schedule"})),
)

# Generic noise tokens stripped from the slug/title fallback tokenizer — toolkit
# names and filler words that would otherwise "match" almost any task.
_GENERIC_NOISE = frozenset({"gmail", "googlecalendar", "google", "the", "and", "for"})

_TOKEN_RE = re.compile(r"[a-z]+")


def _intent_keywords(action_slug: str | None, title: str | None) -> frozenset[str]:
    """Derive this agent_action's intent keywords from its slug (curated rules
    first; falls back to tokenizing slug/title for anything not curated)."""
    slug = (action_slug or "").upper()
    for needle, kws in _KEYWORD_RULES:
        if needle in slug:
            return kws
    raw = f"{action_slug or ''} {title or ''}".lower()
    tokens = {t for t in _TOKEN_RE.findall(raw) if len(t) > 2}
    return frozenset(tokens - _GENERIC_NOISE)


def _is_confident_match(task: str, keywords: frozenset[str]) -> bool:
    """Whether this action_item's task text contains this action's intent."""
    if not keywords:
        return False
    task_l = task.lower()
    return any(kw in task_l for kw in keywords)


async def _fetch_open_bot_items(
    client: Any, meeting_uuid: str, bot_label: str
) -> list[dict]:
    """This meeting's not-yet-closed, not-yet-linked action_items owned (case-
    insensitively) by the bot's display name."""
    resp = await (
        client.table("action_items")
        .select("id, task, owner")
        .eq("meeting_id", meeting_uuid)
        .eq("done", False)
        .is_("agent_action_id", "null")
        .execute()
    )
    rows = resp.data or []
    label = bot_label.strip().lower()
    return [r for r in rows if (r.get("owner") or "").strip().lower() == label]


async def _fetch_done_actions(client: Any, meeting_uuid: str) -> list[dict]:
    """This meeting's completed (state='done') agent_actions."""
    resp = await (
        client.table("agent_actions")
        .select("id, action_slug, title")
        .eq("meeting_id", meeting_uuid)
        .eq("state", "done")
        .execute()
    )
    return resp.data or []


async def _close_item(client: Any, item_id: str, agent_action_id: str) -> None:
    await (
        client.table("action_items")
        .update(
            {
                "agent_action_id": agent_action_id,
                "done": True,
                "closed_by": "MeetBase",
                "closed_at": datetime.now(UTC).isoformat(),
            }
        )
        .eq("id", item_id)
        .execute()
    )


async def close_agent_owned_items(client: Any, meeting_uuid: str, bot_label: str) -> None:
    """Link + close this meeting's MeetBase-owned action_items that a done
    agent_action clearly fulfilled. Best-effort/guarded: never raises — a
    matching or write failure just leaves the affected item(s) open."""
    if client is None or not meeting_uuid or not (bot_label or "").strip():
        return
    try:
        items = await _fetch_open_bot_items(client, meeting_uuid, bot_label)
        if not items:
            return
        actions = await _fetch_done_actions(client, meeting_uuid)
        if not actions:
            return
    except Exception as exc:  # noqa: BLE001 — best-effort, never break teardown
        _log.warning(
            "close_agent_owned_items_fetch_failed", meeting_uuid=meeting_uuid, error=str(exc)
        )
        return

    candidates = [
        (a.get("id"), _intent_keywords(a.get("action_slug"), a.get("title")))
        for a in actions
        if a.get("id")
    ]
    for item in items:
        item_id = item.get("id")
        task = str(item.get("task") or "")
        if not item_id or not task:
            continue
        matches = [aid for aid, kws in candidates if _is_confident_match(task, kws)]
        if len(matches) != 1:
            # Zero or multiple confident matches — ambiguous, leave it open.
            continue
        try:
            await _close_item(client, item_id, matches[0])
        except Exception as exc:  # noqa: BLE001 — one item's failure must not block others
            _log.warning(
                "close_agent_owned_items_update_failed",
                meeting_uuid=meeting_uuid,
                item_id=item_id,
                error=str(exc),
            )
            continue
        _log.info(
            "action_item_auto_closed",
            meeting_uuid=meeting_uuid,
            item_id=item_id,
            agent_action_id=matches[0],
        )
