"""Agent audio playback into the meeting.

``SinkPlayer`` writes s16le/16 kHz/mono PCM to a PulseAudio sink via ``paplay``
(the sink Vexa records from). On a box without PulseAudio (e.g. Mac dev) it falls
back to writing a WAV file via soundfile and logging a warning.

``QueueAudioOutput`` adapts our audio stream to LiveKit's ``AudioOutput`` when
livekit is installed; otherwise it's a plain async-iterable queue. livekit is
imported lazily so this module is LIGHT in the base install.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
import time
from collections.abc import AsyncIterator

from stewardai.common.audio import SAMPLE_RATE, AudioFrame
from stewardai.common.logging import get_logger

_log = get_logger("bridge.audio_output")


class SinkPlayer:
    """Play agent PCM to a PulseAudio sink, falling back to a WAV file.

    Args:
        sink: PulseAudio sink name passed to ``paplay --device``.
        fallback_wav: where to write PCM if ``paplay`` is unavailable; a temp
            file is used when None.
    """

    def __init__(self, sink: str = "tts_sink", fallback_wav: str | None = None) -> None:
        self.sink = sink
        self.fallback_wav = fallback_wav

    async def play(self, frames: AsyncIterator[AudioFrame]) -> None:
        if shutil.which("paplay") is not None:
            await self._play_paplay(frames)
        else:
            await self._play_fallback(frames)

    async def _play_paplay(self, frames: AsyncIterator[AudioFrame]) -> None:
        cmd = [
            "paplay",
            "--raw",
            "--format=s16le",
            f"--rate={SAMPLE_RATE}",
            "--channels=1",
            f"--device={self.sink}",
        ]
        _log.info("paplay_start", sink=self.sink)
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE
        )
        assert proc.stdin is not None
        nbytes = 0
        try:
            async for frame in frames:
                proc.stdin.write(frame.pcm)
                await proc.stdin.drain()
                nbytes += len(frame.pcm)
        finally:
            try:
                proc.stdin.close()
            except (BrokenPipeError, ConnectionResetError):
                pass
            await proc.wait()
        _log.info("paplay_done", sink=self.sink, bytes=nbytes)

    async def _play_fallback(self, frames: AsyncIterator[AudioFrame]) -> None:
        import numpy as np
        import soundfile as sf

        path = self.fallback_wav
        if path is None:
            fd, path = tempfile.mkstemp(suffix=".wav", prefix="stewardai_tts_")
            import os

            os.close(fd)
        _log.warning("paplay_missing_fallback_wav", path=path)
        chunks: list[bytes] = []
        async for frame in frames:
            chunks.append(frame.pcm)
        pcm = b"".join(chunks)
        samples = np.frombuffer(pcm, dtype="<i2")
        sf.write(path, samples, SAMPLE_RATE, subtype="PCM_16")
        _log.info("fallback_wav_written", path=path, samples=int(samples.size))


def _make_queue_audio_output():
    """Build the QueueAudioOutput class, subclassing livekit's AudioOutput if present."""
    try:
        from livekit.agents.voice import io as lk_io  # type: ignore

        base = lk_io.AudioOutput
        capabilities = lk_io.AudioOutputCapabilities(pause=False)
        has_livekit = True
    except Exception:  # noqa: BLE001 - livekit absent or import-time failure
        base = object
        capabilities = None
        has_livekit = False

    class QueueAudioOutput(base):  # type: ignore[misc, valid-type]
        """Buffer agent audio frames on an asyncio queue and expose them.

        With livekit present this is an ``io.AudioOutput`` whose ``capture_frame``
        is driven by the AgentSession; without livekit it is a plain async-iterable
        sink. Either way, iterate it to drain the captured frames.
        """

        def __init__(self, label: str = "vexa") -> None:
            if has_livekit:
                super().__init__(label=label, capabilities=capabilities)
            self._queue: asyncio.Queue[AudioFrame | None] = asyncio.Queue()
            # Optional barge-in hook: fired (no args) when the session interrupts
            # the agent and calls clear_buffer(). Consumers (e.g. the web layer)
            # set this to tell their client to stop playing buffered audio.
            self.on_clear = None
            # Playout tracking. Segments play back-to-back (gaplessly) in the client,
            # so we keep a cumulative playout cursor = monotonic time when ALL queued
            # audio finishes — NOT per-segment capture times. Per-segment timing made
            # multi-sentence replies report playback_finished far too early, so the
            # agent "stopped speaking" mid-playback and a new turn overlapped the
            # still-playing audio (the "plays the same audio again" bug).
            self._seg_capturing: bool = False
            self._seg_seconds: float = 0.0
            self._playout_cursor: float = 0.0  # monotonic time all queued audio ends
            self._playout_tasks: set[asyncio.Task] = set()

        async def capture_frame(self, frame) -> None:  # noqa: ANN001 - rtc/AudioFrame or ours
            if has_livekit:
                # base bookkeeping: counts a new playback segment on the first frame
                await super().capture_frame(frame)
            pcm = getattr(frame, "data", None)
            if pcm is not None:
                # livekit rtc.AudioFrame: .data is a memoryview / array of int16.
                pcm_bytes = bytes(pcm)
                sample_rate = getattr(frame, "sample_rate", SAMPLE_RATE) or SAMPLE_RATE
            elif isinstance(frame, AudioFrame):
                pcm_bytes = frame.pcm
                sample_rate = frame.sample_rate or SAMPLE_RATE
            else:
                return
            # accumulate this segment's audio duration (s16le -> samples / rate)
            if not self._seg_capturing:
                self._seg_capturing = True
                self._seg_seconds = 0.0
            self._seg_seconds += (len(pcm_bytes) / 2) / sample_rate
            await self._queue.put(AudioFrame(pcm=pcm_bytes, sample_rate=sample_rate))

        def flush(self) -> None:  # livekit AudioOutput hook; marks a segment boundary
            if has_livekit:
                super().flush()
            if not self._seg_capturing:
                return
            seconds = self._seg_seconds
            self._seg_capturing = False
            self._seg_seconds = 0.0
            if has_livekit:
                # this segment plays AFTER everything already queued (gapless), so it
                # finishes at max(now, cursor) + its duration. Report playback_finished
                # then — matching when the client actually finishes playing it.
                end_play = max(time.monotonic(), self._playout_cursor) + seconds
                self._playout_cursor = end_play
                task = asyncio.create_task(self._report_playout(end_play, seconds))
                self._playout_tasks.add(task)
                task.add_done_callback(self._playout_tasks.discard)

        async def _report_playout(self, end_play: float, seconds: float) -> None:
            remaining = end_play - time.monotonic()
            if remaining > 0:
                await asyncio.sleep(remaining)
            self.on_playback_finished(playback_position=seconds, interrupted=False)

        def clear_buffer(self) -> None:  # livekit AudioOutput hook; barge-in stop
            # Drop buffered-but-unsent audio.
            while True:
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            # Cancel pending playout timers and report every still-pending segment as
            # interrupted, so wait_for_playout() returns and the interruption completes.
            for task in list(self._playout_tasks):
                task.cancel()
            self._playout_tasks.clear()
            self._seg_capturing = False
            self._seg_seconds = 0.0
            self._playout_cursor = time.monotonic()  # nothing queued anymore
            if has_livekit:
                for _ in range(self._pending_playback_count):
                    self.on_playback_finished(playback_position=0.0, interrupted=True)
            # Tell the client (browser) to stop playing already-sent audio.
            if self.on_clear is not None:
                self.on_clear()

        async def aclose(self) -> None:
            for task in list(self._playout_tasks):
                task.cancel()
            self._playout_tasks.clear()
            await self._queue.put(None)

        async def _drain(self) -> AsyncIterator[AudioFrame]:
            while True:
                item = await self._queue.get()
                if item is None:
                    return
                yield item

        def __aiter__(self) -> AsyncIterator[AudioFrame]:
            return self._drain()

    return QueueAudioOutput


QueueAudioOutput = _make_queue_audio_output()
