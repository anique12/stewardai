"""TcpFrameServer / UnixFrameServer round-trip tests (no heavy deps)."""

from __future__ import annotations

import asyncio
import os
import socket
import tempfile
import uuid

import pytest

from stewardai.bridge.transport import (
    TcpFrameServer,
    UnixFrameServer,
    tcp_send_frames,
    unix_send_frames,
)


async def _collect(server, n: int, timeout: float = 2.0) -> list[bytes]:
    out: list[bytes] = []
    gen = server.frames()
    for _ in range(n):
        out.append(await asyncio.wait_for(gen.__anext__(), timeout=timeout))
    return out


async def test_tcp_round_trips_three_frames():
    frames = [b"\x01\x02" * 320, b"\x03\x04" * 320, b"\x05\x06" * 320]  # 3 x 640B
    server = TcpFrameServer("127.0.0.1", 0)  # ephemeral port
    await server.start()
    try:
        await tcp_send_frames("127.0.0.1", server.port, frames)
        got = await _collect(server, 3)
        assert got == frames
        assert all(len(f) == 640 for f in got)
    finally:
        await server.aclose()


async def test_tcp_handles_partial_and_varied_lengths():
    # Mixed sizes; the receiver must not assume N == 640.
    frames = [b"\xaa" * 10, b"\xbb" * 640, b"\xcc" * 1300]
    server = TcpFrameServer("127.0.0.1", 0)
    await server.start()
    try:
        await tcp_send_frames("127.0.0.1", server.port, frames)
        got = await _collect(server, 3)
        assert got == frames
    finally:
        await server.aclose()


async def test_unix_round_trips_frames():
    # AF_UNIX paths are length-limited (~104 chars on macOS), so use a short
    # name in the system temp dir rather than a deep pytest tmp_path.
    path = os.path.join(tempfile.gettempdir(), f"sa_{uuid.uuid4().hex[:8]}.sock")
    if len(path) >= 104:
        pytest.skip("temp dir path too long for AF_UNIX socket")
    frames = [b"\x11\x22" * 320, b"\x33\x44" * 320]
    server = UnixFrameServer(path)
    await server.start()
    try:
        assert socket.AF_UNIX  # platform supports unix sockets
        await unix_send_frames(path, frames)
        got = await _collect(server, 2)
        assert got == frames
    finally:
        await server.aclose()
