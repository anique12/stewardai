"""Length-prefixed frame transport (TCP and Unix socket).

Two wire protocols live here:

1. **Legacy single-stream framing** (``_FrameServerBase`` / ``TcpFrameServer`` /
   ``UnixFrameServer``): each frame is ``[4-byte big-endian uint32 length N][N
   bytes s16le PCM]``. First client wins; extras are dropped. Still used by
   ``SocketAudioBridge`` (the roomless web ``/pipeline`` path).

2. **Multiplexing type-tagged framing** (``MultiplexFrameServer`` +
   ``MeetingConnection``): every frame is ``[4-byte BE uint32 L][L-byte
   payload]`` where ``payload[0]`` is a TYPE byte and ``payload[1:]`` is the
   data. Types: ``0x00`` = s16le PCM audio, ``0x01`` = handshake JSON. The bot
   sends a handshake (``{"meeting_id": <int>, "native_meeting_id": <str>,
   "v": 1}``) as the FIRST frame of each connection; the server then invokes an
   injected ``on_session`` callback with a per-connection ``MeetingConnection``.
   MANY connections are accepted concurrently — one independent session each.
   Outbound agent→bot TTS is sent as ``0x00`` PCM frames on the same socket.

These servers are intentionally LIGHT — only the stdlib ``asyncio`` is used, so
they import without livekit / torch / numpy.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import struct
from collections.abc import AsyncIterator, Awaitable, Callable

from stewardai.common.logging import get_logger

_log = get_logger("bridge.transport")

_LEN = struct.Struct(">I")  # 4-byte big-endian uint32
_MAX_FRAME = 1 << 20  # 1 MiB guard against a desynced/garbage length prefix

# Type-tagged multiplexing protocol: payload[0] is one of these.
TYPE_PCM = 0x00  # payload[1:] = s16le PCM audio
TYPE_HANDSHAKE = 0x01  # payload[1:] = UTF-8 JSON handshake
HANDSHAKE_VERSION = 1


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
        try:
            self._source_writer.write(_LEN.pack(len(pcm)) + pcm)
            await self._source_writer.drain()
        except (ConnectionError, OSError) as exc:
            # Forwarder crashed / half-closed: drop the client so later sends
            # fall back to the no-op path and never crash the TTS output loop.
            _log.warning("send_error_dropping_client", error=str(exc))
            self._source_writer = None

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


# ===========================================================================
# Multiplexing type-tagged transport (Stage 1: agent side).
#
# One process, one listen port, N concurrent bot connections. Every frame is
# ``[4-byte BE uint32 L][type byte][data]``. The bot sends a handshake (type
# 0x01) as its first frame; the server parses it and hands the caller a
# per-connection ``MeetingConnection``.
# ===========================================================================


def _pack_typed(type_byte: int, data: bytes) -> bytes:
    """Frame ``data`` with a leading ``type_byte`` under the length prefix."""
    payload = bytes((type_byte,)) + data
    return _LEN.pack(len(payload)) + payload


async def _read_typed_frames_into(
    reader: asyncio.StreamReader, queue: asyncio.Queue[bytes | None]
) -> None:
    """Decode type-tagged PCM frames from ``reader`` into ``queue`` until EOF.

    Only ``TYPE_PCM`` payloads are enqueued (as raw PCM bytes); other types after
    the handshake are logged and ignored. Terminates the queue with ``None`` on
    EOF so consumers stop.
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
            type_byte = payload[0]
            if type_byte == TYPE_PCM:
                await queue.put(payload[1:])
            else:
                # A stray handshake or unknown type mid-stream: ignore, don't die.
                _log.debug("unexpected_frame_type", type=type_byte)
    except asyncio.IncompleteReadError:
        pass  # clean EOF / truncated final frame
    except (ConnectionError, OSError) as exc:
        _log.warning("transport_read_error", error=str(exc))
    finally:
        await queue.put(None)


async def _read_first_frame(reader: asyncio.StreamReader) -> tuple[int, bytes] | None:
    """Read one type-tagged frame; return ``(type_byte, data)`` or ``None`` on EOF/error."""
    try:
        header = await reader.readexactly(4)
        (n,) = _LEN.unpack(header)
        if n == 0 or n > _MAX_FRAME:
            return None
        payload = await reader.readexactly(n)
        return payload[0], payload[1:]
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        return None


def _parse_handshake(data: bytes) -> tuple[int, str] | None:
    """Parse a handshake JSON payload into ``(meeting_id, native_meeting_id)``.

    Returns ``None`` if the payload is not valid JSON or is missing a numeric
    ``meeting_id`` (native id falls back to ``str(meeting_id)`` when absent).
    """
    try:
        obj = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(obj, dict):
        return None
    meeting_id = obj.get("meeting_id")
    if not isinstance(meeting_id, int) or isinstance(meeting_id, bool):
        return None
    native = obj.get("native_meeting_id")
    native_meeting_id = str(native) if native is not None else str(meeting_id)
    return meeting_id, native_meeting_id


