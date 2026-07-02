"""Per-speaker transcription → an attributed meeting transcript.

The bot forwards each participant's utterance segments (already VAD-cut and
name-resolved by Vexa) as ``(speaker, pcm)`` items over the per-speaker frame
channel. We transcribe each segment with the shared STT backend and append an
attributed ``"[Name]: text"`` line.

This runs in PARALLEL with — and never touches — the AgentSession that drives
Steward's live turn-taking on the combined stream. It only builds the transcript
that persistence + summary consume, so real speaker names reach the portal.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from stewardai.common.logging import get_logger

_log = get_logger("agent.per_speaker_transcriber")

# Skip segments shorter than ~100 ms (3200 bytes of s16le @ 16 kHz) — clicks/noise
# that Vexa's VAD occasionally emits; transcribing them wastes an STT pass.
_MIN_PCM_BYTES = 3200


class PerSpeakerTranscriber:
    """Transcribes per-speaker segments into an attributed transcript list."""

    def __init__(
        self,
        stt_backend,  # noqa: ANN001 - shared STT backend (duck-typed .transcribe)
        transcript: list[str],
        transcript_path: str | None = None,
        *,
        sample_rate: int = 16_000,
    ) -> None:
        self._stt = stt_backend
        self._transcript = transcript
        self._transcript_path = transcript_path
        self._sample_rate = sample_rate
        self._count = 0

    async def run(self, segments: AsyncIterator[tuple[str, bytes]]) -> None:
        """Consume ``(speaker, pcm)`` segments until the stream ends (bot disconnect)."""
        async for speaker, pcm in segments:
            if len(pcm) < _MIN_PCM_BYTES:
                continue
            try:
                result = await self._stt.transcribe(
                    pcm, sample_rate=self._sample_rate, lang="en"
                )
            except Exception as exc:  # noqa: BLE001 - one bad segment can't kill the loop
                _log.warning("per_speaker_stt_failed", speaker=speaker, error=str(exc))
                continue
            text = (getattr(result, "text", "") or "").strip()
            if not text:
                continue
            # Vexa's DOM name-voting can briefly lag a speaker's first segment;
            # fall back to a generic label rather than emitting "[]: ...".
            label = (speaker or "").strip() or "Speaker"
            line = f"[{label}]: {text}"
            self._transcript.append(line)
            self._count += 1
            if self._transcript_path:
                try:
                    from stewardai.agent.summary import append_transcript_line

                    append_transcript_line(self._transcript_path, line)
                except Exception as exc:  # noqa: BLE001 - file backup is best-effort
                    _log.warning("per_speaker_transcript_write_failed", error=str(exc))
        _log.info("per_speaker_transcriber_done", segments=self._count)
