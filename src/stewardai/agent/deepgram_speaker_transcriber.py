"""Per-speaker streaming transcription via Deepgram → attributed transcript.

The bot forwards each participant's *raw continuous* audio (already speech-gated)
as ``(key, pcm)`` items, where ``key`` is ``"<stableSpeakerId>\\x1f<displayName>"``.
For each speaker id we hold one open Deepgram streaming connection (nova-3,
keyterm-boosted toward "Steward" + participant names) and push audio into it;
Deepgram does its own endpointing and emits ONE final per utterance — so, unlike
re-transcribing a growing buffer, there are no duplicated/growing lines.

Streams are keyed by the STABLE speaker id (not the display name) so a name that
resolves mid-utterance ("" -> "Kashmine") can't split one utterance across two
connections; the line is labeled with the latest known name at emit time.

Runs in parallel with the AgentSession (which still drives Steward's live turn-
taking on the combined stream). Each attributed line is persisted immediately for
a near-real-time portal view; the teardown pass reconciles the full set.
"""
from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from typing import Any

from stewardai.common.logging import get_logger

_log = get_logger("agent.deepgram_speaker_transcriber")

_SEP = "\x1f"  # unit separator between stable speaker id and display name
# The wake name is NOT hardcoded here — the caller passes the agent's configured
# display name (owner's bot_name) via ``extra_keyterms`` so it, not "Steward", is
# what gets biased. Speaker display names are added dynamically as people speak.
_BASE_KEYTERMS: tuple[str, ...] = ()
_MIN_PCM_BYTES = 1920  # skip sub-~60ms chunks (silence/click noise)


class DeepgramSpeakerTranscriber:
    """Streams each speaker's audio to its own Deepgram connection, keyed by id."""

    def __init__(
        self,
        stt_factory: Callable[[list[str]], Any],
        transcript: list[str],
        *,
        transcript_path: str | None = None,
        supabase: Any = None,
        meeting_uuid: str | None = None,
        extra_keyterms: list[str] | None = None,
        sample_rate: int = 16_000,
    ) -> None:
        # stt_factory(keyterms) -> a livekit deepgram STT (nova-3). Injected so this
        # module stays free of the deepgram/config import + is unit-testable.
        self._stt_factory = stt_factory
        self._transcript = transcript
        self._transcript_path = transcript_path
        self._supabase = supabase
        self._meeting_uuid = meeting_uuid
        self._extra_keyterms = list(extra_keyterms or [])
        self._sample_rate = sample_rate
        self._names: dict[str, str] = {}  # speaker id -> latest display name
        self._stts: dict[str, Any] = {}
        self._streams: dict[str, Any] = {}
        self._readers: dict[str, asyncio.Task] = {}

    def _keyterms(self) -> list[str]:
        seen: dict[str, None] = {}
        for t in (*_BASE_KEYTERMS, *self._extra_keyterms, *self._names.values()):
            t = (t or "").strip()
            if t:
                seen.setdefault(t, None)
        return list(seen)

    async def run(self, segments: AsyncIterator[tuple[str, bytes]]) -> None:
        """Consume ``(key, pcm)`` chunks until the stream ends (bot disconnect)."""
        from livekit import rtc  # lazy: heavy import, only when per-speaker is active

        try:
            async for raw_key, pcm in segments:
                sid, _, name = raw_key.partition(_SEP)
                sid = sid or raw_key  # tolerate legacy frames with no separator
                name = name.strip()
                if name:
                    self._names[sid] = name
                if len(pcm) < _MIN_PCM_BYTES:
                    continue
                stream = self._ensure_stream(sid)
                if stream is None:
                    continue
                samples = len(pcm) // 2
                if samples == 0:
                    continue
                with contextlib.suppress(Exception):
                    stream.push_frame(
                        rtc.AudioFrame(
                            data=pcm,
                            sample_rate=self._sample_rate,
                            num_channels=1,
                            samples_per_channel=samples,
                        )
                    )
        finally:
            await self._close_all()

    def _ensure_stream(self, sid: str):  # noqa: ANN201
        """Get or lazily open this speaker's Deepgram stream + reader task."""
        stream = self._streams.get(sid)
        if stream is not None:
            return stream
        try:
            stt = self._stt_factory(self._keyterms())
            stream = stt.stream()
        except Exception as exc:  # noqa: BLE001 - a bad open can't kill the session
            _log.warning("deepgram_stream_open_failed", speaker_id=sid, error=str(exc))
            return None
        self._stts[sid] = stt
        self._streams[sid] = stream
        self._readers[sid] = asyncio.create_task(self._read(sid, stream))
        _log.info("deepgram_speaker_stream_opened", speaker_id=sid, name=self._names.get(sid))
        return stream

    async def _read(self, sid: str, stream) -> None:  # noqa: ANN001
        """Drain FINAL transcripts from one speaker's stream → attributed lines."""
        from livekit.agents.stt import SpeechEventType

        try:
            async for ev in stream:
                if ev.type != SpeechEventType.FINAL_TRANSCRIPT:
                    continue
                alts = getattr(ev, "alternatives", None) or []
                text = (alts[0].text if alts else "").strip()
                if not text:
                    continue
                label = self._names.get(sid) or "Speaker"
                line = f"[{label}]: {text}"
                self._transcript.append(line)
                # seq = position in the shared transcript list, so the bot's own
                # lines (appended elsewhere) interleave with one consistent ordering.
                seq = len(self._transcript) - 1
                if self._transcript_path:
                    with contextlib.suppress(Exception):
                        from stewardai.agent.summary import append_transcript_line

                        append_transcript_line(self._transcript_path, line)
                if self._supabase is not None and self._meeting_uuid:
                    from stewardai.agent.persistence import persist_transcript_segment

                    await persist_transcript_segment(
                        self._supabase, self._meeting_uuid, seq, label, text
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one stream dying can't kill others
            _log.warning("deepgram_reader_error", speaker_id=sid, error=str(exc))

    async def _close_all(self) -> None:
        for stream in self._streams.values():
            with contextlib.suppress(Exception):
                stream.end_input()
        for task in self._readers.values():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await asyncio.wait_for(task, timeout=5.0)
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        for stream in self._streams.values():
            with contextlib.suppress(Exception):
                await stream.aclose()
        for stt in self._stts.values():
            with contextlib.suppress(Exception):
                await stt.aclose()
        _log.info("deepgram_speaker_transcriber_done", speakers=len(self._streams))
