"""Multiplexer tests: run_multiplexer + MeetingSession seams (no livekit AgentSession).

We patch the heavy pieces (``make_llm/make_stt/make_tts``, ``warmup_llm``, and the
``MeetingSession`` class itself) so these run without building a real LiveKit
session or hitting the network. The REAL machinery under test is:
  * the multiplex TCP server accepting concurrent handshakes,
  * ``_on_session`` tracking sessions in the dict keyed by meeting_id,
  * teardown-on-disconnect removing only the dead session,
  * reconnect rebinding instead of duplicating,
  * ``_resolve_user_id`` querying Supabase by native_meeting_id,
  * the per-session Composio tool build using the resolved user_id.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from stewardai.config import Settings

# ---------------------------------------------------------------------------
# _resolve_user_id — Supabase query keyed by native_meeting_id
# ---------------------------------------------------------------------------


def _mock_supabase(rows: list[dict]) -> MagicMock:
    """A Supabase async client whose meetings query returns ``rows``."""
    from unittest.mock import AsyncMock

    client = MagicMock()
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.order.return_value = chain
    chain.execute = AsyncMock(return_value=MagicMock(data=rows))
    client.table.return_value = chain
    return client


async def test_resolve_user_id_queries_by_native_meeting_id():
    from stewardai.agent.meeting_runner import _resolve_user_id

    client = _mock_supabase(
        [{"user_id": "u-active", "bot_status": "in_meeting", "created_at": "2026-01-02"}]
    )
    uid = await _resolve_user_id(client, "native-abc")
    assert uid == "u-active"
    client.table.assert_called_with("meetings")
    # The native_meeting_id was used as the filter key.
    client.table().eq.assert_any_call("native_meeting_id", "native-abc")


async def test_resolve_user_id_prefers_active_status_row():
    from stewardai.agent.meeting_runner import _resolve_user_id

    # Most-recent row is 'done'; an older row is 'in_meeting' — active wins.
    client = _mock_supabase(
        [
            {"user_id": "u-done", "bot_status": "done", "created_at": "2026-01-03"},
            {"user_id": "u-live", "bot_status": "in_meeting", "created_at": "2026-01-01"},
        ]
    )
    uid = await _resolve_user_id(client, "native-abc")
    assert uid == "u-live"


async def test_resolve_user_id_falls_back_to_any_match():
    from stewardai.agent.meeting_runner import _resolve_user_id

    client = _mock_supabase(
        [{"user_id": "u-only", "bot_status": "done", "created_at": "2026-01-03"}]
    )
    uid = await _resolve_user_id(client, "native-abc")
    assert uid == "u-only"


async def test_resolve_user_id_no_rows_returns_none():
    from stewardai.agent.meeting_runner import _resolve_user_id

    uid = await _resolve_user_id(_mock_supabase([]), "native-abc")
    assert uid is None


async def test_resolve_user_id_no_client_returns_none():
    from stewardai.agent.meeting_runner import _resolve_user_id

    assert await _resolve_user_id(None, "native-abc") is None


# ---------------------------------------------------------------------------
# run_multiplexer with a fake MeetingSession — dict tracking / teardown / reconnect
# ---------------------------------------------------------------------------


class _FakeSession:
    """Records lifecycle; ``wait_until_disconnect`` blocks until the conn EOFs."""

    instances: list = []

    def __init__(self, settings, *, meeting_id, native_meeting_id, user_id, conn, **_kw):  # noqa: ANN001
        self.meeting_id = meeting_id
        self.native_meeting_id = native_meeting_id
        self.user_id = user_id
        self._conn = conn
        self.built = False
        self.started = False
        self.torn_down = False
        _FakeSession.instances.append(self)

    def rebind(self, conn):  # noqa: ANN001
        self._conn = conn

    async def build(self):
        self.built = True

    async def start(self):
        self.started = True

    async def wait_until_disconnect(self):
        # Mirror the real feed task: drain inbound frames until EOF (bot disconnect).
        async for _pcm in self._conn.frames():
            pass

    async def teardown(self):
        self.torn_down = True
        with __import__("contextlib").suppress(Exception):
            await self._conn.aclose()


@pytest.fixture
def patched_multiplexer(monkeypatch):
    """Patch heavy deps + MeetingSession so run_multiplexer runs locally.

    Records the bound server port on ``mr._test_bound_port`` via a spy on
    ``MultiplexFrameServer.start`` so tests can dial the ephemeral (port-0) port.
    """
    import stewardai.agent.meeting_runner as mr
    import stewardai.bridge.transport as transport
    import stewardai.factory as factory
    import stewardai.llm.warmup as warmup

    _FakeSession.instances = []
    monkeypatch.setattr(mr, "MeetingSession", _FakeSession)
    monkeypatch.setattr(factory, "make_llm", lambda s=None: MagicMock(name="llm"))
    monkeypatch.setattr(factory, "make_stt", lambda s=None: MagicMock(name="stt"))
    monkeypatch.setattr(factory, "make_tts", lambda s=None: MagicMock(name="tts"))

    async def _noop_warmup(llm, *, quiet: bool = False):  # noqa: ANN001
        return None

    monkeypatch.setattr(warmup, "warmup_llm", _noop_warmup)

    # Spy on start() to publish the actual bound port back to the test.
    ports: list[int] = []
    _orig_start = transport.MultiplexFrameServer.start

    async def _spy_start(self):  # noqa: ANN001
        await _orig_start(self)
        ports.append(self.port)

    monkeypatch.setattr(transport.MultiplexFrameServer, "start", _spy_start)
    mr._test_ports = ports  # type: ignore[attr-defined]
    return mr


async def _run_mux(mr) -> tuple[asyncio.Task, int]:
    """Start run_multiplexer on an ephemeral port; return (task, bound_port)."""
    task = asyncio.create_task(mr.run_multiplexer(_settings()))

    async def _poll_port():
        while not mr._test_ports:  # type: ignore[attr-defined]
            await asyncio.sleep(0.01)

    await asyncio.wait_for(_poll_port(), timeout=2.0)
    return task, mr._test_ports[-1]  # type: ignore[attr-defined]


async def _connect(port: int, timeout: float = 2.0):
    """Open a loopback connection, retrying until the listener is accepting."""
    async def _dial():
        while True:
            try:
                return await asyncio.open_connection("127.0.0.1", port)
            except (ConnectionRefusedError, OSError):
                await asyncio.sleep(0.01)

    return await asyncio.wait_for(_dial(), timeout=timeout)


def _settings() -> Settings:
    # No Supabase / Composio configured -> user_id resolves to None, no tools.
    # Port 0 -> ephemeral; the spy reports the real bound port.
    return Settings(
        bridge_tcp_host="127.0.0.1",
        bridge_tcp_port=0,
        llm_keepalive_s=0.0,
        composio_api_key=None,
        supabase_url=None,
        supabase_service_role_key=None,
    )


async def _wait(cond, timeout: float = 2.0) -> None:
    async def _poll():
        while not cond():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(_poll(), timeout)


async def test_two_handshakes_two_sessions_in_dict(patched_multiplexer):
    mr = patched_multiplexer
    task, port = await _run_mux(mr)
    try:
        # Two long-lived connections (send handshake, then hold the socket open).
        r1, w1 = await _connect(port)
        r2, w2 = await _connect(port)
        from stewardai.bridge.transport import _handshake_bytes

        w1.write(_handshake_bytes(1, "native-1"))
        w2.write(_handshake_bytes(2, "native-2"))
        await w1.drain()
        await w2.drain()

        await _wait(lambda: len(_FakeSession.instances) == 2)
        mids = {i.meeting_id for i in _FakeSession.instances}
        assert mids == {1, 2}
        assert all(i.built and i.started for i in _FakeSession.instances)

        # EOF on ONE connection tears down only that session.
        w1.close()
        with __import__("contextlib").suppress(Exception):
            await w1.wait_closed()
        s1 = next(i for i in _FakeSession.instances if i.meeting_id == 1)
        s2 = next(i for i in _FakeSession.instances if i.meeting_id == 2)
        await _wait(lambda: s1.torn_down)
        assert s1.torn_down is True
        assert s2.torn_down is False  # the other session is untouched

        w2.close()
        with __import__("contextlib").suppress(Exception):
            await w2.wait_closed()
    finally:
        task.cancel()
        with __import__("contextlib").suppress(asyncio.CancelledError):
            await task


async def test_reconnect_rebinds_instead_of_duplicating(patched_multiplexer):
    mr = patched_multiplexer
    task, port = await _run_mux(mr)
    try:
        from stewardai.bridge.transport import _handshake_bytes

        r1, w1 = await _connect(port)
        w1.write(_handshake_bytes(5, "native-5"))
        await w1.drain()
        await _wait(lambda: len(_FakeSession.instances) >= 1)

        # Same meeting_id reconnects on a NEW socket -> old torn down, new built.
        r2, w2 = await _connect(port)
        w2.write(_handshake_bytes(5, "native-5"))
        await w2.drain()
        await _wait(lambda: len(_FakeSession.instances) == 2)

        first, second = _FakeSession.instances[0], _FakeSession.instances[1]
        assert first.meeting_id == second.meeting_id == 5
        # The reconnect path tore down the first session (no duplicate live pair).
        await _wait(lambda: first.torn_down)
        assert first.torn_down is True
        assert second.torn_down is False

        w2.close()
        with __import__("contextlib").suppress(Exception):
            await w2.wait_closed()
    finally:
        task.cancel()
        with __import__("contextlib").suppress(asyncio.CancelledError):
            await task


# ---------------------------------------------------------------------------
# Per-session tool build uses the resolved user_id (missing user_id -> no tools)
# ---------------------------------------------------------------------------


async def test_session_build_passes_resolved_user_id_into_tool_build(monkeypatch):
    """MeetingSession.build() calls build_live_tool_functions with the resolved user_id."""
    import stewardai.agent.assembly as assembly
    import stewardai.agent.live_tools as live_tools
    from stewardai.agent.meeting_runner import MeetingSession

    captured: dict = {}

    def _fake_build_live_tools(user_id, meeting_id, composio, writer):  # noqa: ANN001
        captured["user_id"] = user_id
        captured["meeting_id"] = meeting_id
        return ["tool-a", "tool-b"]

    fake_session = MagicMock(name="session")
    fake_session.input = MagicMock()
    fake_session.output = MagicMock()

    def _fake_build_session(*_a, **_k):
        return fake_session

    def _fake_build_agent(*_a, **_k):
        return MagicMock(name="agent")

    # audio_input._build_push_audio_input() -> factory returning a PushAudioInput.
    import stewardai.bridge.audio_input as audio_input

    monkeypatch.setattr(assembly, "build_session", _fake_build_session)
    monkeypatch.setattr(assembly, "build_meeting_agent", _fake_build_agent)
    monkeypatch.setattr(
        live_tools, "build_live_tool_functions", _fake_build_live_tools
    )
    monkeypatch.setattr(
        audio_input, "_build_push_audio_input", lambda: (lambda: MagicMock())
    )
    # QueueAudioOutput is imported inside build(); a MagicMock instance is fine.
    import stewardai.bridge.audio_output as audio_output

    monkeypatch.setattr(audio_output, "QueueAudioOutput", lambda label="": MagicMock())

    conn = MagicMock()
    s = Settings(composio_api_key="ck", redis_url="redis://localhost:6379")
    session = MeetingSession(
        s,
        meeting_id=11,
        native_meeting_id="native-11",
        user_id="u-42",
        conn=conn,
        stt_backend=MagicMock(),
        llm_backend=MagicMock(),
        tts_backend=MagicMock(),
        composio_service=MagicMock(),
        supabase_client=MagicMock(),
    )
    await session.build()
    assert captured["user_id"] == "u-42"
    assert captured["meeting_id"] == "11"


async def test_session_build_without_user_id_skips_tools(monkeypatch):
    """No user_id -> build_live_tool_functions is never called (session still builds)."""
    import stewardai.agent.assembly as assembly
    import stewardai.agent.live_tools as live_tools
    import stewardai.bridge.audio_input as audio_input
    import stewardai.bridge.audio_output as audio_output
    from stewardai.agent.meeting_runner import MeetingSession

    called = {"n": 0}

    def _fake_build_live_tools(*_a, **_k):
        called["n"] += 1
        return []

    fake_session = MagicMock(name="session")
    fake_session.input = MagicMock()
    fake_session.output = MagicMock()
    monkeypatch.setattr(assembly, "build_session", lambda *_a, **_k: fake_session)
    monkeypatch.setattr(assembly, "build_meeting_agent", lambda *_a, **_k: MagicMock())
    monkeypatch.setattr(live_tools, "build_live_tool_functions", _fake_build_live_tools)
    monkeypatch.setattr(
        audio_input, "_build_push_audio_input", lambda: (lambda: MagicMock())
    )
    monkeypatch.setattr(audio_output, "QueueAudioOutput", lambda label="": MagicMock())

    s = Settings(composio_api_key="ck", redis_url="redis://localhost:6379")
    session = MeetingSession(
        s,
        meeting_id=12,
        native_meeting_id="native-12",
        user_id=None,  # <- no owner resolved
        conn=MagicMock(),
        stt_backend=MagicMock(),
        llm_backend=MagicMock(),
        tts_backend=MagicMock(),
        composio_service=MagicMock(),
        supabase_client=MagicMock(),
    )
    await session.build()
    assert called["n"] == 0  # tools skipped entirely
    assert session._session is fake_session  # session still built
