"""Live (mid-meeting) Composio tool integration.

Registers the meeting-owner's allow-listed Composio tools as LiveKit agent
function tools, with risk-gated execution logic:
- low risk  → execute immediately, announce result
- high risk → Steward verbally confirms first, executes only on "yes"

All executed live actions are logged to the ``agent_actions`` Supabase table
(source='directed') for the meeting detail audit trail.

The public ``register_live_tools`` is called from ``build_meeting_agent`` when a
``user_id`` is available.  When there is no user (public /pipeline demo), it
is never called and the session simply has no Composio tools — no error.
"""

from __future__ import annotations

import contextlib
import json
from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.live_tools")

# ---------------------------------------------------------------------------
# Tool registration
# ---------------------------------------------------------------------------
# NOTE: the tool-use system-prompt guidance now lives in
# ``assembly.build_meeting_system`` (parameterized by the agent's display name),
# so it's consistent across the decide gate and the agent and never hardcodes a name.


def build_stay_silent_tool() -> Any | None:
    """A native LiveKit function-tool the model calls to say NOTHING this turn.

    Its handler raises ``StopResponse``, which makes the framework generate no reply
    for the turn (and not even persist the call). Under the native-tools meeting flow
    this REPLACES the old ``decide_stream`` gate: the model calls ``stay_silent`` for
    ambient/undirected talk, and simply speaks (or calls an action tool) otherwise.

    Returns ``None`` when livekit is not installed (so import stays safe).
    """
    try:
        from livekit.agents.llm import StopResponse, function_tool  # type: ignore
    except ImportError:
        _log.warning("livekit_not_installed_stay_silent_disabled")
        return None

    @function_tool(
        raw_schema={
            "name": "stay_silent",
            "description": (
                "Respond with NOTHING this turn. Call this BY DEFAULT whenever the "
                "latest speech is ambient, is between other people, or is not directed "
                "at you and there is no material discrepancy to flag. If you should "
                "respond, just speak your reply (or call an action tool) instead of "
                "calling this."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        }
    )
    async def stay_silent(raw_arguments: dict[str, Any]) -> None:  # noqa: ANN401
        raise StopResponse()

    return stay_silent


def build_kb_search_tool(user_id: str, supabase: Any, llm: Any) -> Any | None:
    """A live in-meeting tool that searches the owner's MeetBase knowledge base
    (past meetings' transcripts + extracted facts) via the SAME retrieval the
    chat agent uses (``kb.retrieval.retrieve``) — so recall behaves identically
    in chat and in-call. Returns spoken-friendly passage text for the model to
    synthesize an answer from. ``None`` when livekit is missing or there is no
    KB backing (no supabase / user_id)."""
    if supabase is None or not user_id:
        return None
    try:
        from livekit.agents import function_tool  # type: ignore
    except ImportError:
        _log.warning("livekit_not_installed_kb_tool_disabled")
        return None

    from stewardai.agent.kb.retrieval import retrieve

    async def _handler(**kwargs: Any) -> str:  # noqa: ANN401
        query = str((kwargs or {}).get("query") or "").strip()
        if not query:
            return "What should I look up in your past meetings?"
        try:
            rows = await retrieve(supabase, llm, user_id=user_id, query=query)
        except Exception as exc:  # noqa: BLE001 - degrade, never crash the turn
            _log.warning("kb_search_live_failed", error=str(exc))
            return "I couldn't reach the knowledge base just now."
        lines = [f"- {t}" for r in rows if (t := (r.get("text") or "").strip())][:6]
        if not lines:
            return f'I didn\'t find anything about "{query}" in your past meetings.'
        return (
            "From your MeetBase knowledge base (ground your answer in this, don't "
            "invent):\n" + "\n".join(lines)
        )

    return function_tool(
        _handler,
        raw_schema={
            "name": "kb_search",
            "description": (
                "Search the owner's MeetBase knowledge base — PAST meetings' "
                "transcripts, decisions, and facts — and return relevant passages. "
                "Use this when asked about something discussed or decided in a "
                "PREVIOUS meeting, or any detail not in the current call's transcript. "
                "Do NOT use it for what was said in this meeting (that's in the "
                "transcript you already see)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "What to look up across the owner's past meetings.",
                    }
                },
                "required": ["query"],
            },
        },
    )


