"""Product-ops write tools for agentic chat: create/rename/archive spaces,
file meetings, tag/untag, and complete/reopen action items.

Every tool follows the same three-step executor shape: (1) re-check that the
target row(s) belong to ``user_id`` (never trust an LLM-supplied id), (2) gate
the action through :func:`stewardai.agent.chat.permissions.gate` so reversible
tiers run automatically while outward-facing ones can interrupt for
confirmation, (3) on "auto"/"approve" perform the REST mutation and return a
receipt; on any other decision, skip the mutation entirely.
"""
from __future__ import annotations

from langchain_core.tools import StructuredTool

from stewardai.agent.chat.permissions import gate

_NOT_FOUND: dict = {"error": "not found"}
_SKIPPED: dict = {"skipped": True}


async def _space_owned(client, *, user_id: str, space_id: str) -> bool:
    resp = await (
        client.table("spaces").select("id").eq("id", space_id).eq("user_id", user_id).execute()
    )
    return bool(resp.data)


async def _meeting_owned(client, *, user_id: str, meeting_id: str) -> bool:
    resp = await (
        client.table("meetings")
        .select("id")
        .eq("id", meeting_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(resp.data)


async def _action_item_owned(client, *, user_id: str, action_item_id: str) -> bool:
    """action_items has no user_id column — ownership flows through its meeting."""
    resp = await (
        client.table("action_items").select("meeting_id").eq("id", action_item_id).execute()
    )
    if not resp.data:
        return False
    meeting_id = resp.data[0].get("meeting_id")
    if not meeting_id:
        return False
    return await _meeting_owned(client, user_id=user_id, meeting_id=meeting_id)


def build_write_tools(client, *, user_id: str) -> list:  # noqa: ANN001
    async def create_space(name: str, kind: str | None = None) -> dict:
        d = await gate(
            client, user_id=user_id, tool_name="create_space",
            payload={"name": name, "kind": kind},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        resp = await (
            client.table("spaces")
            .insert({"user_id": user_id, "name": name, "kind": kind})
            .execute()
        )
        sid = resp.data[0]["id"]
        return {"ok": True, "summary": f"Created space '{name}'", "id": sid}

    async def rename_space(space_id: str, name: str) -> dict:
        if not await _space_owned(client, user_id=user_id, space_id=space_id):
            return _NOT_FOUND
        d = await gate(
            client, user_id=user_id, tool_name="rename_space",
            payload={"space_id": space_id, "name": name},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        await (
            client.table("spaces").update({"name": name})
            .eq("id", space_id).eq("user_id", user_id).execute()
        )
        return {"ok": True, "summary": f"Renamed space to '{name}'"}

    async def archive_space(space_id: str) -> dict:
        if not await _space_owned(client, user_id=user_id, space_id=space_id):
            return _NOT_FOUND
        d = await gate(
            client, user_id=user_id, tool_name="archive_space",
            payload={"space_id": space_id},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        await (
            client.table("spaces").update({"status": "archived"})
            .eq("id", space_id).eq("user_id", user_id).execute()
        )
        return {"ok": True, "summary": "Archived space"}

    async def file_meeting(meeting_id: str, space_id: str) -> dict:
        owned = await _meeting_owned(
            client, user_id=user_id, meeting_id=meeting_id
        ) and await _space_owned(client, user_id=user_id, space_id=space_id)
        if not owned:
            return _NOT_FOUND
        d = await gate(
            client, user_id=user_id, tool_name="file_meeting",
            payload={"meeting_id": meeting_id, "space_id": space_id},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        await (
            client.table("meetings")
            .update({"space_id": space_id, "space_source": "manual", "space_confidence": 1.0})
            .eq("id", meeting_id).eq("user_id", user_id).execute()
        )
        return {"ok": True, "summary": "Filed meeting under space"}

    async def add_tag(meeting_id: str, tag: str) -> dict:
        if not await _meeting_owned(client, user_id=user_id, meeting_id=meeting_id):
            return _NOT_FOUND
        d = await gate(
            client, user_id=user_id, tool_name="add_tag",
            payload={"meeting_id": meeting_id, "tag": tag},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        await client.table("meeting_tags").upsert(
            {"user_id": user_id, "meeting_id": meeting_id, "tag": tag},
            on_conflict="meeting_id,tag",
        ).execute()
        return {"ok": True, "summary": f"Tagged meeting with '{tag}'"}

    async def remove_tag(meeting_id: str, tag: str) -> dict:
        if not await _meeting_owned(client, user_id=user_id, meeting_id=meeting_id):
            return _NOT_FOUND
        d = await gate(
            client, user_id=user_id, tool_name="remove_tag",
            payload={"meeting_id": meeting_id, "tag": tag},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        await (
            client.table("meeting_tags").delete()
            .eq("meeting_id", meeting_id).eq("tag", tag).eq("user_id", user_id).execute()
        )
        return {"ok": True, "summary": f"Removed tag '{tag}'"}

    async def complete_action_item(action_item_id: str) -> dict:
        if not await _action_item_owned(client, user_id=user_id, action_item_id=action_item_id):
            return _NOT_FOUND
        d = await gate(
            client, user_id=user_id, tool_name="complete_action_item",
            payload={"action_item_id": action_item_id},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        await (
            client.table("action_items").update({"done": True}).eq("id", action_item_id).execute()
        )
        return {"ok": True, "summary": "Marked action item complete"}

    async def reopen_action_item(action_item_id: str) -> dict:
        if not await _action_item_owned(client, user_id=user_id, action_item_id=action_item_id):
            return _NOT_FOUND
        d = await gate(
            client, user_id=user_id, tool_name="reopen_action_item",
            payload={"action_item_id": action_item_id},
        )
        if d not in ("auto", "approve"):
            return _SKIPPED
        await (
            client.table("action_items").update({"done": False}).eq("id", action_item_id).execute()
        )
        return {"ok": True, "summary": "Reopened action item"}

    return [
        StructuredTool.from_function(
            coroutine=create_space,
            name="create_space",
            description="Create a new Space (client/project/topic container) for the user.",
        ),
        StructuredTool.from_function(
            coroutine=rename_space,
            name="rename_space",
            description="Rename an existing Space owned by the user.",
        ),
        StructuredTool.from_function(
            coroutine=archive_space,
            name="archive_space",
            description="Archive a Space owned by the user (hides it from active lists).",
        ),
        StructuredTool.from_function(
            coroutine=file_meeting,
            name="file_meeting",
            description="File a meeting under a Space (both must belong to the user).",
        ),
        StructuredTool.from_function(
            coroutine=add_tag,
            name="add_tag",
            description="Add a free-form topic tag to a meeting owned by the user.",
        ),
        StructuredTool.from_function(
            coroutine=remove_tag,
            name="remove_tag",
            description="Remove a topic tag from a meeting owned by the user.",
        ),
        StructuredTool.from_function(
            coroutine=complete_action_item,
            name="complete_action_item",
            description="Mark an action item done (action item's meeting must belong to the user).",
        ),
        StructuredTool.from_function(
            coroutine=reopen_action_item,
            name="reopen_action_item",
            description="Reopen a previously completed action item.",
        ),
    ]
