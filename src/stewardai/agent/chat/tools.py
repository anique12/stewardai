"""Read-only agentic-chat tools: KB search + user-scoped product reads.

Each tool is an async closure over ``(client, llm, user_id)`` wrapped as a
langchain ``StructuredTool`` so it can be handed to an agent executor and
``.ainvoke({...})``-ed directly (e.g. in tests). All DB reads go through the
async Supabase REST client and are scoped with ``.eq("user_id", user_id)``.
"""
from __future__ import annotations

from langchain_core.tools import StructuredTool

from stewardai.agent.kb.retrieval import retrieve


def build_read_tools(
    client, llm, *, user_id: str, scope_space_id: str | None = None  # noqa: ANN001
) -> list:
    """Build the read-only tool set. ``scope_space_id``, when set, binds
    ``kb_search`` to that space even if the model omits/forgets its own
    ``space_id`` argument — the model's explicit ``space_id`` (if it passes
    one) still wins, so this only fills the gap rather than overriding it."""

    async def kb_search(query: str, space_id: str | None = None) -> dict:
        rows = await retrieve(
            client, llm, user_id=user_id, query=query, space_id=space_id or scope_space_id
        )
        return {
            "passages": [
                {
                    "n": i + 1,
                    "text": r.get("text", ""),
                    "meeting_id": r.get("meeting_id"),
                    "source_seq": r.get("source_seq"),
                    "kind": r.get("kind"),
                }
                for i, r in enumerate(rows)
            ]
        }

    async def list_spaces() -> dict:
        resp = await (
            client.table("spaces").select("id,name,kind,status").eq("user_id", user_id).execute()
        )
        return {"spaces": resp.data or []}

    async def list_meetings(limit: int = 20) -> dict:
        resp = await (
            client.table("meetings")
            .select("id,title,start_time,space_id,bot_status")
            .eq("user_id", user_id)
            .order("start_time", desc=True)
            .limit(limit)
            .execute()
        )
        return {"meetings": resp.data or []}

    async def lookup_entity(name: str) -> dict:
        resp = await (
            client.table("entities")
            .select("id,kind,name,email,domain")
            .eq("user_id", user_id)
            .execute()
        )
        q = name.strip().lower()
        hits = [e for e in (resp.data or []) if q in (e.get("name", "") or "").lower()]
        return {"entities": hits}

    return [
        StructuredTool.from_function(
            coroutine=kb_search,
            name="kb_search",
            description=(
                "Search the user's meeting knowledge base. "
                "Returns passages with meeting_id + source_seq to cite."
            ),
        ),
        StructuredTool.from_function(
            coroutine=list_spaces,
            name="list_spaces",
            description="List the user's Spaces (clients/projects/topics).",
        ),
        StructuredTool.from_function(
            coroutine=list_meetings,
            name="list_meetings",
            description="List the user's recent meetings.",
        ),
        StructuredTool.from_function(
            coroutine=lookup_entity,
            name="lookup_entity",
            description="Find a person or company and basic details by name.",
        ),
    ]
