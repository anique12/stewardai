"""Composio external tools for agentic chat, via PROGRESSIVE TOOL DISCLOSURE.

Instead of one gated tool per Composio action (Gmail / Google Calendar / Notion
/ Slack), whose combined JSON schemas cost ~16k tokens on EVERY LLM call, we
expose just two small generic tools and load per-action schemas on demand:

1. ``describe_action(app)`` -- returns that app's allow-listed action slugs and
   their argument schemas as a tool RESULT, so a fat schema is paid once, only
   for the app actually used, rather than upfront for all of them every call.
2. ``run_integration_action(app, action, args_json)`` -- executes one action.
   It calls :func:`stewardai.agent.chat.permissions.gate` with the REAL action
   slug (so read-verb slugs auto-run and everything else raises a
   ``kind="permission"`` interrupt with the args preview the approval card
   renders), then :func:`_execute_with_connect_gate`, which runs the action via
   ``ComposioService.execute`` and, on a "not connected" signal
   (:class:`composio.exceptions.ConnectedAccountError`, an ACL-denied shared
   connection, or an unsuccessful result mentioning the connection), raises a
   ``kind="connect"`` interrupt so the WS surfaces ``connect_required`` for that
   app. Resuming with ``"retry"`` (``web/app.py`` maps ``connect_done`` to it)
   re-attempts execution once. Result formatting (calendar/gmail) is keyed on
   the action slug exactly as before.

Building the tools is defensive: ``composio_service is None`` -> ``[]``; a bad
describe call returns an error result rather than raising into the chat graph.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from langchain_core.tools import StructuredTool
from langgraph.types import interrupt

from stewardai.agent.chat.permissions import gate


def _normalize_gmail_recipients(slug: str, kwargs: dict) -> dict:
    """GMAIL_SEND_EMAIL's ``recipient_email`` is a SINGLE address (alias ``to``);
    additional To recipients belong in the ``extra_recipients`` array. Models and
    the approval card naturally produce a comma/semicolon-separated string, which
    Composio then treats as one malformed address — single sends work, multi-
    recipient sends silently fail. Split the primary out and route the rest into
    ``extra_recipients`` so multi-recipient sends actually deliver."""
    if slug != "GMAIL_SEND_EMAIL":
        return kwargs
    raw = kwargs.get("recipient_email")
    if raw is None:
        raw = kwargs.get("to")
    if isinstance(raw, list):
        parts = [str(x).strip() for x in raw if str(x).strip()]
    elif isinstance(raw, str):
        parts = [p.strip() for p in re.split(r"[,;]", raw) if p.strip()]
    else:
        return kwargs
    if len(parts) <= 1:
        return kwargs
    out = dict(kwargs)
    out.pop("to", None)
    out["recipient_email"] = parts[0]
    existing = out.get("extra_recipients")
    existing = existing if isinstance(existing, list) else []
    merged: list[str] = []
    for e in [*parts[1:], *existing]:
        e = e.strip() if isinstance(e, str) else str(e)
        if e and e != parts[0] and e not in merged:
            merged.append(e)
    out["extra_recipients"] = merged
    return out
from stewardai.common.logging import get_logger
from stewardai.integrations.composio_service import _DEFINED_TOOLKITS

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


def build_composio_tools(
    *, user_id: str, composio_service: Any, client: Any = None, available: list[str] | None = None
) -> list:
    """Build THREE generic integration tools (progressive tool disclosure):

    - ``describe_action(app)`` — returns an app's allow-listed actions + their
      argument schemas ON DEMAND (as a tool result), so the model pays a fat
      Composio schema only for the app it actually uses, once — instead of every
      per-action schema (~16k tokens) being sent on every LLM call.
    - ``run_integration_action(app, action, args_json)`` — executes one action,
      going through the same permission gate + connect gate + result formatting
      as before, keyed on the real action slug (so the approval card, read-tier
      auto-run, and "Connect <app>" flow all behave exactly as with per-action
      tools).

    Returns ``[]`` when ``composio_service`` is ``None``.

    Parameters
    ----------
    user_id:
        Supabase user UUID / Composio entity id.
    composio_service:
        A :class:`stewardai.integrations.composio_service.ComposioService`, or ``None``.
    client:
        Supabase client for :func:`gate`'s "always allow" check (may be ``None``).
    available:
        Slugs the DB registry marks available (from ``registry.load_available``).
        The offered set is these intersected with the toolkits we have actions
        for. ``None`` → all defined toolkits (keeps chat working pre-registry).
    """
    if composio_service is None:
        return []
    src = available if available is not None else _DEFINED_TOOLKITS
    apps = [a for a in src if a in _DEFINED_TOOLKITS]
    tools = [
        _make_list_integrations_tool(user_id=user_id, composio_service=composio_service, apps=apps),
        _make_connect_tool(user_id=user_id, composio_service=composio_service, apps=apps),
        _make_describe_tool(user_id=user_id, composio_service=composio_service, apps=apps),
        _make_run_tool(
            user_id=user_id, composio_service=composio_service, client=client, apps=apps
        ),
    ]
    _log.info("composio_tools_built", user_id=user_id, count=len(tools), apps=apps)
    return tools


def _make_list_integrations_tool(*, user_id: str, composio_service: Any, apps: list[str]) -> Any:
    async def _list_integrations() -> dict:
        # Report REAL connection status so the model answers access/availability
        # questions truthfully instead of assuming it can (or can't) use an app.
        try:
            connected = set(composio_service.list_connected(user_id, apps))
        except Exception as exc:  # noqa: BLE001 - status unknown → say so, don't guess
            _log.warning("composio_list_connected_failed", error=str(exc))
            return {
                "apps": [{"app": a, "connected": None} for a in apps],
                "note": "couldn't verify connection status right now",
            }
        return {"apps": [{"app": a, "connected": a in connected} for a in apps]}

    return StructuredTool.from_function(
        coroutine=_list_integrations,
        name="list_integrations",
        description=(
            "List the external apps available to this user and whether each is connected. "
            "Call this to answer whether you can access or use an app — never assume."
        ),
        args_schema=None,
    )


def _make_connect_tool(*, user_id: str, composio_service: Any, apps: list[str]) -> Any:
    async def _connect_app(app: str) -> dict:
        # NOT wrapped in try/except around the interrupt: it raises langgraph's
        # GraphInterrupt to pause the turn (so the UI shows the Connect card).
        app_l = (app or "").strip().lower()
        if app_l not in apps:
            allowed = ", ".join(apps) if apps else "(none available)"
            return {"error": f"{app!r} isn't available; supported apps: {allowed}"}
        try:
            connected = app_l in set(composio_service.list_connected(user_id, [app_l]))
        except Exception as exc:  # noqa: BLE001 - status unknown → attempt connect anyway
            _log.warning("composio_list_connected_failed", error=str(exc))
            connected = False
        if connected:
            return {"app": app_l, "connected": True, "note": "already connected"}
        # Surface the Connect card (connect_required). On resume ("retry", after
        # the user connects) confirm the new status.
        decision = interrupt({"kind": "connect", "app": app_l, "tool": None})
        if decision == "retry":
            try:
                now = app_l in set(composio_service.list_connected(user_id, [app_l]))
            except Exception:  # noqa: BLE001
                now = False
            return {"app": app_l, "connected": now}
        return {"app": app_l, "connect_required": True}

    args_schema = {
        "type": "object",
        "properties": {
            "app": {"type": "string", "enum": list(apps), "description": "App to connect."}
        },
        "required": ["app"],
    }
    return StructuredTool.from_function(
        coroutine=_connect_app,
        name="connect_app",
        description=(
            "Show the user the Connect dialog for an available app so they can authorize it. "
            "Call this when the user wants to connect an app or asks how to — do NOT tell them to "
            "click a button unless you called this. No-op with a note if already connected."
        ),
        args_schema=args_schema,
    )


def _make_describe_tool(*, user_id: str, composio_service: Any, apps: list[str]) -> Any:
    async def _describe(app: str) -> dict:
        app_l = (app or "").strip().lower()
        if app_l not in apps:
            allowed = ", ".join(apps) if apps else "(none available)"
            return {"error": f"{app!r} isn't available; supported apps: {allowed}"}
        try:
            schemas = composio_service.get_tools(user_id, toolkits=[app_l], only_connected=False)
        except Exception as exc:  # noqa: BLE001 - listing failure → tell the model, don't crash
            _log.warning("composio_describe_failed", app=app_l, error=str(exc))
            return {"error": f"could not list actions for {app_l} right now"}
        actions = []
        for sc in schemas or []:
            fn = (sc or {}).get("function", {})
            name = fn.get("name")
            if not name:
                continue
            actions.append({
                "action": name,
                "description": fn.get("description") or name,
                "parameters": _sanitize_gemini_schema(fn.get("parameters") or {}),
            })
        return {"app": app_l, "actions": actions}

    args_schema = {
        "type": "object",
        "properties": {
            "app": {
                "type": "string",
                "enum": list(apps),
                "description": "Integration app to describe.",
            }
        },
        "required": ["app"],
    }
    apps_str = ", ".join(apps) if apps else "(none)"
    return StructuredTool.from_function(
        coroutine=_describe,
        name="describe_action",
        description=(
            "List an integration app's available actions and their exact argument "
            "schemas. ALWAYS call this before run_integration_action so you use the "
            f"correct action slug and arguments. app is one of: {apps_str}."
        ),
        args_schema=args_schema,
    )


def _make_run_tool(*, user_id: str, composio_service: Any, client: Any, apps: list[str]) -> Any:
    async def _run(app: str, action: str, args_json: str = "{}") -> dict:
        # NOT wrapped in try/except: gate()/connect interrupt raise langgraph's
        # GraphInterrupt to pause the turn — catching here would break the
        # permission/connect flow. ChatSession._drive catches real errors.
        app_l = (app or "").strip().lower()
        action_u = (action or "").strip()
        try:
            args = json.loads(args_json) if args_json and args_json.strip() else {}
        except Exception:  # noqa: BLE001 - malformed args → tell the model to retry
            return {"ok": False, "error": "args_json must be a valid JSON object string"}
        if not isinstance(args, dict):
            return {"ok": False, "error": "args_json must be a JSON object"}

        decision, edited_args = await gate(
            client,
            user_id=user_id,
            tool_name=action_u,  # real slug → correct tier + approval-card rendering
            payload={"app": app_l, "action": action_u, "args": args},
        )
        if decision not in ("auto", "approve"):
            return dict(_SKIPPED)
        run_args = {**args, **edited_args} if edited_args else args
        return await _execute_with_connect_gate(
            slug=action_u, app=app_l, kwargs=run_args,
            user_id=user_id, composio_service=composio_service,
        )

    args_schema = {
        "type": "object",
        "properties": {
            "app": {"type": "string", "enum": list(apps), "description": "Integration app."},
            "action": {
                "type": "string",
                "description": "Exact action slug from describe_action, e.g. GMAIL_SEND_EMAIL.",
            },
            "args_json": {
                "type": "string",
                "description": (
                    "The action's arguments as a JSON object string, matching the "
                    "schema from describe_action. Use {} if none."
                ),
            },
        },
        "required": ["app", "action", "args_json"],
    }
    return StructuredTool.from_function(
        coroutine=_run,
        name="run_integration_action",
        description=(
            "Execute an integration action on an available app (call "
            "list_integrations / describe_action first). Call describe_action(app) to "
            "get the action slug + arguments. If the app isn't connected, the user is "
            "automatically prompted to connect."
        ),
        args_schema=args_schema,
    )


async def _execute_with_connect_gate(
    *, slug: str, app: str, kwargs: dict, user_id: str, composio_service: Any
) -> dict:
    """Execute ``slug`` via ``composio_service``; on a "not connected" signal,
    interrupt with ``kind="connect"`` and retry exactly once if resumed with
    ``"retry"``."""
    kwargs = _normalize_gmail_recipients(slug, kwargs)
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
