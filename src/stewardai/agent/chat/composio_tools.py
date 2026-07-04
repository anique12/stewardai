"""Composio external-tool wrappers for agentic chat.

Lists a user's allow-listed, connected Composio actions (Gmail / Google
Calendar / Notion / Slack -- see :mod:`stewardai.integrations.composio_service`)
and wraps each one as a gated LangChain ``StructuredTool``, reusing the exact
patterns already proven by :mod:`stewardai.agent.live_tools` (schema-driven
tool construction) and :mod:`stewardai.agent.chat.write_tools` (the
gate-then-mutate executor shape):

1. Every Composio action name is unknown to
   :data:`stewardai.agent.chat.permissions.TIER`, so
   :func:`stewardai.agent.chat.permissions.gate` classifies all of them as
   ``"outward"`` -- calling one always raises a ``kind="permission"``
   interrupt (unless the user has "always allow"-ed that exact action slug),
   which the WS surfaces as ``permission_request`` with an args preview.
2. On "auto"/"approve", the action executes via ``ComposioService.execute``.
   ``ComposioService.get_tools`` already filters to the user's *connected*
   toolkits, so this should rarely see a disconnected app -- but a connection
   can be revoked between listing and execution (or a stale tool list is
   reused across a long chat session), so execution is still defended: a
   :class:`composio.exceptions.ConnectedAccountError` (covers
   ``ConnectedAccountNotFoundError``, an ACL-denied shared connection, etc.)
   or an unsuccessful result whose error text mentions the connection is
   treated as "not connected" and raises a second, ``kind="connect"``
   interrupt so the WS surfaces ``connect_required`` for that app. Resuming
   with the ``"retry"`` decision (``web/app.py`` maps a ``connect_done``
   client message to that) re-attempts execution exactly once more.

Building the tool list itself (``composio_service is None``, an API error
while listing) is fully defensive -- it degrades to ``[]`` rather than ever
raising into the chat graph, so chat still works with read+write tools only.
"""
from __future__ import annotations

import asyncio
from typing import Any

from langchain_core.tools import StructuredTool
from langgraph.types import interrupt

from stewardai.agent.chat.permissions import gate
from stewardai.common.logging import get_logger

_log = get_logger("agent.chat.composio_tools")

_SKIPPED: dict = {"skipped": True}
_RESULT_PREVIEW_LEN = 2000
_MAX_ATTEMPTS = 2  # first attempt + exactly one retry after a "connect" interrupt


# Gemini function-calling accepts only a small subset of JSON Schema. Composio's
# raw schemas (notably Google Calendar) carry keywords Gemini rejects — anyOf/
# oneOf/allOf, additionalProperties, $ref/$defs, format, default, pattern, … —
# and an unsupported function declaration makes Gemini return an EMPTY response
# for the WHOLE turn (no tool call, no text). Sanitize to the supported subset.
_GEMINI_SCHEMA_KEYS = frozenset(
    {"type", "properties", "required", "items", "enum", "description", "nullable"}
)


def _sanitize_gemini_schema(node: Any) -> Any:
    """Recursively reduce a JSON Schema to Gemini's supported subset: keep only
    known keys, flatten anyOf/oneOf/allOf to their first non-null branch, and
    collapse union ``type`` lists (``["string","null"]`` -> ``string`` +
    ``nullable``). Best-effort and total — never raises."""
    if not isinstance(node, dict):
        return node
    out: dict = {}
    for comb in ("anyOf", "oneOf", "allOf"):
        branches = node.get(comb)
        if isinstance(branches, list):
            for sub in branches:
                if isinstance(sub, dict) and sub.get("type") != "null":
                    out.update(_sanitize_gemini_schema(sub))
                    break
    for key, val in node.items():
        if key not in _GEMINI_SCHEMA_KEYS:
            continue
        if key == "type":
            if isinstance(val, list):
                non_null = [t for t in val if t != "null"]
                out["type"] = non_null[0] if non_null else "string"
                if "null" in val:
                    out["nullable"] = True
            else:
                out["type"] = val
        elif key == "properties" and isinstance(val, dict):
            out["properties"] = {k: _sanitize_gemini_schema(v) for k, v in val.items()}
        elif key == "items":
            out["items"] = _sanitize_gemini_schema(val)
        else:
            out[key] = val
    if out.get("type") == "object" and "properties" not in out:
        out["properties"] = {}
    return out


def _toolkit_of(slug: str) -> str:
    """Derive the toolkit slug from an action slug (prefix before first `_`).

    All allow-listed toolkits (gmail, googlecalendar, notion, slack) happen to
    equal their action slugs' lowercased first segment, so no lookup table is
    needed (contrast ``live_tools._slug_to_toolkit``, which keeps one anyway).
    """
    return slug.split("_")[0].lower()


def _mentions_connection_issue(text: str) -> bool:
    t = text.lower()
    return "connect" in t or "no active" in t or ("account" in t and "not found" in t)


