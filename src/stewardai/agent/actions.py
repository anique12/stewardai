"""Agent actions: Supabase persistence and post-meeting extraction.

This module provides:
- ``AgentActionsWriter`` — thin async wrapper for reading/writing the
  ``agent_actions`` Supabase table (one row per action proposed, approved,
  running, done, or failed).
- ``extract_post_meeting_actions`` — LLM pass that reads the meeting
  transcript and proposes rows: directed asks (source='directed') and
  inferred follow-ups (source='inferred'). Only maps to allow-listed
  action slugs on toolkits the user actually has connected.

Data contract (columns): id, meeting_id, user_id, source, toolkit,
action_slug, args, risk, title, state, result, error, created_at, updated_at.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger
from stewardai.integrations.composio_service import ComposioService

_log = get_logger("agent.actions")


# ---------------------------------------------------------------------------
# Supabase writer
# ---------------------------------------------------------------------------


class AgentActionsWriter:
    """Async helper for the ``agent_actions`` table.

    Parameters
    ----------
    meeting_id:
        UUID of the meeting row (``vexa_meeting_id`` / Supabase meeting id).
    user_id:
        Supabase user UUID (owner of the meeting).
    client:
        An async Supabase client (``supabase.AsyncClient``) created with the
        service-role key so it can bypass RLS.
    """

    def __init__(self, *, meeting_id: str, user_id: str, client: Any) -> None:
        self._meeting_id = meeting_id
        self._user_id = user_id
        self._client = client

    async def insert(
        self,
        *,
        source: str,
        toolkit: str,
        action_slug: str,
        args: dict[str, Any],
        risk: str,
        title: str,
        state: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        source_seq: int | None = None,
    ) -> str | None:
        """Insert a new agent_actions row, return the row id (or None on error)."""
        row: dict[str, Any] = {
            "meeting_id": self._meeting_id,
            "user_id": self._user_id,
            "source": source,
            "toolkit": toolkit,
            "action_slug": action_slug,
            "args": args,
            "risk": risk,
            "title": title,
            "state": state,
        }
        if source_seq is not None:
            row["source_seq"] = source_seq
        if result is not None:
            row["result"] = result
        if error is not None:
            row["error"] = error
        try:
            resp = await self._client.table("agent_actions").insert(row).execute()
            data = resp.data or []
            if data:
                return data[0].get("id")
        except Exception:
            _log.exception("agent_actions_insert_failed", action_slug=action_slug)
        return None

    async def update_state(
        self,
        row_id: str,
        *,
        state: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        """Transition an existing row to ``state`` (e.g. 'done' or 'failed')."""
        patch: dict[str, Any] = {"state": state}
        if result is not None:
            patch["result"] = result
        if error is not None:
            patch["error"] = error
        try:
            await (
                self._client.table("agent_actions")
                .update(patch)
                .eq("id", row_id)
                .execute()
            )
        except Exception:
            _log.exception(
                "agent_actions_update_state_failed", row_id=row_id, state=state
            )


# ---------------------------------------------------------------------------
# Post-meeting extraction prompt
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = (
    "You extract actionable items from a meeting transcript. "
    "Respond ONLY with a JSON array of objects. Each object has these fields:\n"
    "  source: 'directed' (someone explicitly asked Steward to do X) or "
    "'inferred' (discussed follow-up, not asked of Steward)\n"
    "  title: short human-readable description (e.g. 'Send recap to team')\n"
    "  action_slug: the exact 'name' of one of the AVAILABLE ACTIONS listed below\n"
    "  toolkit: that action's toolkit (e.g. 'gmail', 'googlecalendar')\n"
    "  args: a JSON object whose keys/types match that action's params schema EXACTLY\n"
    "  source_line: the 0-based index of the transcript line that motivated this "
    "item (an integer shown as 'N:' at the start of each line below), or null if none\n\n"
    "Rules:\n"
    "- Only emit items you can map to one of the AVAILABLE ACTIONS (by its exact name). "
    "Skip anything you cannot map. Do NOT invent action names or arg keys.\n"
    "- Build args ONLY from the chosen action's params schema (shown with each action). "
    "Include every required field.\n"
    "- Any datetime arg MUST be an ABSOLUTE ISO 8601 value ('YYYY-MM-DDTHH:MM:SS'). "
    "Resolve relative words ('tomorrow', 'this Friday', 'next week') against the CURRENT "
    "DATE/TIME given below — NEVER pass natural language into a datetime field.\n"
    "- If a meeting/call/sync with a time is discussed, propose the calendar create "
    "action (source='inferred') — it is the most common useful follow-up.\n"
    "- Respond with [] if there is nothing to propose.\n"
    "- Do not include any text outside the JSON array."
)


def _now_in_tz(tz: str) -> str:
    """Current datetime as ISO-8601 in the given IANA timezone (fallback: local)."""
    from zoneinfo import ZoneInfo

    try:
        return datetime.now(ZoneInfo(tz)).isoformat(timespec="seconds")
    except Exception:  # noqa: BLE001 — bad/unknown tz → local time
        return datetime.now().astimezone().isoformat(timespec="seconds")


def _coerce_source_line(value: Any) -> int | None:
    """Accept an int or int-like string transcript index; else None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def _build_extraction_prompt(
    tools: list[dict],
    transcript: list[str],
    now_iso: str,
    timezone: str = "UTC",
) -> str:
    """Build the extraction user message from the tools' OWN Composio schemas.

    Each available action is described by its real name + params JSON schema, so
    the LLM maps to exact arg keys with no hardcoded per-tool knowledge — adding a
    new allow-listed tool needs zero prompt changes. The current date/time is the
    one thing a schema can't provide, so it's injected for relative-time resolution.
    """
    lines: list[str] = []
    for t in tools:
        fn = (t.get("function") or {}) if isinstance(t, dict) else {}
        name = fn.get("name")
        if not name:
            continue
        desc = (fn.get("description") or "").strip().replace("\n", " ")[:160]
        params = json.dumps(fn.get("parameters") or {}, separators=(",", ":"))
        lines.append(f"- {name}: {desc}\n  params: {params}")

    tools_text = (
        "AVAILABLE ACTIONS (map to a name, build args from its params schema):\n"
        + "\n".join(lines)
        if lines
        else "No actions available — respond with []."
    )
    body = (
        "\n".join(f"{i}: {line}" for i, line in enumerate(transcript))
        if transcript
        else "(no transcript captured)"
    )
    return (
        f"Current date and time: {now_iso}\nUser timezone (IANA): {timezone}\n\n"
        f"{tools_text}\n\nTranscript:\n{body}"
    )


