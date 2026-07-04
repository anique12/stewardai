"""Composio integration service for StewardAI.

Provides a thin, well-typed wrapper around the Composio SDK (v0.17.x) for
discovering, fetching, and executing third-party app actions on behalf of a
user.  Only actions on the explicit allow-list below are ever exposed to the
agent; everything else is silently excluded.

Toolkit slugs: gmail, googlecalendar are ENABLED (offered by the chat); notion,
slack have action definitions but are gated off (see TOOLKITS) until the portal
marks them connectable.

Action risk levels
------------------
- "low"  — reads, searches, drafts, and reversible creates (calendar event,
           Notion page) that primarily affect the requesting user.
- "high" — outbound / irreversible-to-others actions: sending email, posting
           a Slack message.  These should require explicit user confirmation
           before the agent calls execute().

Usage example
-------------
    from stewardai.integrations.composio_service import ComposioService

    svc = ComposioService()
    connected = svc.list_connected("user-uuid")        # ["gmail", "slack"]
    tools     = svc.get_tools("user-uuid")             # list[dict] OpenAI-format
    result    = svc.execute("user-uuid",
                            "GMAIL_FETCH_EMAILS",
                            {"max_results": 5})
    risk      = svc.risk_of("GMAIL_SEND_EMAIL")        # "high"
"""

from __future__ import annotations

import functools

from stewardai.config import get_settings

# ---------------------------------------------------------------------------
# Supported toolkits
# ---------------------------------------------------------------------------

# ENABLED toolkits the chat actually offers + can connect. Kept in sync with the
# portal's live/connectable set (portal catalog + SUPPORTED_TOOLKITS): only apps
# that are BOTH live in the portal AND have actions defined below. notion/slack
# have action definitions in _ALLOW_LIST but are gated OFF here (portal marks
# them "coming soon" — not connectable yet), so the chat never offers an app it
# can't actually connect. Re-add them here once the portal enables them.
TOOLKITS: list[str] = ["gmail", "googlecalendar"]

# All toolkits we have action definitions for (enabled or not) — the superset.
_DEFINED_TOOLKITS: list[str] = ["gmail", "googlecalendar", "notion", "slack"]

# ---------------------------------------------------------------------------
# Allow-list: pinned action slugs discovered from the Composio SDK / API.
# Each entry is (action_slug, risk_level).
# "high" = outbound / irreversible-to-others.
# "low"  = reads, searches, drafts, and locally-scoped creates.
# ---------------------------------------------------------------------------

_ALLOW_LIST: dict[str, list[tuple[str, str]]] = {
    "gmail": [
        ("GMAIL_FETCH_EMAILS", "low"),           # list/search inbox messages
        ("GMAIL_GET_ATTACHMENT", "low"),         # download a single attachment
        ("GMAIL_CREATE_EMAIL_DRAFT", "low"),     # create a draft (not sent)
        ("GMAIL_SEND_EMAIL", "high"),            # send email — outbound
    ],
    "googlecalendar": [
        ("GOOGLECALENDAR_EVENTS_LIST", "low"),   # list upcoming events (correct Composio slug)
        ("GOOGLECALENDAR_FIND_FREE_SLOTS", "low"),  # find free/busy windows
        ("GOOGLECALENDAR_CREATE_EVENT", "low"),  # create a calendar event (own cal)
        ("GOOGLECALENDAR_UPDATE_EVENT", "low"),  # edit own event
    ],
    "notion": [
        ("NOTION_SEARCH_NOTION_PAGE", "low"),    # search pages / databases
        ("NOTION_GET_NOTION_PAGE_CHILDREN", "low"),  # read page content blocks
        ("NOTION_CREATE_NOTION_PAGE", "low"),    # create a new page (own workspace)
        ("NOTION_ADD_PAGE_CONTENT", "low"),      # append content to a page
    ],
    "slack": [
        ("SLACK_LIST_CHANNELS", "low"),          # list public channels
        ("SLACK_SEARCH_MESSAGE", "low"),         # search messages
        ("SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL", "high"),  # post a message
    ],
}

# Flat slug → risk map for fast look-up
_RISK_MAP: dict[str, str] = {
    slug: risk for actions in _ALLOW_LIST.values() for slug, risk in actions
}

# Set of all allowed slugs for membership tests
_ALLOWED_SLUGS: frozenset[str] = frozenset(_RISK_MAP)

