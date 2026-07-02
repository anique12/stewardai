"""Persist meeting artifacts (transcript, summary, action items) to Supabase.

The agent accumulates the transcript in-memory and writes summaries to local
eval files, but the portal reads these from Supabase tables keyed on the
``meetings.id`` UUID:

    transcript_segments  (meeting_id, seq, speaker, text)
    summaries            (meeting_id UNIQUE, tldr, decisions jsonb, discrepancies jsonb)
    action_items         (meeting_id, owner, task, due date)

These helpers push the artifacts using the service-role client (which bypasses
RLS — no INSERT policy exists for end users). Everything is best-effort and
idempotent so repeated summary triggers converge instead of duplicating and a
persistence failure never breaks a meeting.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from stewardai.common.logging import get_logger

if TYPE_CHECKING:
    from supabase import AsyncClient

_log = get_logger("agent.persistence")

# Transcript lines are stored as "[Speaker Name]: the spoken text" (assembly.label_text).
_SEGMENT_RE = re.compile(r"^\[(?P<speaker>[^\]]*)\]:\s?(?P<text>.*)$", re.DOTALL)
# action_items.due is a DATE column — only accept real ISO calendar dates; the
# LLM often emits vague strings ("Friday", "next week") which must become NULL.
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_segment(line: str) -> tuple[str, str]:
    """Split a "[Speaker]: text" transcript line into (speaker, text)."""
    m = _SEGMENT_RE.match(line)
    if m:
        speaker = (m.group("speaker") or "").strip() or "Speaker"
        return speaker, (m.group("text") or "").strip()
    return "Speaker", line.strip()


def _coerce_due(value: Any) -> str | None:
    """Keep only real YYYY-MM-DD values; everything else → None (date column)."""
    if isinstance(value, str) and _ISO_DATE_RE.match(value.strip()):
        return value.strip()
    return None


async def persist_transcript_segment(
    client: AsyncClient,
    meeting_uuid: str,
    seq: int,
    speaker: str,
    text: str,
) -> None:
    """Insert ONE transcript segment as it's produced (near-real-time portal view).

    Best-effort — the teardown ``persist_meeting_artifacts`` re-writes the full set
    idempotently, so a dropped live insert self-heals at meeting end.
    """
    t = (text or "").strip()
    if not t:
        return
    label = (speaker or "").strip() or "Speaker"
    try:
        await client.table("transcript_segments").insert(
            {"meeting_id": meeting_uuid, "seq": seq, "speaker": label, "text": t}
        ).execute()
    except Exception as exc:  # noqa: BLE001 - live persistence must never break a meeting
        _log.warning("persist_segment_failed", meeting_uuid=meeting_uuid, seq=seq, error=str(exc))


async def persist_meeting_artifacts(
    client: AsyncClient,
    meeting_uuid: str,
    transcript: list[str],
    summary: dict,
) -> None:
    """Write transcript_segments, summaries, and action_items for one meeting.

    Idempotent: transcript_segments + action_items are replaced (delete-then-
    insert) and summaries is upserted on meeting_id, so the "summarize" command
    trigger and the shutdown trigger converge rather than duplicating rows. Each
    table is guarded independently so one failing write still lets the others land.
    """
    # --- transcript_segments: one row per line, replace prior rows -----------
    try:
        rows = []
        for seq, line in enumerate(transcript):
            speaker, text = _parse_segment(line)
            if not text:
                continue
            rows.append(
                {"meeting_id": meeting_uuid, "seq": seq, "speaker": speaker, "text": text}
            )
        await client.table("transcript_segments").delete().eq(
            "meeting_id", meeting_uuid
        ).execute()
        if rows:
            await client.table("transcript_segments").insert(rows).execute()
        _log.info("persist_transcript", meeting_uuid=meeting_uuid, segments=len(rows))
    except Exception as exc:  # noqa: BLE001 — persistence must never break a meeting
        _log.warning("persist_transcript_failed", meeting_uuid=meeting_uuid, error=str(exc))

    # --- summaries: one row per meeting, upsert. The portal renders d.text, so
    # decisions/discrepancies are jsonb arrays of {"text": ...}, not bare strings.
    try:
        row = {
            "meeting_id": meeting_uuid,
            "tldr": str(summary.get("tldr") or ""),
            "decisions": [{"text": str(d)} for d in (summary.get("decisions") or [])],
            "discrepancies": [
                {"text": str(d)} for d in (summary.get("discrepancies") or [])
            ],
        }
        await client.table("summaries").upsert(row, on_conflict="meeting_id").execute()
        _log.info("persist_summary", meeting_uuid=meeting_uuid)
    except Exception as exc:  # noqa: BLE001
        _log.warning("persist_summary_failed", meeting_uuid=meeting_uuid, error=str(exc))

    # --- action_items: one row per item, replace prior rows ------------------
    try:
        items = []
        for a in summary.get("action_items") or []:
            task = str(a.get("task") or "").strip()
            if not task:
                continue
            items.append(
                {
                    "meeting_id": meeting_uuid,
                    "owner": str(a.get("owner") or "").strip() or "Unassigned",
                    "task": task,
                    "due": _coerce_due(a.get("due")),
                }
            )
        await client.table("action_items").delete().eq(
            "meeting_id", meeting_uuid
        ).execute()
        if items:
            await client.table("action_items").insert(items).execute()
        _log.info("persist_action_items", meeting_uuid=meeting_uuid, count=len(items))
    except Exception as exc:  # noqa: BLE001
        _log.warning("persist_action_items_failed", meeting_uuid=meeting_uuid, error=str(exc))
