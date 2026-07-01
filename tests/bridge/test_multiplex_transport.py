"""MultiplexFrameServer / MeetingConnection tests (type-tagged, no heavy deps).

Covers the NEW wire protocol: ``[4-byte BE uint32 L][type byte][data]`` where
type ``0x01`` is a handshake JSON frame and ``0x00`` is s16le PCM. The server
accepts MANY concurrent connections; each valid handshake triggers ``on_session``.
"""

from __future__ import annotations

import asyncio
import json
import struct

from stewardai.bridge.transport import (
    TYPE_HANDSHAKE,
    TYPE_PCM,
    MultiplexFrameServer,
    tcp_send_session,
)

_LEN = struct.Struct(">I")


def _pack(type_byte: int, data: bytes) -> bytes:
    payload = bytes((type_byte,)) + data
    return _LEN.pack(len(payload)) + payload


async def _read_frame(reader: asyncio.StreamReader, timeout: float = 2.0) -> tuple[int, bytes]:
    header = await asyncio.wait_for(reader.readexactly(4), timeout=timeout)
    (n,) = _LEN.unpack(header)
    payload = await asyncio.wait_for(reader.readexactly(n), timeout=timeout)
    return payload[0], payload[1:]


async def test_handshake_triggers_on_session_with_parsed_ids():
    """A valid handshake first-frame invokes on_session with meeting_id + native id."""
    seen: list[tuple[int, str]] = []
    done = asyncio.Event()

    async def on_session(meeting_id, native_meeting_id, conn):  # noqa: ANN001
        seen.append((meeting_id, native_meeting_id))
        done.set()
        # Consume frames so the connection lifecycle completes cleanly.
        async for _pcm in conn.frames():
            pass

    server = MultiplexFrameServer(on_session, "127.0.0.1", 0)
    await server.start()
    try:
        await tcp_send_session("127.0.0.1", server.port, 42, "abc-xyz-123", [])
        await asyncio.wait_for(done.wait(), timeout=2.0)
        assert seen == [(42, "abc-xyz-123")]
    finally:
        await server.aclose()


async def test_pcm_frame_round_trip_inbound_and_outbound():
    """PCM frames flow inbound via conn.frames() and outbound via conn.send()."""
    got_inbound: list[bytes] = []
    ready = asyncio.Event()

    async def on_session(meeting_id, native_meeting_id, conn):  # noqa: ANN001
        # Send one outbound PCM frame back to the bot.
        await conn.send(b"\xab\xcd" * 320)
        async for pcm in conn.frames():
            got_inbound.append(pcm)
        ready.set()

    server = MultiplexFrameServer(on_session, "127.0.0.1", 0)
    await server.start()
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        # Handshake first.
        writer.write(
            _pack(TYPE_HANDSHAKE, json.dumps({"meeting_id": 7, "v": 1}).encode())
        )
        # Two inbound PCM frames.
        in1 = b"\x01\x02" * 320
        in2 = b"\x03\x04" * 320
        writer.write(_pack(TYPE_PCM, in1))
        writer.write(_pack(TYPE_PCM, in2))
        await writer.drain()

        # Read the outbound frame the server sent us.
        out_type, out_pcm = await _read_frame(reader)
        assert out_type == TYPE_PCM
        assert out_pcm == b"\xab\xcd" * 320

        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        await asyncio.wait_for(ready.wait(), timeout=2.0)
        assert got_inbound == [in1, in2]
    finally:
        await server.aclose()


async def test_bad_first_frame_closes_socket_without_killing_server():
    """A non-handshake first frame closes that socket; the server keeps serving."""
    calls: list[int] = []
    good_seen = asyncio.Event()

    async def on_session(meeting_id, native_meeting_id, conn):  # noqa: ANN001
        calls.append(meeting_id)
        good_seen.set()
        async for _pcm in conn.frames():
            pass

    server = MultiplexFrameServer(on_session, "127.0.0.1", 0)
    await server.start()
    try:
        # First (bad) connection: send a PCM frame as the FIRST frame (no handshake).
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        writer.write(_pack(TYPE_PCM, b"\x00" * 640))
        await writer.drain()
        # The server should close this socket; on_session must NOT fire for it.
        await asyncio.sleep(0.1)
        assert calls == []
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass

        # Second (good) connection still works — server survived the bad one.
        await tcp_send_session("127.0.0.1", server.port, 99, "native-99", [])
        await asyncio.wait_for(good_seen.wait(), timeout=2.0)
        assert calls == [99]
    finally:
        await server.aclose()


async def test_bad_json_handshake_closes_socket():
    """A handshake-typed frame with invalid JSON closes that socket, no on_session."""
    calls: list[int] = []

    async def on_session(meeting_id, native_meeting_id, conn):  # noqa: ANN001
        calls.append(meeting_id)

    server = MultiplexFrameServer(on_session, "127.0.0.1", 0)
    await server.start()
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
        writer.write(_pack(TYPE_HANDSHAKE, b"not json at all"))
        await writer.drain()
        await asyncio.sleep(0.1)
        assert calls == []
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
    finally:
        await server.aclose()


async def test_two_concurrent_connections_both_reach_on_session():
    """No shared _have_source: two simultaneous handshakes both invoke on_session."""
    seen: set[int] = set()
    both = asyncio.Event()

    async def on_session(meeting_id, native_meeting_id, conn):  # noqa: ANN001
        seen.add(meeting_id)
        if len(seen) == 2:
            both.set()
        async for _pcm in conn.frames():
            pass

    server = MultiplexFrameServer(on_session, "127.0.0.1", 0)
    await server.start()
    try:
        await asyncio.gather(
            tcp_send_session("127.0.0.1", server.port, 1, "n-1", []),
            tcp_send_session("127.0.0.1", server.port, 2, "n-2", []),
        )
        await asyncio.wait_for(both.wait(), timeout=2.0)
        assert seen == {1, 2}
    finally:
        await server.aclose()
