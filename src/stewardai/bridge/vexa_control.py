"""Publish bot control commands (mic on/off, stop speaking) to Vexa over Redis.

Vexa's bot subscribes to ``bot_commands:meeting:{id}``; we publish small JSON
commands there. ``redis`` is imported lazily so this module imports without it.
"""

from __future__ import annotations

import json

from stewardai.common.logging import get_logger

_log = get_logger("bridge.vexa_control")


def _command(action: str) -> str:
    """Return the JSON string published for *action*."""
    return json.dumps({"action": action})


class RedisControl:
    """Publish mic-gating and barge-in commands to the Vexa bot over Redis.

    Parameters
    ----------
    redis_url:
        Redis connection URL, e.g. ``"redis://localhost:6379"``.
    meeting_id:
        Unique meeting identifier — scopes the pub/sub channel so commands
        reach only the correct bot instance.
    """

    def __init__(self, redis_url: str, meeting_id: str) -> None:
        self.redis_url = redis_url
        self.meeting_id = meeting_id
        self.channel = f"bot_commands:meeting:{meeting_id}"
        self._client = None

    async def _publish(self, action: str) -> None:
        if self._client is None:
            import redis.asyncio as redis  # noqa: PLC0415 — lazy: no hard dep
            self._client = redis.from_url(self.redis_url)
        await self._client.publish(self.channel, _command(action))
        _log.info("vexa_control", action=action, channel=self.channel)

    async def mic_on(self) -> None:
        """Gate the mic open — bot resumes listening."""
        await self._publish("mic_on")

    async def mic_off(self) -> None:
        """Gate the mic closed — bot stops listening."""
        await self._publish("mic_off")

    async def speak_stop(self) -> None:
        """Signal the bot to stop speaking immediately (barge-in)."""
        await self._publish("speak_stop")

    async def aclose(self) -> None:
        """Close the underlying Redis connection."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
