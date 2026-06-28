"""Tests for _FrameServerBase.send() — full-duplex reply to the connected client.

The reconciled Task 1 approach: instead of a standalone FrameSender class that
dials OUT to a bot port, the existing TcpFrameServer (which retains the connected
client's writer in _source_writer) gains a send() method so the server can write
length-prefixed PCM frames back to the very same client that is streaming inbound.
"""

from __future__ import annotations

import asyncio
import struct

import pytest

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
