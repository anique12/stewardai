"""Component contracts. Application code depends only on these Protocols;
concrete backends (stub or real) are chosen by the factory from config.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from stewardai.common.audio import AudioFrame, Decision, Message, Transcript


@runtime_checkable
class STTBackend(Protocol):
    name: str

    async def transcribe(
        self, pcm: bytes, *, sample_rate: int = 16_000, lang: str = "en"
    ) -> Transcript:
        """Transcribe a finalized utterance buffer (batch-behind-VAD)."""
        ...

    async def aclose(self) -> None: ...


@runtime_checkable
class TTSBackend(Protocol):
    name: str

    @property
    def voices(self) -> list[str]: ...

    def synthesize(self, text: str, *, voice: str | None = None) -> AsyncIterator[AudioFrame]:
        """Stream 16 kHz mono PCM frames for `text`."""
        ...

    async def aclose(self) -> None: ...


@runtime_checkable
class LLMBackend(Protocol):
    name: str

    def complete(
        self, messages: list[Message], *, system: str | None = None, temperature: float = 0.4
    ) -> AsyncIterator[str]:
        """Stream response token deltas."""
        ...

    async def decide(
        self, messages: list[Message], *, system: str | None = None
    ) -> Decision:
        """Decide whether to respond. Returns Decision(speak=False) to stay silent."""
        ...

    async def aclose(self) -> None: ...


@runtime_checkable
class AudioBridge(Protocol):
    def inbound(self) -> AsyncIterator[AudioFrame]:
        """Yield inbound meeting audio frames."""
        ...

    async def play(self, frames: AsyncIterator[AudioFrame]) -> None:
        """Play agent audio back into the meeting."""
        ...

    async def aclose(self) -> None: ...
