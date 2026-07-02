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

from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.live_tools")

# ---------------------------------------------------------------------------
# Tool registration
# ---------------------------------------------------------------------------
# NOTE: the tool-use system-prompt guidance now lives in
# ``assembly.build_meeting_system`` (parameterized by the agent's display name),
# so it's consistent across the decide gate and the agent and never hardcodes a name.


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
            # Emit a verbal confirmation request.  The AgentSession will speak
            # this text aloud; the user's response will come back as the next
            # turn.  At that point the LLM decides whether to call again.
            # The convention: this turn returns a "confirm?" text; on the NEXT
            # turn the LLM re-calls the tool (or drops it) based on the reply.
            return (
                f"Before I go ahead and do that — want me to proceed with: "
                f"{_slug_to_human(slug)}?"
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
