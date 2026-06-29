from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

import httpx
from supabase import AsyncClient, acreate_client

logger = logging.getLogger(__name__)

LOOK_AHEAD_S = 600    # 10 minutes
LOOK_BEHIND_S = 300   # 5 minutes grace for already-started meetings
POLL_INTERVAL_S = 60


def is_due(meeting: dict) -> bool:
    """Return True if the meeting falls within the join window."""
    raw = meeting["start_time"]
    # Handle both offset-aware and offset-naive ISO strings
    start = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    return -LOOK_BEHIND_S <= (start - now).total_seconds() <= LOOK_AHEAD_S


def build_bot_payload(meeting: dict, *, bot_name: str) -> dict:
    return {
        "meeting_url": meeting["meet_url"],
        "bot_name": bot_name,
    }


async def get_due_meetings(client: AsyncClient) -> list[dict]:
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(seconds=LOOK_BEHIND_S)).isoformat()
    window_end = (now + timedelta(seconds=LOOK_AHEAD_S)).isoformat()
    res = (
        await client.table("meetings")
        .select("id,user_id,meet_url,opted_in,bot_status,start_time")
        .eq("opted_in", True)
        .eq("bot_status", "pending")
        .gte("start_time", window_start)
        .lte("start_time", window_end)
        .execute()
    )
    return res.data or []


async def spawn_bot(meeting: dict, *, client: AsyncClient, vexa_url: str, vexa_api_key: str) -> None:
    payload = build_bot_payload(meeting, bot_name="StewardAI")
    async with httpx.AsyncClient() as http:
        resp = await http.post(
            f"{vexa_url}/bots",
            json=payload,
            headers={"Authorization": f"Bearer {vexa_api_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

    vexa_meeting_id = data.get("id") or data.get("meeting_id")
    await (
        client.table("meetings")
        .update({"bot_status": "joining", "vexa_meeting_id": str(vexa_meeting_id)})
        .eq("id", meeting["id"])
        .execute()
    )
    logger.info("Spawned bot for meeting %s (vexa_id=%s)", meeting["id"], vexa_meeting_id)


async def run_once(client: AsyncClient, vexa_url: str, vexa_api_key: str) -> None:
    meetings = await get_due_meetings(client)
    logger.info("Scheduler tick: %d due meeting(s)", len(meetings))
    for meeting in meetings:
        try:
            await spawn_bot(meeting, client=client, vexa_url=vexa_url, vexa_api_key=vexa_api_key)
        except Exception:
            logger.exception("Failed to spawn bot for meeting %s", meeting["id"])
            await (
                client.table("meetings")
                .update({"bot_status": "failed"})
                .eq("id", meeting["id"])
                .execute()
            )


async def run_forever(interval_s: int = POLL_INTERVAL_S) -> None:
    supabase_url = os.environ["SUPABASE_URL"]
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    vexa_url = os.environ["VEXA_GATEWAY_URL"]
    vexa_api_key = os.environ["VEXA_API_KEY"]

    client: AsyncClient = await acreate_client(supabase_url, service_key)
    logger.info("Scheduler started (poll interval %ds)", interval_s)
    while True:
        await run_once(client, vexa_url, vexa_api_key)
        await asyncio.sleep(interval_s)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(run_forever())
