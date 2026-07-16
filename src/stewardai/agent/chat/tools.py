"""Read-only agentic-chat tools: KB search + user-scoped product reads.

Each tool is an async closure over ``(client, llm, user_id)`` wrapped as a
langchain ``StructuredTool`` so it can be handed to an agent executor and
``.ainvoke({...})``-ed directly (e.g. in tests). All DB reads go through the
async Supabase REST client and are scoped with ``.eq("user_id", user_id)``.
"""
from __future__ import annotations

from datetime import datetime, timezone

from langchain_core.tools import StructuredTool

from stewardai.agent.kb.retrieval import retrieve


def _lifecycle(bot_status: str | None, start_iso: str | None, now: datetime) -> str:
    """Where a meeting sits in its lifecycle, so the agent never claims a
    not-yet-run meeting already happened. ``done`` => a transcript exists;
    ``in_meeting`` => live now; a future ``start_time`` (or a still-``scheduled``
    status) => hasn't started, so its attendees are INVITEES, not attendance."""
    if bot_status == "done":
        return "completed"
    if bot_status == "in_meeting":
        return "in_progress"
    if start_iso:
        try:
            start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
            if start > now:
                return "not_started"
        except ValueError:
            pass
    return "not_started" if bot_status in ("scheduled", "pending", None) else "unknown"


class CiteRegistry:
    """Turn-scoped, shared identity for ``kb_search`` passage numbering.

    ``kb_search`` used to number the passages it returns ``n=1..k`` *per
    call*, which is meaningless (and actively wrong) once a turn makes more
    than one ``kb_search`` call: the model sees these numbers directly and
    later cites ``[n]`` in its answer, so two calls resetting to ``n=1`` makes
    the SAME ``[1]`` marker refer to two different passages depending on which
    call's numbering the model happened to reuse.

    A single ``CiteRegistry`` instance is shared by every ``kb_search`` call
    within one turn (see ``ChatSession``, which owns one and resets it at the
    start of each turn): ``assign()`` gives each distinct ``(meeting_id,
    source_seq)`` key a stable, turn-global, monotonically increasing number,
    reusing the same number for a repeat of a key already seen this turn. That
    makes the number the model sees in ``kb_search``'s output identical to the
    number ``_collect_citations`` later stores for that passage.
    """

    def __init__(self) -> None:
        self.counter = 0
        self.seen: dict[tuple, int] = {}

    def reset(self) -> None:
        """Start a fresh turn: forget every key/number assigned so far."""
        self.counter = 0
        self.seen.clear()

    def assign(self, key: tuple) -> int:
        n = self.seen.get(key)
        if n is not None:
            return n
        self.counter += 1
        self.seen[key] = self.counter
        return self.counter


def build_read_tools(
    client,  # noqa: ANN001
    llm,  # noqa: ANN001
    *,
    user_id: str,
    scope_space_id: str | None = None,
    cite_registry: CiteRegistry | None = None,
) -> list:
    """Build the read-only tool set. ``scope_space_id``, when set, binds
    ``kb_search`` to that space even if the model omits/forgets its own
    ``space_id`` argument — the model's explicit ``space_id`` (if it passes
    one) still wins, so this only fills the gap rather than overriding it.

    ``cite_registry`` assigns each passage its turn-global citation number
    (see ``CiteRegistry``); if omitted a fresh one is created (fine for a
    single-call/one-shot tool set that never needs cross-call numbering)."""

    registry = cite_registry if cite_registry is not None else CiteRegistry()

    async def kb_search(query: str, space_id: str | None = None) -> dict:
        rows = await retrieve(
            client, llm, user_id=user_id, query=query, space_id=space_id or scope_space_id
        )
        passages = []
        for r in rows:
            key = (r.get("meeting_id"), r.get("source_seq"))
            passages.append(
                {
                    "n": registry.assign(key),
                    "text": r.get("text", ""),
                    "meeting_id": r.get("meeting_id"),
                    "source_seq": r.get("source_seq"),
                    "kind": r.get("kind"),
                }
            )
        return {"passages": passages}

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

    async def get_meeting(meeting_id: str) -> dict:
        resp = await (
            client.table("meetings")
            .select("id,title,start_time,bot_status,attendees")
            .eq("user_id", user_id)
            .eq("id", meeting_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return {"meeting": None}
        row = rows[0]
        lifecycle = _lifecycle(
            row.get("bot_status"), row.get("start_time"), datetime.now(timezone.utc)
        )
        # `attendees` are calendar INVITEES (name/email/responseStatus), not
        # verified attendance — the agent must treat them accordingly.
        attendees = [
            {
                "name": a.get("name"),
                "email": a.get("email"),
                "responseStatus": a.get("responseStatus"),
            }
            for a in (row.get("attendees") or [])
        ]
        return {
            "meeting": {
                "id": row.get("id"),
                "title": row.get("title"),
                "start_time": row.get("start_time"),
                "bot_status": row.get("bot_status"),
                "lifecycle": lifecycle,
                "invitees": attendees,
            }
        }

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
            description="List the user's recent meetings (id + title + start_time + status).",
        ),
        StructuredTool.from_function(
            coroutine=get_meeting,
            name="get_meeting",
            description=(
                "Get one meeting's details by id: title, start_time, status, lifecycle "
                "('not_started' | 'in_progress' | 'completed'), and invitees "
                "(calendar-invited people — NOT verified attendance). Use this to answer "
                "who is in / expected at a meeting, and to check whether it has happened yet. "
                "First find the id with list_meetings if you only have a title."
            ),
        ),
        StructuredTool.from_function(
            coroutine=lookup_entity,
            name="lookup_entity",
            description="Find a person or company and basic details by name.",
        ),
    ]
