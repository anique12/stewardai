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

import json
from typing import Any

from stewardai.common.audio import Message
from stewardai.common.logging import get_logger
from stewardai.integrations.composio_service import _ALLOW_LIST, ComposioService

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
    "  action_slug: the exact action slug from the allow-list provided\n"
    "  toolkit: the toolkit the action belongs to (e.g. 'gmail')\n"
    "  args: a JSON object with the arguments for the action (best-guess from transcript)\n\n"
    "Rules:\n"
    "- Only emit items where you can map to an EXACT allow-listed action_slug.\n"
    "- If you cannot map something to an allow-listed slug, skip it entirely.\n"
    "- For 'directed' items: these are explicit requests to Steward in the transcript.\n"
    "- For 'inferred' items: follow-ups or tasks discussed but not asked of Steward.\n"
    "- Do NOT invent slugs. Only use slugs from the allow-list.\n"
    "- Respond with [] if there is nothing to propose.\n"
    "- Do not include any text outside the JSON array."
)


def _build_extraction_prompt(
    transcript: list[str],
    connected_toolkits: list[str],
) -> str:
    """Build the user message for the extraction LLM pass.

    Includes the allow-listed slugs for each connected toolkit so the LLM
    has a closed vocabulary to map against.
    """
    toolkit_lines: list[str] = []
    for tk in connected_toolkits:
        slugs = [slug for slug, _ in _ALLOW_LIST.get(tk, [])]
        if slugs:
            toolkit_lines.append(f"  {tk}: {', '.join(slugs)}")

    allow_list_text = (
        "Allow-listed actions per toolkit:\n" + "\n".join(toolkit_lines)
        if toolkit_lines
        else "No toolkits connected — respond with []."
    )

    body = "\n".join(transcript) if transcript else "(no transcript captured)"
    return f"{allow_list_text}\n\nTranscript:\n{body}"


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

    prompt = _build_extraction_prompt(transcript, connected)
    chunks: list[str] = []
    try:
        async for delta in llm.complete(
            [Message(role="user", content=prompt)],
            system=_EXTRACT_SYSTEM,
            temperature=0.1,
        ):
            if delta:
                chunks.append(delta)
    except Exception:
        _log.exception(
            "post_meeting_extract_llm_failed", meeting_id=meeting_id
        )
        return 0

    raw = "".join(chunks).strip()
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

    # Build the flat allowed-slug set for connected toolkits
    allowed_slugs: frozenset[str] = frozenset(
        slug for tk in connected for slug, _ in _ALLOW_LIST.get(tk, [])
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

        row_id = await writer.insert(
            source=source,
            toolkit=toolkit,
            action_slug=slug,
            args=args,
            risk=risk,
            title=title,
            state=state,
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