def _is_not_connected(exc: BaseException | None, result: dict | None) -> bool:
    """Best-effort detection of a Composio "app not connected" signal.

    Two shapes are recognized:
    - a raised ``composio.exceptions.ConnectedAccountError`` (or any
      exception whose class name / message otherwise mentions a connection
      problem -- covers SDK versions that raise a plainer error), and
    - a returned-but-unsuccessful ``execute()`` result dict whose error text
      mentions one.
    """
    if exc is not None:
        try:
            from composio.exceptions import ConnectedAccountError

            if isinstance(exc, ConnectedAccountError):
                return True
        except ImportError:  # pragma: no cover - composio is a hard dependency
            pass
        if "ConnectedAccount" in type(exc).__name__:
            return True
        if _mentions_connection_issue(str(exc)):
            return True
    if result is not None and not result.get("successful", True):
        if _mentions_connection_issue(str(result.get("error") or "")):
            return True
    return False


def _trim_result(result: Any) -> dict:
    """Trim a Composio execute() result so a large payload doesn't blow up
    the LLM's context; always returns a plain dict."""
    if not isinstance(result, dict):
        return {"result": str(result)[:_RESULT_PREVIEW_LEN]}
    out = dict(result)
    data = out.get("data")
    if isinstance(data, (dict, list)):
        text = str(data)
        if len(text) > _RESULT_PREVIEW_LEN:
            out["data"] = text[:_RESULT_PREVIEW_LEN] + "...(truncated)"
    return out


def _fmt_event_dt(d: Any) -> str:
    """Format a Google Calendar start/end ({dateTime}|{date}) as a readable time,
    preserving the event's own offset (its wall-clock local time)."""
    if not isinstance(d, dict):
        return str(d) if d else ""
    dt = d.get("dateTime")
    if dt:
        try:
            from datetime import datetime

            return datetime.fromisoformat(dt).strftime("%a %b %d, %I:%M %p")
        except Exception:  # noqa: BLE001 - unparseable → show as-is
            return str(dt)
    return str(d.get("date") or "")


def _find_items(node: Any) -> list | None:
    """Locate the Google 'items' event array anywhere in the result payload."""
    if isinstance(node, dict):
        items = node.get("items")
        if isinstance(items, list):
            return items
        for v in node.values():
            found = _find_items(v)
            if found is not None:
                return found
    return None


def _format_calendar_events(slug: str, result: Any) -> dict | None:
    """For GOOGLECALENDAR_EVENTS_LIST, return a compact, pre-formatted event list
    so the model repeats accurate times instead of parsing/converting raw ISO
    (which it does unreliably — it hallucinated wrong times from the raw JSON).
    Returns None for other actions / unrecognized shapes (caller falls back)."""
    if slug != "GOOGLECALENDAR_EVENTS_LIST" or not isinstance(result, dict):
        return None
    items = _find_items(result.get("data"))
    if items is None:
        return None
    events = []
    for e in items:
        if not isinstance(e, dict):
            continue
        ev = {
            "summary": e.get("summary") or "(no title)",
            "start": _fmt_event_dt(e.get("start")),
            "end": _fmt_event_dt(e.get("end")),
        }
        if e.get("location"):
            ev["location"] = e["location"]
        events.append(ev)
    return {"events": events}


def _format_gmail_messages(slug: str, result: Any) -> dict | None:
    """For GMAIL_FETCH_EMAILS, return a compact list of REAL emails (from/subject/
    date/snippet) so the model repeats actual inbox contents instead of
    hallucinating (it invented emails from raw/truncated JSON). None otherwise."""
    if slug != "GMAIL_FETCH_EMAILS" or not isinstance(result, dict):
        return None
    data = result.get("data")
    msgs = data.get("messages") if isinstance(data, dict) else None
    if not isinstance(msgs, list):
        return None
    emails = []
    for m in msgs:
        if not isinstance(m, dict):
            continue
        prev = m.get("preview")
        snippet = prev.get("body") if isinstance(prev, dict) else None
        if not snippet:
            snippet = m.get("messageText") or ""
        emails.append(
            {
                "from": m.get("sender") or "",
                "to": m.get("to") or "",
                "subject": m.get("subject") or "(no subject)",
                "date": m.get("messageTimestamp") or "",
                "snippet": str(snippet)[:200],
            }
        )
    return {"emails": emails}


def _format_tool_result(slug: str, result: Any) -> dict | None:
    """Deterministically shape a tool result the model reads unreliably from raw
    JSON (calendar, gmail). Returns None to fall back to generic trimming."""
    for fmt in (_format_calendar_events, _format_gmail_messages):
        out = fmt(slug, result)
        if out is not None:
            return out
    return None