class MeetingConnection:
    """One accepted bot connection, scoped to a single meeting.

    Exposes an async ``frames()`` iterator yielding inbound PCM bytes (type
    ``0x00``) and a ``send(pcm)`` that writes outbound ``0x00`` PCM frames on the
    same socket. Mirrors the legacy server's read loop (a per-connection queue
    terminated with ``None`` on EOF) but per-connection instead of process-global.
    """

    def __init__(
        self,
        meeting_id: int,
        native_meeting_id: str,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        self.meeting_id = meeting_id
        self.native_meeting_id = native_meeting_id
        self._reader = reader
        self._writer: asyncio.StreamWriter | None = writer
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._reader_task: asyncio.Task[None] = asyncio.create_task(
            _read_typed_frames_into(reader, self._queue)
        )
        self._closed = False

    async def frames(self) -> AsyncIterator[bytes]:
        """Yield each inbound PCM frame (type ``0x00``) until the connection ends."""
        while True:
            item = await self._queue.get()
            if item is None:
                return
            yield item

    async def send(self, pcm: bytes) -> None:
        """Send outbound PCM as a ``0x00`` type-tagged frame back to the bot.

        No-op (debug log) if the connection has been closed/dropped — a broken
        writer must never crash the TTS output loop.
        """
        if self._writer is None:
            _log.debug("send_dropped_no_writer", bytes=len(pcm))
            return
        try:
            self._writer.write(_pack_typed(TYPE_PCM, pcm))
            await self._writer.drain()
        except (ConnectionError, OSError) as exc:
            _log.warning("send_error_dropping_writer", error=str(exc))
            self._writer = None

    async def aclose(self) -> None:
        """Cancel the reader, close the socket, and unblock any ``frames()`` consumer."""
        if self._closed:
            return
        self._closed = True
        self._reader_task.cancel()
        try:
            await self._reader_task
        except asyncio.CancelledError:
            pass
        if self._writer is not None:
            try:
                self._writer.close()
            except Exception:  # noqa: BLE001
                pass
            self._writer = None
        await self._queue.put(None)


# on_session(meeting_id, native_meeting_id, connection) -> awaitable
OnSession = Callable[[int, str, MeetingConnection], Awaitable[None]]


class _MultiplexServerBase:
    """Accept MANY connections; hand each a ``MeetingConnection`` after handshake.

    No shared ``_have_source`` — every accepted socket is independent. The first
    frame on each socket must be a valid handshake (``TYPE_HANDSHAKE``); a bad or
    missing handshake closes THAT socket and logs, without killing the server.
    """

    def __init__(self, on_session: OnSession) -> None:
        self._on_session = on_session
        self._server: asyncio.AbstractServer | None = None
        self._closed = False
        self._conn_tasks: set[asyncio.Task[None]] = set()

    def _on_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        task = asyncio.create_task(self._handle_client(reader, writer))
        self._conn_tasks.add(task)
        task.add_done_callback(self._conn_tasks.discard)

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        peer = writer.get_extra_info("peername") or writer.get_extra_info("sockname")
        first = await _read_first_frame(reader)
        if first is None or first[0] != TYPE_HANDSHAKE:
            _log.warning("handshake_missing_or_bad", peer=str(peer))
            with contextlib.suppress(Exception):
                writer.close()
            return
        parsed = _parse_handshake(first[1])
        if parsed is None:
            _log.warning("handshake_parse_failed", peer=str(peer))
            with contextlib.suppress(Exception):
                writer.close()
            return
        meeting_id, native_meeting_id = parsed
        _log.info(
            "session_handshake",
            peer=str(peer),
            meeting_id=meeting_id,
            native_meeting_id=native_meeting_id,
        )
        conn = MeetingConnection(meeting_id, native_meeting_id, reader, writer)
        try:
            await self._on_session(meeting_id, native_meeting_id, conn)
        except Exception as exc:  # noqa: BLE001 - one bad session must not kill others
            _log.warning("on_session_failed", meeting_id=meeting_id, error=str(exc))
            with contextlib.suppress(Exception):
                await conn.aclose()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        for task in list(self._conn_tasks):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if self._server is not None:
            self._server.close()
            try:
                await asyncio.wait_for(self._server.wait_closed(), timeout=1.0)
            except Exception:  # noqa: BLE001 - best-effort shutdown (incl. timeout)
                pass


class MultiplexFrameServer(_MultiplexServerBase):
    """Accept type-tagged multiplexed connections over TCP."""

    def __init__(
        self, on_session: OnSession, host: str = "127.0.0.1", port: int = 8765
    ) -> None:
        super().__init__(on_session)
        self.host = host
        self.port = port

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._on_client, self.host, self.port)
        sock = self._server.sockets[0]
        self.port = sock.getsockname()[1]  # capture actual port if 0 was requested
        _log.info("multiplex_tcp_listening", host=self.host, port=self.port)


class UnixMultiplexFrameServer(_MultiplexServerBase):
    """Accept type-tagged multiplexed connections over a Unix domain socket."""

    def __init__(self, on_session: OnSession, path: str = "/tmp/stewardai.sock") -> None:
        super().__init__(on_session)
        self.path = path

    async def start(self) -> None:
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        except OSError as exc:
            _log.warning("unix_unlink_failed", path=self.path, error=str(exc))
        self._server = await asyncio.start_unix_server(self._on_client, self.path)
        _log.info("multiplex_unix_listening", path=self.path)

    async def aclose(self) -> None:
        await super().aclose()
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass
        except OSError:
            pass


# Test helpers: dial in, send a handshake + typed frames.


def _handshake_bytes(meeting_id: int, native_meeting_id: str) -> bytes:
    data = json.dumps(
        {
            "meeting_id": meeting_id,
            "native_meeting_id": native_meeting_id,
            "v": HANDSHAKE_VERSION,
        }
    ).encode("utf-8")
    return _pack_typed(TYPE_HANDSHAKE, data)


async def tcp_send_session(
    host: str,
    port: int,
    meeting_id: int,
    native_meeting_id: str,
    pcm_frames: list[bytes],
) -> None:
    """Connect, send a handshake then PCM frames over the multiplex protocol (test helper)."""
    reader, writer = await asyncio.open_connection(host, port)
    try:
        writer.write(_handshake_bytes(meeting_id, native_meeting_id))
        for pcm in pcm_frames:
            writer.write(_pack_typed(TYPE_PCM, pcm))
        await writer.drain()
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
