"""Length-prefixed PCM frame transport (TCP and Unix socket).

Wire protocol (must match the Vexa forwarder exactly): each frame on the socket
is ``[4-byte big-endian uint32 length N][N bytes s16le PCM]``. N is normally 640
(20 ms @ 16 kHz mono s16le) but the receiver tolerates any N and partial reads.

These servers are intentionally LIGHT — only the stdlib ``asyncio`` is used, so
they import without livekit / torch / numpy. The first connected client is the
audio source; later connections are accepted but ignored (their frames are not
yielded) so a single forwarder owns the stream.
"""

from __future__ import annotations

import asyncio
import os
import struct
from collections.abc import AsyncIterator

from stewardai.common.logging import get_logger

_log = get_logger("bridge.transport")

_LEN = struct.Struct(">I")  # 4-byte big-endian uint32
_MAX_FRAME = 1 << 20  # 1 MiB guard against a desynced/garbage length prefix


async def _read_frames_into(
    reader: asyncio.StreamReader, queue: asyncio.Queue[bytes | None]
) -> None:
    """Decode length-prefixed frames from ``reader`` into ``queue`` until EOF.

    Pushes a sentinel ``None`` when the stream closes so consumers can stop.
    """
    try:
        while True:
            header = await reader.readexactly(4)
            (n,) = _LEN.unpack(header)
            if n == 0:
                continue
            if n > _MAX_FRAME:
                _log.warning("frame_too_large", n=n, max=_MAX_FRAME)
                break
            payload = await reader.readexactly(n)
            await queue.put(payload)
    except asyncio.IncompleteReadError:
        # Clean EOF (or a truncated final frame): treat as end of stream.
        pass
    except (ConnectionError, OSError) as exc:
        _log.warning("transport_read_error", error=str(exc))
    finally:
        await queue.put(None)


class _FrameServerBase:
    """Shared logic: accept one source client, decode frames, expose ``frames()``."""

    def __init__(self) -> None:
        self._server: asyncio.AbstractServer | None = None
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._have_source = False
        self._reader_task: asyncio.Task[None] | None = None
        self._source_writer: asyncio.StreamWriter | None = None
        self._closed = False

    def _on_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        if self._have_source:
            # Only the first client is the audio source; drop extras.
            _log.warning("extra_client_dropped")
            writer.close()
            return
        self._have_source = True
        self._source_writer = writer
        peer = writer.get_extra_info("peername") or writer.get_extra_info("sockname")
        _log.info("client_connected", peer=str(peer))
        self._reader_task = asyncio.create_task(_read_frames_into(reader, self._queue))

    async def frames(self) -> AsyncIterator[bytes]:
        """Yield each decoded PCM frame from the first connected client."""
        while True:
            item = await self._queue.get()
            if item is None:
                return
            yield item

    async def send(self, pcm: bytes) -> None:
        """Send length-prefixed PCM back to the connected source client (full-duplex).

        This is the symmetric counterpart of ``_read_frames_into``: it reuses the
        same ``_source_writer`` that ``_on_client`` stored when the inbound client
        connected, so the same TCP connection carries audio in BOTH directions.

        No-op (with a debug log) if no client is connected yet — the forwarder
        reconnects and pre-connection output is simply dropped rather than raised.
        """
        if self._source_writer is None:
            _log.debug("send_dropped_no_client", bytes=len(pcm))
            return
        self._source_writer.write(_LEN.pack(len(pcm)) + pcm)
        await self._source_writer.drain()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._reader_task is not None:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
        # Close the source connection so the server has no lingering client.
        if self._source_writer is not None:
            try:
                self._source_writer.close()
            except Exception:  # noqa: BLE001
                pass
        if self._server is not None:
            self._server.close()
            try:
                # Bound the wait: a lingering peer half-close must not hang us.
                await asyncio.wait_for(self._server.wait_closed(), timeout=1.0)
            except Exception:  # noqa: BLE001 - best-effort shutdown (incl. timeout)
                pass
        # Unblock any pending frames() consumer.
        await self._queue.put(None)


class TcpFrameServer(_FrameServerBase):
    """Accept length-prefixed PCM frames over TCP."""

    def __init__(self, host: str = "127.0.0.1", port: int = 8765) -> None:
        super().__init__()
        self.host = host
        self.port = port

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._on_client, self.host, self.port)
        # If port 0 was requested, capture the actual bound port.
        sock = self._server.sockets[0]
        self.port = sock.getsockname()[1]
        _log.info("tcp_server_listening", host=self.host, port=self.port)


class UnixFrameServer(_FrameServerBase):
    """Accept length-prefixed PCM frames over a Unix domain socket."""

    def __init__(self, path: str = "/tmp/stewardai.sock") -> None:
        super().__init__()
        self.path = path

    async def start(self) -> None:
        # Remove a stale socket file so bind() does not fail.
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            _log.warning("unix_unlink_failed", path=self.path, error=str(exc))
        self._server = await asyncio.start_unix_server(self._on_client, self.path)
        _log.info("unix_server_listening", path=self.path)

    async def aclose(self) -> None:
        await super().aclose()
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        except OSError:
            pass


def _frame_payload(frames: list[bytes]) -> bytes:
    return b"".join(_LEN.pack(len(f)) + f for f in frames)


async def tcp_send_frames(host: str, port: int, frames: list[bytes]) -> None:
    """Connect to a TCP frame server and send length-prefixed frames (test helper)."""
    reader, writer = await asyncio.open_connection(host, port)
    try:
        writer.write(_frame_payload(frames))
        await writer.drain()
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass


async def unix_send_frames(path: str, frames: list[bytes]) -> None:
    """Connect to a Unix frame server and send length-prefixed frames (test helper)."""
    reader, writer = await asyncio.open_unix_connection(path)
    try:
        writer.write(_frame_payload(frames))
        await writer.drain()
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
