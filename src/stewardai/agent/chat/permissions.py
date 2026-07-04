"""Permission tiers for chat tools: reads and reversible actions run without
confirmation; outward-facing actions gate on a per-user allowlist (or an
interactive interrupt if the user hasn't "always allow"-ed the tool yet).
"""
from __future__ import annotations

import re
from typing import Any

from langgraph.types import interrupt

from .store import is_allowed, set_allowed

# Unknown/Composio actions whose slug contains a read verb are retrieval-only and
# safe to run without confirmation (e.g. GOOGLECALENDAR_EVENTS_LIST, GMAIL_FETCH_EMAILS,
# GMAIL_GET_ATTACHMENT, GOOGLECALENDAR_FIND_FREE_SLOTS). Anything else defaults to
# "outward" (gated) — we only ask before actions that send/create/modify data.
_READ_VERB_RE = re.compile(
    r"(?:^|_)(LIST|FETCH|GET|FIND|SEARCH|READ|RETRIEVE|VIEW|COUNT)(?:_|$)", re.IGNORECASE
)

TIER: dict[str, str] = {
    # read: safe, no side effects
    "kb_search": "read",
    "list_spaces": "read",
    "list_meetings": "read",
    "lookup_entity": "read",
    "list_calendar_events": "read",
    # reversible: side effects, but easy to undo
    "create_space": "reversible",
    "rename_space": "reversible",
    "file_meeting": "reversible",
    "add_tag": "reversible",
    "remove_tag": "reversible",
    "complete_action_item": "reversible",
    "reopen_action_item": "reversible",
    # outward: visible outside StewardAI or hard/impossible to undo
    "archive_space": "outward",
    "send_email": "outward",
    "create_calendar_event": "outward",
    "create_notion_page": "outward",
    "post_slack_message": "outward",
}


def tier_of(name: str) -> str:
    """Return the permission tier for a tool name. Known tools use TIER. For
    unknown/Composio actions, a read-verb slug (LIST/FETCH/GET/FIND/…) is "read"
    (auto, no approval); everything else defaults to "outward" (gated) — we only
    confirm actions that send/create/modify data, never plain retrieval."""
    if name in TIER:
        return TIER[name]
    if _READ_VERB_RE.search(name):
        return "read"
    return "outward"


def _normalize_resume(raw: Any) -> tuple[str, dict[str, Any] | None]:
    """The human's decision may come back as a bare string (``"approve"``) or,
    when they edited the action in the approval card, as
    ``{"decision": ..., "args": {...}}``. Normalize to ``(decision, edited_args)``."""
    if isinstance(raw, dict):
        decision = raw.get("decision")
        args = raw.get("args")
        return (
            decision if isinstance(decision, str) else "reject",
            args if isinstance(args, dict) else None,
        )
    return (raw if isinstance(raw, str) else "reject", None)


async def gate(
    client, *, user_id: str, tool_name: str, payload: dict[str, Any]
) -> tuple[str, dict[str, Any] | None]:
    """Decide whether ``tool_name`` may run automatically or needs confirmation.

    Returns ``(decision, edited_args)``. read/reversible tiers return
    ``("auto", None)``. The outward tier returns ``("auto", None)`` if the user
    has already allowlisted the tool; otherwise it raises a LangGraph interrupt
    carrying the permission request and returns the human's decision
    ("approve"/"reject") plus any edited args they submitted in the approval
    card. A decision of "always" records the allowlist entry and returns
    ("approve", edited_args).
    """
    tier = tier_of(tool_name)
    if tier in ("read", "reversible"):
        return "auto", None

    if await is_allowed(client, user_id=user_id, tool_name=tool_name):
        return "auto", None

    raw = interrupt({"kind": "permission", "tool": tool_name, **payload})
    decision, edited = _normalize_resume(raw)
    if decision == "always":
        await set_allowed(client, user_id=user_id, tool_name=tool_name)
        return "approve", edited
    return decision, edited
