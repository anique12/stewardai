"""Fake Vexa bot for integration tests.

The real Vexa bot connects to the agent's inbound ``TcpFrameServer`` as a TCP
client and uses the SAME connection bidirectionally: it sends meeting PCM
inbound (the agent hears the room) and receives TTS PCM back (the agent
speaks). ``FakeBot`` replicates that client role so tests can drive and observe
the full socket path without a live meeting.
"""

from __future__ import annotations

import asyncio
import struct

_LEN = struct.Struct(">I")  # mirrors TcpFrameServer's wire protocol


class FakeBot:
    """Stand-in for the patched Vexa bot: a TCP client on the agent's frame server.

    Usage::

        bot = FakeBot()
        await bot.connect("127.0.0.1", server_port)
        await bot.send_pcm(pcm_bytes)       # optional: push meeting audio in
        await bot.read_for(seconds=0.5)     # collect TTS PCM sent back by agent
        await bot.aclose()
        assert len(bot.received) > 0        # agent spoke
    """

    def __init__(self) -> None:
        self.received: bytearray = bytearray()
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None

    async def connect(self, host: str, port: int) -> None:
        """Open a TCP connection to the agent's frame server."""
        self._reader, self._writer = await asyncio.open_connection(host, port)

    async def send_pcm(self, pcm: bytes) -> None:
        """Send length-prefixed PCM to the server (simulates inbound meeting audio)."""
        assert self._writer is not None, "call connect() first"
        self._writer.write(_LEN.pack(len(pcm)) + pcm)
        await self._writer.drain()

    async def read_for(self, seconds: float) -> None:
        """Collect any TTS PCM the agent sends back within *seconds*.

        The frames are length-prefixed in the same wire format the server uses
        for ``send()``. Appends raw PCM payload bytes (no headers) to
        ``self.received``.
        """
        assert self._reader is not None, "call connect() first"
        try:
            while True:
                header = await asyncio.wait_for(
                    self._reader.readexactly(4), timeout=seconds
                )
                (n,) = _LEN.unpack(header)
                payload = await asyncio.wait_for(
                    self._reader.readexactly(n), timeout=seconds
                )
                self.received += payload
        except (TimeoutError, asyncio.IncompleteReadError):
            return

    async def aclose(self) -> None:
        """Close the connection."""
        if self._writer is not None:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
            self._writer = None
            self._reader = None