# Google Calendar event types that CANNOT have a Meet room or attendees — Google
# rejects those with 'malformedFocusTimeEvent' / similar.
_CAL_SPECIAL_EVENT_TYPES = {"focusTime", "outOfOffice", "workingLocation"}


def _prepare_args(slug: str, args: dict, default_timezone: str = "UTC") -> dict:
    """Fix provider constraints a tool's JSON schema can't express.

    GOOGLECALENDAR_CREATE_EVENT defaults ``create_meeting_room=True``, which bolts a
    Meet link + attendees onto every event. Google rejects that on focus-time /
    out-of-office / working-location events, and an assistant shouldn't add a Meet
    link to solo blocks anyway — only to real meetings (ones with attendees). The
    tool also assumes UTC when no ``timezone`` is given, so a naive "4pm" is booked
    as 4pm UTC. This normalizes the args at the execution boundary (timezone,
    non-blank title, Meet-room rules) so the LLM doesn't have to know Google's
    quirks; it's a targeted shim, not general arg-guessing.
    """
    if slug != "GOOGLECALENDAR_CREATE_EVENT" or not isinstance(args, dict):
        return args
    is_special = (
        args.get("eventType") in _CAL_SPECIAL_EVENT_TYPES
        or "focusTimeProperties" in args
        or "outOfOfficeProperties" in args
        or "workingLocationProperties" in args
    )
    out = dict(args)
    if is_special:
        # focusTime / outOfOffice / workingLocation are Workspace-ENTERPRISE-only
        # (Google 400s them on personal/standard accounts) and reject Meet rooms +
        # attendees. Downgrade to a normal blocking event so it works on ANY account
        # — the user still gets the time blocked on their calendar.
        for key in (
            "focusTimeProperties",
            "outOfOfficeProperties",
            "workingLocationProperties",
            "eventType",
        ):
            out.pop(key, None)
        out["create_meeting_room"] = False
        out.pop("attendees", None)
    elif "create_meeting_room" not in out:
        # Only auto-add a Meet room for actual meetings (attendees present).
        out["create_meeting_room"] = bool(args.get("attendees"))
    # Default the timezone (tool assumes UTC otherwise → wrong local time) and
    # never create a blank-title event.
    if not str(out.get("timezone") or "").strip():
        out["timezone"] = default_timezone
    if not str(out.get("summary") or "").strip():
        out["summary"] = "Event"
    return out


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ComposioService:
    """Thin service layer wrapping the Composio SDK.

    Constructed lazily: the Composio client is only instantiated on first use,
    so importing this module in tests that mock the client is safe.

    Parameters
    ----------
    api_key:
        Override the API key.  Defaults to ``settings.composio_api_key``.
        If neither is set, all methods raise ``RuntimeError`` on first call.
    """

    def __init__(self, *, api_key: str | None = None) -> None:
        self._api_key = api_key  # None → fall back to settings
        self._client = None  # lazy

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @functools.cached_property
    def _composio(self):  # type: ignore[return]
        """Lazily initialise the Composio client."""
        from composio import Composio  # local import keeps startup fast

        key = self._api_key or get_settings().composio_api_key
        if not key:
            raise RuntimeError(
                "Composio integration is disabled: set COMPOSIO_API_KEY "
                "in the environment or pass api_key= to ComposioService()."
            )
        return Composio(api_key=key)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_connected(self, user_id: str) -> list[str]:
        """Return the subset of TOOLKITS that the user has connected.

        Parameters
        ----------
        user_id:
            The Supabase user UUID used as the Composio entity/user ID.

        Returns
        -------
        list[str]
            Toolkit slugs (e.g. ``["gmail", "slack"]``) for which there is at
            least one ACTIVE connected account for this user.  Only slugs in
            :data:`TOOLKITS` are returned.
        """
        response = self._composio.connected_accounts.list(
            user_ids=[user_id],
            statuses=["ACTIVE"],
            toolkit_slugs=TOOLKITS,
        )
        items = getattr(response, "items", None) or []
        seen: set[str] = set()
        result: list[str] = []
        for account in items:
            toolkit_slug = self._toolkit_slug_from_account(account)
            if toolkit_slug and toolkit_slug in TOOLKITS and toolkit_slug not in seen:
                seen.add(toolkit_slug)
                result.append(toolkit_slug)
        return result

    def get_tools(
        self,
        user_id: str,
        toolkits: list[str] | None = None,
        *,
        only_connected: bool = True,
    ) -> list[dict]:
        """Return LLM-callable tool schemas for allowed actions.

        The returned list contains OpenAI function-calling format dicts
        (``{"type": "function", "function": {"name": ..., "description": ...,
        "parameters": {...}}}``) — directly usable with LiteLLM / Gemini.

        Only actions on the allow-list are included.

        Parameters
        ----------
        user_id:
            Composio entity / Supabase user UUID.
        toolkits:
            Optional filter: only return tools from these toolkit slugs.
        only_connected:
            When ``True`` (default), restrict to toolkits the user has an
            ACTIVE connection for. When ``False``, expose the allow-listed
            actions for ALL supported toolkits regardless of connection —
            Composio serves the schemas without a live connection, and calling
            an unconnected action trips the connect-required gate in
            :mod:`stewardai.agent.chat.composio_tools` (so the agent offers to
            connect the app instead of silently having no tool to call).

        Returns
        -------
        list[dict]
            OpenAI-format tool schema dicts.
        """
        if only_connected:
            connected = self.list_connected(user_id)
            target_toolkits = [
                t for t in (toolkits or connected) if t in connected and t in TOOLKITS
            ]
        else:
            target_toolkits = [t for t in (toolkits or TOOLKITS) if t in TOOLKITS]
        if not target_toolkits:
            return []

        # Collect the allowed slugs for the requested toolkits
        allowed_slugs: list[str] = [
            slug
            for tk in target_toolkits
            for slug, _ in _ALLOW_LIST.get(tk, [])
        ]
        if not allowed_slugs:
            return []

        raw_tools = self._composio.tools.get(
            user_id=user_id,
            tools=allowed_slugs,
        )
        # The default (OpenAI) provider returns list[dict]; normalise just in
        # case the provider wraps them differently.
        if isinstance(raw_tools, list):
            return [
                t if isinstance(t, dict)
                else (t.model_dump() if hasattr(t, "model_dump") else dict(t))
                for t in raw_tools
            ]
        return list(raw_tools)  # type: ignore[arg-type]

    def execute(
        self,
        user_id: str,
        action_slug: str,
        arguments: dict,
        *,
        default_timezone: str = "UTC",
    ) -> dict:
        """Execute an allowed action on behalf of a user.

        Parameters
        ----------
        user_id:
            Composio entity / Supabase user UUID.
        action_slug:
            The action to run, e.g. ``"GMAIL_FETCH_EMAILS"``.  Must be in the
            allow-list; raises ``ValueError`` otherwise.
        arguments:
            Key-value arguments matching the action's input schema.

        Returns
        -------
        dict
            ``{"data": {...}, "error": str|None, "successful": bool}``
        """
        if action_slug not in _ALLOWED_SLUGS:
            raise ValueError(
                f"Action {action_slug!r} is not on the allow-list. "
                f"Allowed: {sorted(_ALLOWED_SLUGS)}"
            )
        arguments = _prepare_args(action_slug, arguments, default_timezone)
        result = self._composio.tools.execute(
            slug=action_slug,
            arguments=arguments,
            user_id=user_id,
            dangerously_skip_version_check=True,
        )
        # Ensure we always return a plain dict
        if isinstance(result, dict):
            return result
        if hasattr(result, "model_dump"):
            return result.model_dump()
        return dict(result)

    def risk_of(self, action_slug: str) -> str:
        """Return the risk level for an action slug.

        Parameters
        ----------
        action_slug:
            A slug from the allow-list.

        Returns
        -------
        str
            ``"low"`` or ``"high"``.

        Raises
        ------
        KeyError
            If the slug is not on the allow-list.
        """
        if action_slug not in _RISK_MAP:
            raise KeyError(
                f"Action {action_slug!r} is not on the allow-list. "
                f"Allowed: {sorted(_RISK_MAP)}"
            )
        return _RISK_MAP[action_slug]

    # ------------------------------------------------------------------
    # Internal utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _toolkit_slug_from_account(account) -> str | None:
        """Extract the toolkit slug from a connected account object."""
        # The SDK may return an object with .toolkit (Toolkit object) or
        # .toolkit_slug (str) depending on the response model version.
        toolkit = getattr(account, "toolkit", None)
        if toolkit is not None:
            slug = getattr(toolkit, "slug", None)
            if isinstance(slug, str):
                return slug.lower()
        slug = getattr(account, "toolkit_slug", None)
        if isinstance(slug, str):
            return slug.lower()
        return None
