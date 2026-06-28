"""Unit test for the paced-send pump in meeting_runner.

No livekit needed: just TcpFrameServer + QueueAudioOutput + AudioFrame.
"""

from __future__ import annotations

import asyncio
import struct

import pytest

from stewardai.bridge.audio_output import QueueAudioOutput
from stewardai.bridge.transport import TcpFrameServer
from stewardai.common.audio import AudioFrame
from stewardai.agent.meeting_runner import _pump_paced

_LEN = struct.Struct(">I")


async def _wait_connected(server, timeout=2.0):
    async def _poll():
        while server._source_writer is None:
            await asyncio.sleep(0.01)
    await asyncio.wait_for(_poll(), timeout)


@pytest.mark.asyncio
async def test_pump_sends_paced_frames_to_server():
    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()
    out = QueueAudioOutput(label="test")
    pcm = b"\x00\x00" * 12000  # 0.5s @ 24kHz s16le
    await out.capture_frame(AudioFrame(pcm=pcm, sample_rate=24000))
    out.flush()
    await out.aclose()

    # Connect a raw TCP client that will READ back what the server sends
    reader, writer = await asyncio.open_connection("127.0.0.1", server.port)

    # Wait for server to register our connection before pumping
    await _wait_connected(server)

    await asyncio.wait_for(_pump_paced(out, server), timeout=5)

    # Read length-prefixed frames back on the client side
    got = b""
    while True:
        try:
            header = await asyncio.wait_for(reader.readexactly(4), timeout=1.0)
            (n,) = _LEN.unpack(header)
            payload = await asyncio.wait_for(reader.readexactly(n), timeout=1.0)
            got += payload
        except (asyncio.TimeoutError, asyncio.IncompleteReadError):
            break

    writer.close()
    await writer.wait_closed()
    await server.aclose()

    assert got == pcm
