"""Permission tiers for chat tools: reads and reversible actions run without
confirmation; outward-facing actions gate on a per-user allowlist (or an
interactive interrupt if the user hasn't "always allow"-ed the tool yet).
"""
from __future__ import annotations

from typing import Any

from langgraph.types import interrupt

from .store import is_allowed, set_allowed

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
    """Return the permission tier for a tool name. Unknown tools default to
    "outward" — the safe choice, since it gates on confirmation."""
    return TIER.get(name, "outward")


async def gate(client, *, user_id: str, tool_name: str, payload: dict[str, Any]) -> str:
    """Decide whether ``tool_name`` may run automatically or needs confirmation.

    read/reversible tiers always return "auto". The outward tier returns "auto"
    if the user has already allowlisted the tool; otherwise it raises a
    LangGraph interrupt carrying the permission request and returns whatever
    the human decides ("approve"/"reject"/"always"). A decision of "always"
    also records the allowlist entry before returning "approve".
    """
    tier = tier_of(tool_name)
    if tier in ("read", "reversible"):
        return "auto"

    if await is_allowed(client, user_id=user_id, tool_name=tool_name):
        return "auto"

    decision = interrupt({"kind": "permission", "tool": tool_name, **payload})
    if decision == "always":
        await set_allowed(client, user_id=user_id, tool_name=tool_name)
        return "approve"
    return decision
