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

        async def capture_frame(self, frame) -> None:  # noqa: ANN001 - rtc/AudioFrame or ours
            # We are the terminal sink: buffer the frame rather than chaining.
            pcm = getattr(frame, "data", None)
            if pcm is not None:
                # livekit rtc.AudioFrame: .data is a memoryview / array of int16.
                pcm_bytes = bytes(pcm)
                sample_rate = getattr(frame, "sample_rate", SAMPLE_RATE)
                await self._queue.put(AudioFrame(pcm=pcm_bytes, sample_rate=sample_rate))
            elif isinstance(frame, AudioFrame):
                await self._queue.put(frame)

        def flush(self) -> None:  # livekit AudioOutput hook; segment boundary, no-op
            return None

        def clear_buffer(self) -> None:  # livekit AudioOutput hook; barge-in stop
            # Drop any agent audio buffered but not yet drained, then notify.
            while True:
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            if self.on_clear is not None:
                self.on_clear()

        async def aclose(self) -> None:
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
