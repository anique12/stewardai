"""Vexa -> agent audio input + the socket-backed AudioBridge.

``PushAudioInput`` is a LiveKit ``io.AudioInput`` (an ``AsyncIterator`` of
``rtc.AudioFrame``) fed by ``push(pcm)``. ``SocketAudioBridge`` owns a frame
server (TCP or Unix, per settings), yields inbound ``AudioFrame``s from it,
plays agent audio via ``SinkPlayer``, and runs a background task that pumps the
socket frames into ``PushAudioInput`` for the LiveKit AgentSession.

livekit is imported LAZILY — only ``PushAudioInput`` needs it, so the base
install (no livekit) can still construct ``SocketAudioBridge`` and use
``inbound()`` / ``play()``.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from stewardai.bridge.audio_output import SinkPlayer
from stewardai.bridge.transport import TcpFrameServer, UnixFrameServer
from stewardai.common.audio import SAMPLE_RATE, AudioFrame
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings

_log = get_logger("bridge.audio_input")


def _build_push_audio_input():
    """Construct PushAudioInput, subclassing livekit's io.AudioInput.

    Raises ImportError (via the lazy import) if livekit is not installed.
    """
    from livekit import rtc  # type: ignore
    from livekit.agents.utils import aio  # type: ignore
    from livekit.agents.voice import io as lk_io  # type: ignore

    class PushAudioInput(lk_io.AudioInput):  # type: ignore[misc, valid-type]
        """An io.AudioInput backed by an aio.Chan; fed by push()."""

        def __init__(self, label: str = "vexa") -> None:
            super().__init__(label=label)
            self._chan: aio.Chan = aio.Chan()

        def push(self, pcm: bytes, sample_rate: int = SAMPLE_RATE) -> None:
            """Wrap raw s16le PCM as an rtc.AudioFrame and enqueue it."""
            samples = len(pcm) // 2
            frame = rtc.AudioFrame(
                data=pcm,
                sample_rate=sample_rate,
                num_channels=1,
                samples_per_channel=samples,
            )
            self._chan.send_nowait(frame)

        def end_input(self) -> None:
            self._chan.close()

        async def __anext__(self):
            return await self._chan.__anext__()

        def __aiter__(self):
            return self

        async def aclose(self) -> None:
            self._chan.close()

    return PushAudioInput


class SocketAudioBridge:
    """AudioBridge implementation fed by a length-prefixed PCM socket.

    Implements the ``AudioBridge`` protocol: ``inbound()`` yields meeting audio
    frames decoded from the socket; ``play(frames)`` writes agent audio to the
    configured PulseAudio sink (or a fallback WAV on dev boxes). ``.audio_input``
    is a lazily-created ``PushAudioInput`` for the LiveKit AgentSession;
    ``start_pump()`` launches a task that reads the server and pushes into it.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()
        if self._s.bridge_transport == "unix":
            self._server: TcpFrameServer | UnixFrameServer = UnixFrameServer(
                self._s.bridge_socket_path
            )
        else:
            self._server = TcpFrameServer(self._s.bridge_tcp_host, self._s.bridge_tcp_port)
        self._player = SinkPlayer(sink=getattr(self._s, "tts_sink", "tts_sink"))
        self._started = False
        self._audio_input = None  # lazily built (needs livekit)
        self._pump_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if not self._started:
            await self._server.start()
            self._started = True

    @property
    def audio_input(self):
        """The PushAudioInput for the LiveKit AgentSession (lazy, needs livekit)."""
        if self._audio_input is None:
            self._audio_input = _build_push_audio_input()()
        return self._audio_input

    async def inbound(self) -> AsyncIterator[AudioFrame]:
        """Yield inbound meeting audio frames decoded from the socket."""
        await self.start()
        async for pcm in self._server.frames():
            yield AudioFrame(pcm=pcm, sample_rate=SAMPLE_RATE)

    async def play(self, frames: AsyncIterator[AudioFrame]) -> None:
        """Play agent audio back into the meeting via the configured sink."""
        await self._player.play(frames)

    async def start_pump(self) -> None:
        """Read socket frames and push them into the LiveKit audio input."""
        await self.start()
        if self._pump_task is None:
            self._pump_task = asyncio.create_task(self._pump())

    async def _pump(self) -> None:
        audio_input = self.audio_input
        try:
            async for pcm in self._server.frames():
                audio_input.push(pcm, SAMPLE_RATE)
        finally:
            end = getattr(audio_input, "end_input", None)
            if callable(end):
                end()

    async def aclose(self) -> None:
        if self._pump_task is not None:
            self._pump_task.cancel()
            try:
                await self._pump_task
            except asyncio.CancelledError:
                pass
        if self._audio_input is not None:
            await self._audio_input.aclose()
        await self._server.aclose()