def build_live_tool_functions(
    user_id: str,
    meeting_id: str,
    composio_service: Any,  # ComposioService — untyped to avoid circular import
    writer: Any,  # AgentActionsWriter — untyped to avoid circular import
    default_timezone: str = "UTC",
) -> list[Any]:
    """Build a list of LiveKit agent ``FunctionTool``-compatible callables.

    Each tool wraps one allow-listed Composio action.  Risk is checked at
    call time: low-risk tools execute immediately; high-risk tools emit a
    verbal confirmation request and only proceed when the caller says yes.

    Parameters
    ----------
    user_id:
        Supabase user UUID of the meeting owner.
    meeting_id:
        UUID of the meeting row.
    composio_service:
        ``ComposioService`` instance for execution + risk lookups.
    writer:
        ``AgentActionsWriter`` wired to this meeting + user.

    Returns
    -------
    list
        LiveKit ``FunctionTool``-like callables ready to pass to
        ``Agent(tools=...)``.  Returns an empty list when livekit is not
        installed (avoids import errors at build time).
    """
    try:
        from livekit.agents import function_tool  # type: ignore
    except ImportError:
        _log.warning("livekit_not_installed_live_tools_disabled")
        return []

    tools_schemas = composio_service.get_tools(user_id)
    tools: list[Any] = []

    for schema in tools_schemas:
        fn_def = schema.get("function", {})
        slug: str = fn_def.get("name", "")
        description: str = fn_def.get("description", slug)
        parameters: dict = fn_def.get("parameters", {"type": "object", "properties": {}})

        if not slug:
            continue

        # Use a factory to capture slug in the closure correctly
        tool = _make_tool(
            slug=slug,
            description=description,
            parameters=parameters,
            user_id=user_id,
            meeting_id=meeting_id,
            composio_service=composio_service,
            writer=writer,
            function_tool=function_tool,
            default_timezone=default_timezone,
        )
        if tool is not None:
            tools.append(tool)

    _log.info(
        "live_tools_registered",
        meeting_id=meeting_id,
        user_id=user_id,
        count=len(tools),
    )
    return tools


def _make_tool(
    *,
    slug: str,
    description: str,
    parameters: dict[str, Any],
    user_id: str,
    meeting_id: str,
    composio_service: Any,
    writer: Any,
    function_tool: Any,
    default_timezone: str = "UTC",
) -> Any | None:
    """Factory: produce a single risk-gated async tool callable for ``slug``.

    Returns ``None`` when the risk level is unknown (slug not on allow-list).
    """
    try:
        risk = composio_service.risk_of(slug)
    except KeyError:
        _log.warning("live_tools_unknown_slug_skipped", slug=slug)
        return None

    # Build the async handler.  The handler receives keyword arguments that
    # match the action's parameter schema (passed by the LLM tool call).
    async def _handler(**kwargs: Any) -> str:  # noqa: ANN401
        """Execute the Composio action and return a spoken result."""
        _log.info(
            "live_tool_called",
            slug=slug,
            risk=risk,
            meeting_id=meeting_id,
        )
        if risk == "high":
            # Never execute a high-risk action in-meeting. Record it as a
            # 'proposed' (needs-approval) action so it appears LIVE in the
            # approvals panel with Approve/Dismiss; approving it runs it via the
            # action worker (proposed -> approved -> executed). Deduped so the
            # model re-calling on a nudge doesn't queue the same action twice.
            canon_args = json.dumps(kwargs or {}, sort_keys=True, separators=(",", ":"))
            with contextlib.suppress(Exception):
                if (slug, canon_args) in await writer.existing_action_keys():
                    return (
                        f"That's already waiting for your approval — "
                        f"{_slug_to_human(slug)}."
                    )
            with contextlib.suppress(Exception):
                await writer.insert(
                    source="directed",
                    toolkit=_slug_to_toolkit(slug),
                    action_slug=slug,
                    args=kwargs,
                    risk=risk,
                    title=_slug_to_human(slug),
                    state="proposed",
                )
            _log.info("live_tool_proposed", slug=slug, meeting_id=meeting_id, risk=risk)
            return (
                f"I've queued that for your approval — {_slug_to_human(slug)}. "
                f"Approve it in MeetBase whenever you're ready and I'll do it."
            )

        # Low risk: execute immediately
        return await _execute_and_log(
            slug=slug,
            risk=risk,
            kwargs=kwargs,
            user_id=user_id,
            meeting_id=meeting_id,
            composio_service=composio_service,
            writer=writer,
            default_timezone=default_timezone,
        )

    # Use raw_schema= so the LLM sees the exact Composio parameter schema.
    # raw_schema passes a RawFunctionDescription TypedDict with name, description,
    # and parameters — bypassing signature inspection which would give the LLM nothing
    # useful from our **kwargs handler.
    return function_tool(
        _handler,
        raw_schema={"name": slug, "description": description, "parameters": parameters},
    )


