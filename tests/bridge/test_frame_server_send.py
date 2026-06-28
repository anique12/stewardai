"""Tests for _FrameServerBase.send() — full-duplex reply to the connected client.

The reconciled Task 1 approach: instead of a standalone FrameSender class that
dials OUT to a bot port, the existing TcpFrameServer (which retains the connected
client's writer in _source_writer) gains a send() method so the server can write
length-prefixed PCM frames back to the very same client that is streaming inbound.
"""

from __future__ import annotations

import asyncio
import struct

from stewardai.bridge.transport import TcpFrameServer

_LEN = struct.Struct(">I")


async def _read_frame(reader: asyncio.StreamReader) -> bytes:
    """Read one length-prefixed frame from reader."""
    header = await asyncio.wait_for(reader.readexactly(4), timeout=2.0)
    (n,) = _LEN.unpack(header)
    return await asyncio.wait_for(reader.readexactly(n), timeout=2.0)


async def test_send_returns_frames_to_connected_client():
    """send() writes length-prefixed PCM back to the source client (full-duplex)."""
    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()
    try:
        # Connect a raw client (this is what the Vexa forwarder does).
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        try:
            # Give the server a beat to register the connection (_on_client fires).
            await asyncio.sleep(0.05)

            frame1 = b"\x01\x02" * 320  # 640 bytes
            frame2 = b"\x03\x04" * 320  # 640 bytes

            await server.send(frame1)
            await server.send(frame2)

            # Read both frames back on the client side.
            got1 = await _read_frame(reader)
            got2 = await _read_frame(reader)

            assert got1 == frame1
            assert got2 == frame2
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
    finally:
        await server.aclose()


async def test_send_before_client_is_safe_noop():
    """send() before any client connects must not raise — frames are silently dropped."""
    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()
    try:
        # No client has connected yet.
        await server.send(b"\x00" * 640)  # must not raise
    finally:
        await server.aclose()


async def test_send_after_client_disconnect_is_safe_noop():
    """If the client disconnects, send() must not raise and later sends are no-ops."""
    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        # Let the server register the connection (_on_client stores the writer).
        await asyncio.sleep(0.05)

        # Client goes away (mirrors a forwarder crash / TCP RST).
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(0.05)

        # First send may hit the broken writer; it must NOT raise and must drop
        # the client, so the second send is a clean no-op.
        await server.send(b"\x00" * 640)
        await server.send(b"\x00" * 640)
    finally:
        await server.aclose()


async def test_send_drops_client_when_writer_errors():
    """A writer that raises on drain() must be swallowed and the client dropped.

    Loopback writes can be buffered, so a real disconnect doesn't deterministically
    surface the error on the next send. This injects a writer whose drain() raises
    to prove send() catches it, does not propagate, and resets _source_writer so
    later sends are no-ops (re-enabling the safe path for the TTS output loop).
    """

    class _BrokenWriter:
        def write(self, _data: bytes) -> None:  # accepts bytes, like StreamWriter
            pass

        async def drain(self) -> None:
            raise ConnectionResetError("peer reset")

    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()
    try:
        # Simulate a registered-but-now-broken source connection.
        server._source_writer = _BrokenWriter()  # type: ignore[assignment]

        await server.send(b"\x00" * 640)  # must NOT raise
        assert server._source_writer is None  # client dropped on error
        await server.send(b"\x00" * 640)  # now a clean no-op
    finally:
        await server.aclose()
