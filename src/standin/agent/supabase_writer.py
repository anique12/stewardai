from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class SupabaseWriter:
    """Thin async wrapper for writing agent results to Supabase via service-role client."""

    def __init__(self, *, meeting_id: str, client: Any) -> None:
        self._meeting_id = meeting_id
        self._client = client

    async def append_segment(self, *, seq: int, speaker: str, text: str) -> None:
        await (
            self._client.table("transcript_segments")
            .upsert(
                {
                    "meeting_id": self._meeting_id,
                    "seq": seq,
                    "speaker": speaker,
                    "text": text,
                },
                on_conflict="meeting_id,seq",
            )
            .execute()
        )

    async def write_summary(
        self,
        *,
        tldr: str,
        decisions: list[dict[str, str]],
        discrepancies: list[dict[str, str]],
    ) -> None:
        await (
            self._client.table("summaries")
            .upsert(
                {
                    "meeting_id": self._meeting_id,
                    "tldr": tldr,
                    "decisions": decisions,
                    "discrepancies": discrepancies,
                },
                on_conflict="meeting_id",
            )
            .execute()
        )

    async def write_action_items(self, items: list[dict[str, Any]]) -> None:
        if not items:
            return
        rows = [
            {
                "meeting_id": self._meeting_id,
                "owner": item["owner"],
                "task": item["task"],
                "due": item.get("due"),
                "done": False,
            }
            for item in items
        ]
        await self._client.table("action_items").insert(rows).execute()

    async def set_bot_status(self, status: str) -> None:
        await (
            self._client.table("meetings")
            .update({"bot_status": status})
            .eq("id", self._meeting_id)
            .execute()
        )