async def _execute_and_log(
    *,
    slug: str,
    risk: str,
    kwargs: dict[str, Any],
    user_id: str,
    meeting_id: str,
    composio_service: Any,
    writer: Any,
    default_timezone: str = "UTC",
) -> str:
    """Execute a Composio action and write an audit row to agent_actions.

    Returns a spoken confirmation string suitable for the agent to say aloud.
    On failure, returns an error phrase and logs state='failed'.
    """
    # Dedup: with native tool-calling the model re-invokes a low-risk tool (e.g.
    # create-draft) on each user nudge ("is it done?", "send it"), and every call
    # would otherwise create a real draft + a fresh audit row. Skip when an
    # identical (slug, canonical-args) action already exists for this meeting,
    # mirroring the post-meeting extraction guard. Best-effort — never blocks.
    canon_args = json.dumps(kwargs or {}, sort_keys=True, separators=(",", ":"))
    with contextlib.suppress(Exception):
        if (slug, canon_args) in await writer.existing_action_keys():
            _log.info("live_tool_dedup_skipped", slug=slug, meeting_id=meeting_id)
            return f"That's already done — I completed {_slug_to_human(slug)} earlier."
    try:
        result = composio_service.execute(
            user_id, slug, kwargs, default_timezone=default_timezone
        )
        # Composio reports logical failures (bad args, API rejection) via
        # `successful: false` rather than raising — persist state accordingly,
        # otherwise a rejected call gets mislabeled as done.
        ok = bool(result.get("successful"))
        err = None if ok else str(result.get("error") or "tool reported failure")
        await writer.insert(
            source="directed",
            toolkit=_slug_to_toolkit(slug),
            action_slug=slug,
            args=kwargs,
            risk=risk,
            title=_slug_to_human(slug),
            state="done" if ok else "failed",
            result=result,
            error=err,
        )
        _log.info("live_tool_executed", slug=slug, meeting_id=meeting_id, risk=risk, successful=ok)
        if ok:
            return f"Done — I've completed: {_slug_to_human(slug)}."
        return f"I tried {_slug_to_human(slug)} but got an error: {err}."
    except Exception as exc:
        _log.exception(
            "live_tool_exec_failed", slug=slug, meeting_id=meeting_id, error=str(exc)
        )
        await writer.insert(
            source="directed",
            toolkit=_slug_to_toolkit(slug),
            action_slug=slug,
            args=kwargs,
            risk=risk,
            title=_slug_to_human(slug),
            state="failed",
            error=str(exc),
        )
        return f"Sorry, I couldn't complete {_slug_to_human(slug)}: {exc}."


# ---------------------------------------------------------------------------
# Helpers: slug → human / toolkit
# ---------------------------------------------------------------------------

_SLUG_OVERRIDES: dict[str, str] = {
    "GMAIL_FETCH_EMAILS": "fetch emails",
    "GMAIL_GET_ATTACHMENT": "get attachment",
    "GMAIL_CREATE_EMAIL_DRAFT": "create email draft",
    "GMAIL_SEND_EMAIL": "send email",
    "GOOGLECALENDAR_LIST_EVENTS": "list calendar events",
    "GOOGLECALENDAR_FIND_FREE_SLOTS": "find free time slots",
    "GOOGLECALENDAR_CREATE_EVENT": "create calendar event",
    "GOOGLECALENDAR_UPDATE_EVENT": "update calendar event",
    "NOTION_SEARCH_NOTION_PAGE": "search Notion",
    "NOTION_GET_NOTION_PAGE_CHILDREN": "read Notion page",
    "NOTION_CREATE_NOTION_PAGE": "create Notion page",
    "NOTION_ADD_PAGE_CONTENT": "add content to Notion page",
    "SLACK_LIST_CHANNELS": "list Slack channels",
    "SLACK_SEARCH_MESSAGE": "search Slack messages",
    "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL": "send Slack message",
}


def _slug_to_human(slug: str) -> str:
    """Convert an action slug to a short human-readable phrase."""
    return _SLUG_OVERRIDES.get(slug, slug.replace("_", " ").lower())


def _slug_to_toolkit(slug: str) -> str:
    """Derive the toolkit name from an action slug (prefix before first `_`)."""
    prefix = slug.split("_")[0].lower()
    # Map known prefixes to their toolkit slug
    _PREFIX_MAP = {
        "gmail": "gmail",
        "googlecalendar": "googlecalendar",
        "notion": "notion",
        "slack": "slack",
    }
    return _PREFIX_MAP.get(prefix, prefix)
