"""Subscribe to Vexa's per-utterance speaker events and track the active speaker.

The bot publishes JSON {speaker, event:"start"|"end", ts} to the Redis channel
``steward_speaker:meeting:<id>``. ``redis`` is imported lazily (no hard dep).
"""

from __future__ import annotations

import asyncio
import contextlib
import json

from stewardai.common.logging import get_logger

_log = get_logger("bridge.speaker_events")


class SpeakerTracker:
    """Tracks who currently holds the floor from start/end events."""

    def __init__(self) -> None:
        # ordered list of currently-open speakers (by start order)
        self._open: list[str] = []

    def on_event(self, speaker: str, event: str, ts_ms: int) -> None:  # noqa: ARG002
        if event == "start":
            if speaker in self._open:
                self._open.remove(speaker)
            self._open.append(speaker)  # most-recent at the end
        elif event == "end":
            with contextlib.suppress(ValueError):
                self._open.remove(speaker)

    def note_active(self, speaker: str) -> None:
        """Mark ``speaker`` as the most-recently-active speaker.

        Used when the only signal available is a per-speaker AUDIO stream that
        carries the speaker's name (the bot publishes no explicit start/end
        events on some platforms): whoever most recently emitted audio holds the
        floor, which is what a turn finalizing right after them should be labeled.
        """
        speaker = (speaker or "").strip()
        if speaker:
            self.on_event(speaker, "start", 0)

    def current_speaker(self) -> str | None:
        return self._open[-1] if self._open else None


class RosterSubscriber:
    """Background Redis subscriber for the live participant roster + avatar URLs.

    The steward bot publishes ``{"participants": [{"name", "image"}]}`` to
    ``steward_roster:meeting:<id>`` every few seconds (the full tile scan, not
    just speakers). On each message we hand a ``{name: image_url}`` map (only
    entries with a real image) to ``on_roster`` — the meeting runner merges it
    into ``meetings.attendees[].photoUrl`` LIVE, so avatars appear mid-meeting
    instead of at teardown. ``redis`` is imported lazily (no hard dep)."""

    def __init__(self, redis_url: str, meeting_id: str, on_roster) -> None:  # noqa: ANN001
        self.channel = f"steward_roster:meeting:{meeting_id}"
        self._redis_url = redis_url
        self._on_roster = on_roster
        self._client = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        import redis.asyncio as redis  # noqa: PLC0415 — lazy

        self._client = redis.from_url(self._redis_url)
        pubsub = self._client.pubsub()
        await pubsub.subscribe(self.channel)
        self._task = asyncio.create_task(self._run(pubsub))
        _log.info("roster_subscribed", channel=self.channel)

    async def _run(self, pubsub) -> None:  # noqa: ANN001
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                    participants = data.get("participants") or []
                    name_to_image = {
                        str(p["name"]).strip(): str(p["image"])
                        for p in participants
                        if isinstance(p, dict) and p.get("name") and p.get("image")
                    }
                    if name_to_image:
                        await self._on_roster(name_to_image)
                except Exception as exc:  # noqa: BLE001 - never die on a bad event
                    _log.warning("roster_event_bad", error=str(exc))
        except asyncio.CancelledError:
            raise

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._client is not None:
            with contextlib.suppress(Exception):
                await self._client.aclose()
            self._client = None


class SpeakerSubscriber:
    """Background Redis subscriber feeding a SpeakerTracker."""

    def __init__(self, redis_url: str, meeting_id: str, tracker: SpeakerTracker) -> None:
        self.channel = f"steward_speaker:meeting:{meeting_id}"
        self._redis_url = redis_url
        self._tracker = tracker
        self._client = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        import redis.asyncio as redis  # noqa: PLC0415 — lazy

        self._client = redis.from_url(self._redis_url)
        pubsub = self._client.pubsub()
        await pubsub.subscribe(self.channel)
        self._task = asyncio.create_task(self._run(pubsub))
        _log.info("speaker_subscribed", channel=self.channel)

    async def _run(self, pubsub) -> None:  # noqa: ANN001
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                    self._tracker.on_event(data["speaker"], data["event"], int(data.get("ts", 0)))
                except Exception as exc:  # noqa: BLE001 - never die on a bad event
                    _log.warning("speaker_event_bad", error=str(exc))
        except asyncio.CancelledError:
            raise

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._client is not None:
            with contextlib.suppress(Exception):
                await self._client.aclose()
            self._client = None