def build_composio_tools(*, user_id: str, composio_service: Any, client: Any = None) -> list:
    """Build one gated LangChain tool per the user's allow-listed, connected
    Composio action.

    Returns ``[]`` gracefully when ``composio_service`` is ``None`` (Composio
    disabled / unavailable) or when listing the user's tools fails for any
    reason -- chat still runs fine with read+write tools only.

    Parameters
    ----------
    user_id:
        Supabase user UUID / Composio entity id.
    composio_service:
        A :class:`stewardai.integrations.composio_service.ComposioService`
        instance, or ``None``.
    client:
        The Supabase client used by :func:`gate` for the "always allow"
        allowlist check. May be ``None`` -- ``gate`` degrades to "not
        allowlisted" and gates normally (see ``store.is_allowed``).
    """
    if composio_service is None:
        return []

    try:
        schemas = composio_service.get_tools(user_id)
    except Exception as exc:  # noqa: BLE001 - listing failure must not break chat
        _log.warning("composio_tools_list_failed", user_id=user_id, error=str(exc))
        return []

    tools: list = []
    for schema in schemas or []:
        fn_def = (schema or {}).get("function", {})
        slug: str = fn_def.get("name", "")
        if not slug:
            continue
        description: str = fn_def.get("description") or slug
        parameters: dict = fn_def.get("parameters") or {"type": "object", "properties": {}}
        tool = _make_tool(
            slug=slug,
            description=description,
            parameters=parameters,
            user_id=user_id,
            composio_service=composio_service,
            client=client,
        )
        if tool is not None:
            tools.append(tool)

    _log.info("composio_tools_built", user_id=user_id, count=len(tools))
    return tools


def _make_tool(
    *,
    slug: str,
    description: str,
    parameters: dict,
    user_id: str,
    composio_service: Any,
    client: Any,
) -> Any | None:
    app = _toolkit_of(slug)

    async def _run(**kwargs: Any) -> dict:
        # NOTE: deliberately NOT wrapped in try/except -- gate() (and the
        # connect-flow interrupt below) raise langgraph's GraphInterrupt
        # (a plain Exception subclass) to pause the turn; catching broadly
        # here would swallow that and silently break the permission/connect
        # flow instead of surfacing it. The graph engine itself intercepts
        # GraphInterrupt (turning it into a stream `__interrupt__` chunk --
        # see ChatSession._drive), and ChatSession._drive's own try/except
        # is the right place to catch any other genuine error.
        decision, edited_args = await gate(
            client,
            user_id=user_id,
            tool_name=slug,
            payload={"app": app, "action": slug, "args": kwargs},
        )
        if decision not in ("auto", "approve"):
            return dict(_SKIPPED)
        # Honor edits the user made in the approval card (they override the
        # model's drafted args), so "type it in the UI" actually takes effect.
        run_args = {**kwargs, **edited_args} if edited_args else kwargs
        return await _execute_with_connect_gate(
            slug=slug, app=app, kwargs=run_args, user_id=user_id, composio_service=composio_service,
        )

    clean = _sanitize_gemini_schema(parameters) if isinstance(parameters, dict) else None
    has_props = isinstance(clean, dict) and bool(clean.get("properties"))
    args_schema = clean if has_props else None
    try:
        return StructuredTool.from_function(
            coroutine=_run, name=slug, description=description, args_schema=args_schema,
        )
    except Exception as exc:  # noqa: BLE001 - a malformed schema shouldn't break other tools
        _log.warning("composio_tool_build_failed", slug=slug, error=str(exc))
        return None


async def _execute_with_connect_gate(
    *, slug: str, app: str, kwargs: dict, user_id: str, composio_service: Any
) -> dict:
    """Execute ``slug`` via ``composio_service``; on a "not connected" signal,
    interrupt with ``kind="connect"`` and retry exactly once if resumed with
    ``"retry"``."""
    for attempt in range(_MAX_ATTEMPTS):
        exc: Exception | None = None
        result: dict | None = None
        try:
            result = await asyncio.to_thread(composio_service.execute, user_id, slug, kwargs)
        except Exception as e:  # noqa: BLE001 - inspected below, not re-raised
            exc = e

        if not _is_not_connected(exc, result):
            if exc is not None:
                _log.warning("composio_tool_exec_failed", slug=slug, error=str(exc))
                return {"ok": False, "error": str(exc)}
            # Pre-format results the model reads unreliably (calendar times,
            # gmail lists) into clean data; otherwise trim the raw payload so a
            # large blob doesn't blow up the context (or get hallucinated).
            formatted = _format_tool_result(slug, result)
            return formatted if formatted is not None else _trim_result(result)

        decision = interrupt({"kind": "connect", "app": app, "tool": slug})
        if decision == "retry" and attempt < _MAX_ATTEMPTS - 1:
            continue
        return {"connect_required": True, "app": app, "tool": slug}

    return {"connect_required": True, "app": app, "tool": slug}  # pragma: no cover - unreachable