# ---------------------------------------------------------------------------
# Post-meeting extraction
# ---------------------------------------------------------------------------


async def extract_post_meeting_actions(
    llm: Any,
    transcript: list[str],
    *,
    user_id: str,
    meeting_id: str,
    composio_service: ComposioService,
    writer: AgentActionsWriter,
    default_timezone: str = "UTC",
) -> int:
    """Run an LLM pass on the transcript and write proposed ``agent_actions`` rows.

    Each extracted item is mapped to a real allow-listed action_slug.  Risk is
    looked up via ``composio_service.risk_of()``.  State rules:
    - directed + low risk  → state='approved'  (worker will auto-execute)
    - directed + high risk → state='proposed'  (needs user confirmation)
    - inferred (any risk)  → state='proposed'  (always needs confirmation)

    Parameters
    ----------
    llm:
        An ``LLMBackend`` instance (has a ``complete()`` async generator).
    transcript:
        Speaker-labeled lines from the meeting.
    user_id:
        Supabase user UUID — used to look up connected toolkits.
    meeting_id:
        UUID of the meeting.
    composio_service:
        Service instance for toolkit/risk lookups.
    writer:
        ``AgentActionsWriter`` wired to the same meeting + user.

    Returns
    -------
    int
        Number of rows written.
    """
    connected = composio_service.list_connected(user_id)
    if not connected:
        _log.info(
            "post_meeting_extract_skip_no_toolkits",
            meeting_id=meeting_id,
        )
        return 0

    tools = composio_service.get_tools(user_id)
    if not tools:
        _log.info("post_meeting_extract_skip_no_tools", meeting_id=meeting_id)
        return 0

    now_iso = _now_in_tz(default_timezone)
    prompt = _build_extraction_prompt(tools, transcript, now_iso, default_timezone)
    # Retry the LLM call: this runs at teardown right after the summary pass, so a
    # transient API/rate error would otherwise silently drop every proposed action.
    raw = ""
    for attempt in range(3):
        chunks: list[str] = []
        try:
            async for delta in llm.complete(
                [Message(role="user", content=prompt)],
                system=_EXTRACT_SYSTEM,
                temperature=0.1,
            ):
                if delta:
                    chunks.append(delta)
            raw = "".join(chunks).strip()
            break
        except Exception:
            if attempt == 2:
                _log.exception("post_meeting_extract_llm_failed", meeting_id=meeting_id)
                return 0
            _log.warning(
                "post_meeting_extract_llm_retry", meeting_id=meeting_id, attempt=attempt
            )
            await asyncio.sleep(1.0 * (attempt + 1))
    # Strip markdown fences if the model wraps the JSON
    if raw.startswith("```"):
        raw = raw.strip("`")
        idx = raw.find("[")
        raw = raw[idx:] if idx != -1 else raw

    try:
        items: list[dict[str, Any]] = json.loads(raw)
        if not isinstance(items, list):
            items = []
    except (ValueError, json.JSONDecodeError):
        _log.warning(
            "post_meeting_extract_json_parse_failed",
            raw_preview=raw[:200],
            meeting_id=meeting_id,
        )
        return 0

    # Allowed slugs = the exact action names whose schemas we showed the LLM.
    allowed_slugs: frozenset[str] = frozenset(
        (t.get("function") or {}).get("name")
        for t in tools
        if isinstance(t, dict) and (t.get("function") or {}).get("name")
    )

    written = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        slug = item.get("action_slug", "")
        toolkit = item.get("toolkit", "")
        title = item.get("title", slug)
        source = item.get("source", "inferred")
        args = item.get("args") or {}
        # Stamp the user's timezone on calendar events so the worker books the
        # correct LOCAL time (the create tool assumes UTC when it's missing).
        if slug == "GOOGLECALENDAR_CREATE_EVENT" and not str(args.get("timezone") or "").strip():
            args["timezone"] = default_timezone

        # Skip any slug not on the allow-list for the user's connected toolkits
        if slug not in allowed_slugs:
            _log.debug(
                "post_meeting_extract_slug_skipped", slug=slug
            )
            continue

        try:
            risk = composio_service.risk_of(slug)
        except KeyError:
            continue

        # State logic: directed+low → approved; everything else → proposed
        if source == "directed" and risk == "low":
            state = "approved"
        else:
            state = "proposed"

        src_line = _coerce_source_line(item.get("source_line"))
        row_id = await writer.insert(
            source=source,
            toolkit=toolkit,
            action_slug=slug,
            args=args,
            risk=risk,
            title=title,
            state=state,
            source_seq=src_line,
        )
        if row_id:
            written += 1
            _log.info(
                "post_meeting_extract_wrote_action",
                meeting_id=meeting_id,
                slug=slug,
                source=source,
                state=state,
                risk=risk,
                row_id=row_id,
            )

    return written
