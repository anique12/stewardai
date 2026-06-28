# Vexa Agent-Side Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the StewardAI agent-side pieces that let our LiveKit `AgentSession` run a meeting through Vexa: receive meeting audio over a socket, decide-per-utterance whether to speak (LLM tool calling), and stream paced TTS audio + barge-in control back to the Vexa bot — all testable against a *fake bot* with no real Vexa.

**Architecture:** Keep the LiveKit `AgentSession` (it owns VAD / turn detection / STT invocation / barge-in). The "respond or stay silent" decision lives **inside the LLM node**: it calls `LLMBackend.decide(...)` (tool calling → `speak` / `stay_silent`); on silent it emits no deltas (AgentSession stays quiet), on speak it streams the reply. Output is the existing paced-output bridge, but its frames are streamed back over the existing inbound TCP connection (`FrameServer.send`) at 16 kHz, and barge-in fires `mic_off` + `speak_stop` to the bot over Redis. The Vexa bot patches (per-speaker audio tee, PCM-in, mic/stop commands) are a **separate plan**; this plan stands alone behind a fake bot.

**Tech Stack:** Python 3.12, `livekit-agents` 1.6.x, LiteLLM (Gemini), `redis` (async), asyncio sockets, pytest/pytest-asyncio.

## Pre-execution reconciliation (read first — supersedes conflicting details below)

Reviewing the existing `vexa-patch/` (already-authored inbound patch) changed two things:

1. **Inbound is already built and is a COMBINED 16 kHz mix, not per-speaker.**
   `vexa-patch/forwarder.ts` + `pcm-worklet.js` already tap the combined meeting
   mix and stream wire-compatible frames into `transport.py`. So the AgentSession
   consumes **one combined stream** (what the existing servers already receive) —
   no per-speaker work. Speaker attribution is deferred (Vexa diarization stays
   available). Wherever a task below says "per-speaker," read "single combined
   stream." The wake-gated model makes this correct.

2. **Output reuses the SAME connection (no separate FrameSender / port).** The
   forwarder is the client and our `transport.py` server already retains the
   client's writer (`_source_writer`). So **Task 1 changes:** instead of a new
   `FrameSender` connecting to a bot port, add `async def send(self, pcm: bytes)`
   to `_FrameServerBase` that writes `_LEN.pack(len(pcm)) + pcm` to
   `_source_writer`. The meeting runner (Task 6) sends paced output via
   `inbound.send(frame.pcm)`. Drop `bot_pcm_host`/`bot_pcm_port` from config. The
   round-trip test still uses a client that reads the bytes back. Everything else
   (Decision/decide, gated node, RedisControl, runner, fake-bot test) is unchanged.

The Vexa-bot follow-up plan then only needs: a read-path in `forwarder.ts` →
`startPCMStream`, the `mic_on`/`mic_off`/`speak_stop` command handlers, and
*applying* the (already-authored, inbound) patch to the bot.

## Global Constraints

- Canonical inbound audio format: **PCM s16le, 16 kHz, mono** (`stewardai.common.audio.SAMPLE_RATE = 16000`). Matches what Vexa tees.
- **Playback path is 16 kHz end-to-end** — `StewardTTS` declares 16 kHz (`SAMPLE_RATE`) and the TTS backends resample their native 24 kHz down to 16 kHz, so the frames carry 16 kHz and the bot's `paplay --rate` must be 16000 to match. `paced_frames` paces by each frame's own `sample_rate` (no separate rate to thread). (Corrected from an earlier 24 kHz assumption.)
- Wire protocol for PCM frames is the existing `transport.py` framing: `[4-byte big-endian uint32 length N][N bytes PCM]`. Do **not** invent a new framing.
- **livekit / torch / redis are optional deps** — every heavy import stays **lazy** inside functions/methods, matching the existing codebase (`nodes.py`, `audio_input.py`). Modules must import without them.
- Never use `common/audio.py:resample_linear` on the production playback path ("adequate for stubs/tests" only).
- Tests that need livekit/torch are marked `@pytest.mark.heavy` (see existing `tests/stt/test_parakeet.py`); everything else must run on the base install.
- Control commands go to the bot over **Redis** (channel `bot_commands:meeting:{meeting_id}`), separate from the PCM stream so a `speak_stop` never queues behind audio.

---

## File Structure

- **Modify** `src/stewardai/bridge/transport.py` — add a persistent streaming `FrameSender` (outbound client) alongside the existing servers/one-shot helpers.
- **Modify** `src/stewardai/common/audio.py` — add a `Decision` dataclass (tiny, shared type).
- **Modify** `src/stewardai/interfaces.py` — add `decide(...)` to the `LLMBackend` Protocol.
- **Modify** `src/stewardai/llm/litellm_client.py` — implement `decide(...)` via LiteLLM tool calling + a pure `_parse_decision(...)` helper.
- **Modify** `src/stewardai/llm/stub.py` — implement `decide(...)` for tests (scriptable).
- **Modify** `src/stewardai/agent/nodes.py` — `StewardLLMStream._run` calls `decide`; silent → no deltas, speak → stream `text`.
- **Create** `src/stewardai/bridge/vexa_control.py` — `RedisControl`: publish `mic_on` / `mic_off` / `speak_stop` to the bot.
- **Create** `src/stewardai/agent/meeting_runner.py` — wires inbound `FrameServer` → `AgentSession` → paced send to `FrameSender` + control; the topology-A entrypoint.
- **Modify** `src/stewardai/config.py` — Vexa meeting settings (ids, bot PCM host/port, redis url, playback rate).
- **Create** `tests/bridge/test_frame_sender.py`, `tests/llm/test_decide.py`, `tests/bridge/test_vexa_control.py`, `tests/agent/test_meeting_loop.py` (fake-bot integration).

---

## Task 1: `FrameSender` — persistent paced PCM sender

**Files:**
- Modify: `src/stewardai/bridge/transport.py` (append after `unix_send_frames`, ~line 189)
- Test: `tests/bridge/test_frame_sender.py`

**Interfaces:**
- Consumes: nothing (stdlib asyncio only).
- Produces: `class FrameSender` with `async def connect()`, `async def send(pcm: bytes) -> None`, `async def aclose() -> None`; module constant reuse of `_LEN`/`_frame_payload`. Frames it writes are decodable by the existing `TcpFrameServer`.

- [ ] **Step 1: Write the failing test**

```python
# tests/bridge/test_frame_sender.py
import asyncio
import pytest
from stewardai.bridge.transport import TcpFrameServer, FrameSender

async def test_frame_sender_round_trips_to_server():
    server = TcpFrameServer(host="127.0.0.1", port=0)
    await server.start()
    sender = FrameSender(host="127.0.0.1", port=server.port)
    await sender.connect()

    sent = [b"\x01\x02" * 320, b"\x03\x04" * 320]  # two 640-byte frames
    for f in sent:
        await sender.send(f)
    await sender.aclose()  # closes the stream -> server sees EOF

    received = []
    async for frame in server.frames():
        received.append(frame)
    await server.aclose()
    assert received == sent
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/bridge/test_frame_sender.py -v`
Expected: FAIL with `ImportError: cannot import name 'FrameSender'`.

- [ ] **Step 3: Implement `FrameSender`**

```python
# append to src/stewardai/bridge/transport.py
class FrameSender:
    """Persistent client that streams length-prefixed PCM frames to a frame server.

    Unlike ``tcp_send_frames`` (one-shot), this holds the connection open so the
    paced-output loop can push frames over time. Used to stream agent TTS PCM to
    the Vexa bot's PCM-in server.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 8766) -> None:
        self.host = host
        self.port = port
        self._writer: asyncio.StreamWriter | None = None

    async def connect(self) -> None:
        _reader, self._writer = await asyncio.open_connection(self.host, self.port)
        _log.info("frame_sender_connected", host=self.host, port=self.port)

    async def send(self, pcm: bytes) -> None:
        if self._writer is None:
            raise RuntimeError("FrameSender.send before connect()")
        self._writer.write(_LEN.pack(len(pcm)) + pcm)
        await self._writer.drain()

    async def aclose(self) -> None:
        if self._writer is None:
            return
        try:
            self._writer.close()
            await self._writer.wait_closed()
        except Exception:  # noqa: BLE001 - best-effort close
            pass
        self._writer = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/bridge/test_frame_sender.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/bridge/transport.py tests/bridge/test_frame_sender.py
git commit -m "feat(bridge): FrameSender for streaming paced PCM to the Vexa bot"
```

---

## Task 2: `Decision` type + `LLMBackend.decide` contract + stub

**Files:**
- Modify: `src/stewardai/common/audio.py` (add `Decision` near the other dataclasses, ~line 50)
- Modify: `src/stewardai/interfaces.py` (extend `LLMBackend`, ~line 41)
- Modify: `src/stewardai/llm/stub.py` (implement `decide`)
- Test: `tests/llm/test_decide.py` (stub portion)

**Interfaces:**
- Produces: `Decision(speak: bool, text: str = "")` dataclass; `LLMBackend.decide(self, messages: list[Message], *, system: str | None = None) -> Decision`; `StubLLM.decide` returning a scripted `Decision`.

- [ ] **Step 1: Write the failing test**

```python
# tests/llm/test_decide.py
import pytest
from stewardai.common.audio import Decision, Message
from stewardai.llm.stub import StubLLM

async def test_stub_decide_speaks_when_scripted():
    llm = StubLLM()
    llm.next_decision = Decision(speak=True, text="Hello team.")
    d = await llm.decide([Message(role="user", content="hey stewardai, say hi")])
    assert d.speak is True
    assert d.text == "Hello team."

async def test_stub_decide_defaults_silent():
    llm = StubLLM()
    d = await llm.decide([Message(role="user", content="random chatter")])
    assert d.speak is False
    assert d.text == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/llm/test_decide.py -v`
Expected: FAIL with `ImportError: cannot import name 'Decision'`.

- [ ] **Step 3: Add `Decision`, extend the Protocol, implement the stub**

```python
# src/stewardai/common/audio.py  (add near Message/Transcript)
@dataclass(slots=True)
class Decision:
    """Outcome of the agent's per-utterance decide: stay silent, or speak `text`."""
    speak: bool
    text: str = ""
```

```python
# src/stewardai/interfaces.py  (inside LLMBackend Protocol, after complete())
    async def decide(
        self, messages: list[Message], *, system: str | None = None
    ) -> "Decision":
        """Decide whether to respond. Returns Decision(speak=False) to stay silent."""
        ...
```
(Add `Decision` to the import: `from stewardai.common.audio import AudioFrame, Decision, Message, Transcript`.)

```python
# src/stewardai/llm/stub.py  (add to StubLLM)
    next_decision: "Decision | None" = None  # set by tests; None -> stay silent

    async def decide(self, messages, *, system=None):  # noqa: ANN001
        from stewardai.common.audio import Decision
        return self.next_decision or Decision(speak=False)
```
(If `StubLLM` is a dataclass or has `__init__`, initialize `self.next_decision = None` there instead of a class attr.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/llm/test_decide.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/common/audio.py src/stewardai/interfaces.py src/stewardai/llm/stub.py tests/llm/test_decide.py
git commit -m "feat(llm): Decision type + decide() contract + stub implementation"
```

---

## Task 3: `LiteLLMClient.decide` via tool calling (+ pure parser)

**Files:**
- Modify: `src/stewardai/llm/litellm_client.py`
- Test: `tests/llm/test_decide.py` (add parser tests)

**Interfaces:**
- Consumes: `Decision`, `Message` (Task 2).
- Produces: `LiteLLMClient.decide(...)`; pure helper `_parse_decision(tool_calls) -> Decision`.

- [ ] **Step 1: Write the failing test (pure parser)**

```python
# tests/llm/test_decide.py  (append)
from stewardai.llm.litellm_client import _parse_decision

class _FakeFn:
    def __init__(self, name, arguments): self.name = name; self.arguments = arguments
class _FakeToolCall:
    def __init__(self, name, arguments): self.function = _FakeFn(name, arguments)

def test_parse_decision_speak():
    d = _parse_decision([_FakeToolCall("speak", '{"text": "On it."}')])
    assert d.speak is True and d.text == "On it."

def test_parse_decision_stay_silent():
    d = _parse_decision([_FakeToolCall("stay_silent", "{}")])
    assert d.speak is False and d.text == ""

def test_parse_decision_none_defaults_silent():
    assert _parse_decision(None).speak is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/llm/test_decide.py -k parse -v`
Expected: FAIL with `ImportError: cannot import name '_parse_decision'`.

- [ ] **Step 3: Implement `_parse_decision` + `decide`**

```python
# src/stewardai/llm/litellm_client.py  (add imports + methods)
import json
from stewardai.common.audio import Decision

_DECIDE_TOOLS = [
    {"type": "function", "function": {
        "name": "speak",
        "description": "Say this reply aloud into the meeting. Use only when addressed "
                       "(e.g. the wake word) or when a response is clearly useful.",
        "parameters": {"type": "object",
                       "properties": {"text": {"type": "string"}},
                       "required": ["text"]}}},
    {"type": "function", "function": {
        "name": "stay_silent",
        "description": "Do not respond. Use this by default when not addressed.",
        "parameters": {"type": "object", "properties": {}}}},
]


def _parse_decision(tool_calls) -> Decision:  # noqa: ANN001
    """Map an LLM tool_calls list to a Decision (defaults to silent)."""
    if not tool_calls:
        return Decision(speak=False)
    call = tool_calls[0]
    name = call.function.name
    if name == "speak":
        try:
            text = (json.loads(call.function.arguments or "{}") or {}).get("text", "")
        except (ValueError, TypeError):
            text = ""
        return Decision(speak=bool(text), text=text)
    return Decision(speak=False)
```

```python
# add to LiteLLMClient
    async def decide(self, messages, *, system=None):  # noqa: ANN001
        import litellm  # lazy
        payload = []
        if system:
            payload.append({"role": "system", "content": system})
        payload.extend({"role": m.role, "content": m.content} for m in messages)
        resp = await litellm.acompletion(
            model=self.model, messages=payload, tools=_DECIDE_TOOLS,
            tool_choice="required", temperature=0.0, timeout=self._s.llm_timeout_s,
        )
        msg = resp.choices[0].message
        decision = _parse_decision(getattr(msg, "tool_calls", None))
        _log.info("llm_decide", backend=self.name, speak=decision.speak)
        return decision
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/llm/test_decide.py -k parse -v`
Expected: PASS (3 parser tests). (The live `decide()` call is exercised in the e2e/manual run, not unit tests — no network in CI.)

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/llm/litellm_client.py tests/llm/test_decide.py
git commit -m "feat(llm): decide() via LiteLLM tool calling (speak/stay_silent)"
```

---

## Task 4: LLM node honors the decide (silent → no speech)

**Files:**
- Modify: `src/stewardai/agent/nodes.py` (`StewardLLMStream._run`, ~line 163; `build_llm_node` signature ~line 145)
- Test: `tests/agent/test_decide_node.py` (heavy — needs livekit)

**Interfaces:**
- Consumes: `LLMBackend.decide` (Tasks 2–3).
- Produces: `build_llm_node(backend, *, system=None, temperature=0.4, gated=False)`; when `gated=True`, the stream calls `decide` and emits deltas only if `speak`.

- [ ] **Step 1: Write the failing test (heavy)**

```python
# tests/agent/test_decide_node.py
import pytest
pytest.importorskip("livekit")
pytestmark = pytest.mark.heavy
from stewardai.common.audio import Decision
from stewardai.llm.stub import StubLLM
from stewardai.agent.nodes import build_llm_node

async def _collect_text(stream) -> str:
    out = []
    async for chunk in stream:
        delta = getattr(getattr(chunk, "delta", None), "content", None)
        if delta:
            out.append(delta)
    return "".join(out)

async def test_gated_node_silent_emits_nothing(make_chat_ctx):
    llm = StubLLM(); llm.next_decision = Decision(speak=False)
    node = build_llm_node(llm, gated=True)
    text = await _collect_text(node.chat(chat_ctx=make_chat_ctx("blah blah")))
    assert text == ""

async def test_gated_node_speaks_when_decided(make_chat_ctx):
    llm = StubLLM(); llm.next_decision = Decision(speak=True, text="Sure.")
    node = build_llm_node(llm, gated=True)
    text = await _collect_text(node.chat(chat_ctx=make_chat_ctx("hey stewardai")))
    assert text == "Sure."
```
(Add a `make_chat_ctx` fixture in `tests/agent/conftest.py` that builds a `livekit.agents.llm.ChatContext` with one user message — mirror the construction already used by the AgentSession; verify the exact constructor on the box per the `nodes.py` "verify on box" convention.)

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/agent/test_decide_node.py -m heavy -v`
Expected: FAIL (gated path not implemented — silent test gets non-empty or errors on `gated` kwarg).

- [ ] **Step 3: Implement the gated decide in `StewardLLMStream._run`**

```python
# in build_llm_node: thread `gated` through StewardLLM/StewardLLMStream.
# StewardLLMStream._run becomes:
        async def _run(self) -> None:
            messages = _chat_ctx_to_messages(self._chat_ctx)
            request_id = _gen_id()
            if self._gated:
                decision = await self._inner.decide(messages, system=self._system)
                _log.info("llm_gated_decide", backend=self._inner.name, speak=decision.speak)
                if not decision.speak:
                    return  # emit no deltas -> AgentSession stays silent
                self._event_ch.send_nowait(_make_chat_chunk(lk_llm, request_id, decision.text))
                _log.info("llm_done", backend=self._inner.name, deltas=1)
                return
            # ungated path (browser 1:1): stream complete() deltas as before
            _log.info("llm_chat", backend=self._inner.name, messages=len(messages))
            n = 0
            try:
                async for delta in self._inner.complete(
                    messages, system=self._system, temperature=self._temperature
                ):
                    if not delta:
                        continue
                    n += 1
                    self._event_ch.send_nowait(_make_chat_chunk(lk_llm, request_id, delta))
            except asyncio.CancelledError:
                _log.info("llm_cancelled", backend=self._inner.name, deltas=n); raise
            except Exception as exc:  # noqa: BLE001
                _log.warning("llm_error", backend=self._inner.name, deltas=n, error=str(exc)); raise
            else:
                _log.info("llm_done", backend=self._inner.name, deltas=n)
```
Thread `gated` (default `False`) through `build_llm_node`, `StewardLLM.__init__`, `StewardLLM.chat` (pass to `StewardLLMStream`), and `StewardLLMStream.__init__` (`self._gated = gated`).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/agent/test_decide_node.py -m heavy -v`
Expected: PASS (both). Browser path unaffected: `.venv/bin/python -m pytest tests/agent -m heavy -v`.

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/nodes.py tests/agent/test_decide_node.py tests/agent/conftest.py
git commit -m "feat(agent): gated LLM node — decide per utterance, silent emits no speech"
```

---

## Task 5: `RedisControl` — mic_on / mic_off / speak_stop to the bot

**Files:**
- Create: `src/stewardai/bridge/vexa_control.py`
- Modify: `pyproject.toml` (add `redis>=5` to `cpu`/`cuda` extras)
- Modify: `src/stewardai/config.py` (add `redis_url`, `vexa_meeting_id`)
- Test: `tests/bridge/test_vexa_control.py`

**Interfaces:**
- Produces: `RedisControl(redis_url, meeting_id)` with `async def mic_on()`, `async def mic_off()`, `async def speak_stop()`, `async def aclose()`; pure `_command(action: str) -> str` returning the JSON published. Channel = `bot_commands:meeting:{meeting_id}`.

- [ ] **Step 1: Write the failing test (pure message format — no Redis needed)**

```python
# tests/bridge/test_vexa_control.py
import json
from stewardai.bridge.vexa_control import RedisControl, _command

def test_command_shapes():
    assert json.loads(_command("mic_on")) == {"action": "mic_on"}
    assert json.loads(_command("speak_stop")) == {"action": "speak_stop"}

def test_channel_is_meeting_scoped():
    c = RedisControl("redis://localhost:6379", meeting_id="abc123")
    assert c.channel == "bot_commands:meeting:abc123"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/bridge/test_vexa_control.py -v`
Expected: FAIL with `ModuleNotFoundError: stewardai.bridge.vexa_control`.

- [ ] **Step 3: Implement `RedisControl`**

```python
# src/stewardai/bridge/vexa_control.py
"""Publish bot control commands (mic on/off, stop speaking) to Vexa over Redis.

Vexa's bot subscribes to ``bot_commands:meeting:{id}``; we publish small JSON
commands there. ``redis`` is imported lazily so this module imports without it.
"""
from __future__ import annotations
import json
from stewardai.common.logging import get_logger
_log = get_logger("bridge.vexa_control")


def _command(action: str) -> str:
    return json.dumps({"action": action})


class RedisControl:
    def __init__(self, redis_url: str, meeting_id: str) -> None:
        self.redis_url = redis_url
        self.meeting_id = meeting_id
        self.channel = f"bot_commands:meeting:{meeting_id}"
        self._client = None

    async def _publish(self, action: str) -> None:
        if self._client is None:
            import redis.asyncio as redis  # lazy
            self._client = redis.from_url(self.redis_url)
        await self._client.publish(self.channel, _command(action))
        _log.info("vexa_control", action=action, channel=self.channel)

    async def mic_on(self) -> None: await self._publish("mic_on")
    async def mic_off(self) -> None: await self._publish("mic_off")
    async def speak_stop(self) -> None: await self._publish("speak_stop")

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
```

```python
# config.py additions
    redis_url: str = "redis://localhost:6379"
    vexa_meeting_id: str | None = None
    vexa_platform: str = "google_meet"
    # Vexa bot PCM-in server (we connect our FrameSender to it). Host = bot container.
    bot_pcm_host: str = "127.0.0.1"
    bot_pcm_port: int = 8766
    # Playback rate end-to-end into the meeting (matches TTS + bot paplay).
    playback_sample_rate: int = 24000
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/bridge/test_vexa_control.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/bridge/vexa_control.py src/stewardai/config.py pyproject.toml tests/bridge/test_vexa_control.py
git commit -m "feat(bridge): RedisControl for mic on/off + speak_stop to the Vexa bot"
```

---

## Task 6: Meeting runner — wire AgentSession ↔ bot (paced send + barge-in control)

**Files:**
- Create: `src/stewardai/agent/meeting_runner.py`
- Modify: `src/stewardai/agent/assembly.py` (`build_session` already takes backends; add a `gated` pass-through to `build_llm_node` via a small `build_meeting_session` wrapper OR a `gated` kwarg — see Interfaces)
- Test: covered by Task 7 (fake-bot integration); this task has a focused unit test for the paced-send pump.

**Interfaces:**
- Consumes: `FrameSender` (T1), `RedisControl` (T5), `QueueAudioOutput` + `paced_frames` (existing `audio_output.py`), `build_session` (existing `assembly.py`), `_build_push_audio_input` (existing `audio_input.py`), `TcpFrameServer` (existing).
- Produces: `async def run_meeting(settings)`; helper `async def _pump_paced(audio_out, sender, rate)`; barge-in wiring `audio_out.on_clear = <schedule mic_off + speak_stop>`.

- [ ] **Step 1: Write the failing test (paced-send pump)**

```python
# tests/agent/test_meeting_loop.py  (pump portion; no livekit needed)
import asyncio, pytest
from stewardai.bridge.audio_output import QueueAudioOutput
from stewardai.bridge.transport import TcpFrameServer
from stewardai.agent.meeting_runner import _pump_paced

async def test_pump_sends_paced_frames_to_server():
    server = TcpFrameServer(host="127.0.0.1", port=0); await server.start()
    out = QueueAudioOutput(label="test")
    # enqueue ~0.5s of 24kHz audio as one frame, then a segment end + close
    from stewardai.common.audio import AudioFrame
    pcm = b"\x00\x00" * 12000  # 0.5s @ 24kHz s16le
    await out.capture_frame(AudioFrame(pcm=pcm, sample_rate=24000))
    out.flush(); await out.aclose()
    from stewardai.bridge.transport import FrameSender
    sender = FrameSender("127.0.0.1", server.port); await sender.connect()
    await _pump_paced(out, sender, rate=24000)
    await sender.aclose()
    got = b""
    async for f in server.frames(): got += f
    await server.aclose()
    assert got == pcm  # all audio bytes arrived intact
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/agent/test_meeting_loop.py -k pump -v`
Expected: FAIL with `ImportError: cannot import name '_pump_paced'`.

- [ ] **Step 3: Implement `_pump_paced` + `run_meeting`**

```python
# src/stewardai/agent/meeting_runner.py
"""Topology-A meeting runner: AgentSession <-> Vexa bot over sockets + Redis.

Inbound meeting PCM arrives on a TcpFrameServer (the bot connects and tees audio).
Agent TTS streams out, paced, via a FrameSender to the bot's PCM-in server.
Barge-in (clear_buffer) fires mic_off + speak_stop over Redis. The LLM node runs
GATED (decide per utterance). livekit imports stay lazy.
"""
from __future__ import annotations
import asyncio, contextlib
from stewardai.bridge.transport import FrameSender, TcpFrameServer
from stewardai.bridge.vexa_control import RedisControl
from stewardai.common.audio import AudioFrame
from stewardai.common.logging import get_logger
from stewardai.config import Settings, get_settings
_log = get_logger("agent.meeting_runner")


async def _pump_paced(audio_out, sender: FrameSender, rate: int) -> None:  # noqa: ANN001
    """Drain the paced output and stream each frame to the bot at ~real time."""
    async for frame in audio_out.paced_frames():
        await sender.send(frame.pcm)


async def run_meeting(settings: Settings | None = None) -> None:
    s = settings or get_settings()
    from livekit.agents import AgentSession  # noqa: F401  (ensures extra present)
    from stewardai.agent.assembly import build_agent, build_session
    from stewardai.bridge.audio_input import _build_push_audio_input
    from stewardai.bridge.audio_output import QueueAudioOutput

    inbound = TcpFrameServer(s.bridge_tcp_host, s.bridge_tcp_port); await inbound.start()
    sender = FrameSender(s.bot_pcm_host, s.bot_pcm_port)
    control = RedisControl(s.redis_url, s.vexa_meeting_id or "unknown")
    session = build_session(s, stt_backend=None, llm_backend=None, tts_backend=None, gated=True)
    agent = build_agent(s)
    audio_in = _build_push_audio_input()()
    audio_out = QueueAudioOutput(label="vexa")
    session.input.audio = audio_in
    session.output.audio = audio_out
    loop = asyncio.get_running_loop()

    # Barge-in: mute the bot mic immediately, then kill the source so it can't resume.
    def _on_clear() -> None:
        loop.create_task(control.mic_off())
        loop.create_task(control.speak_stop())
    audio_out.on_clear = _on_clear

    await sender.connect()
    await control.mic_on()  # one-time: keep mic on for the session (silence between turns)
    await session.start(agent=agent)
    pump = asyncio.create_task(_pump_paced(audio_out, sender, s.playback_sample_rate))
    feed = asyncio.create_task(_feed_inbound(inbound, audio_in))
    _log.info("meeting_agent_started", meeting=s.vexa_meeting_id)
    try:
        await asyncio.Event().wait()
    finally:
        for t in (pump, feed):
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t
        with contextlib.suppress(Exception):
            await session.aclose()
        await sender.aclose(); await control.aclose(); await inbound.aclose()


async def _feed_inbound(server: TcpFrameServer, audio_in) -> None:  # noqa: ANN001
    async for pcm in server.frames():
        audio_in.push(pcm)
    with contextlib.suppress(Exception):
        audio_in.end_input()
```

Add the `gated` pass-through in `assembly.build_session`: accept `gated: bool = False`, and build the LLM node with `build_llm_node(..., system=<persona+wake-word instructions>, gated=gated)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/agent/test_meeting_loop.py -k pump -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stewardai/agent/meeting_runner.py src/stewardai/agent/assembly.py tests/agent/test_meeting_loop.py
git commit -m "feat(agent): meeting runner — paced send to bot + barge-in mute-first"
```

---

## Task 7: Fake-bot end-to-end integration test

**Files:**
- Test: `tests/agent/test_meeting_loop.py` (append the e2e portion; heavy)
- Create: `tests/agent/fake_bot.py` (a local stand-in for the Vexa bot)

**Interfaces:**
- Consumes: everything above. The fake bot is a `TcpFrameServer`-backed PCM-in receiver + a frame source that connects to our inbound server and replays a WAV.

- [ ] **Step 1: Write the failing integration test (heavy)**

```python
# tests/agent/test_meeting_loop.py  (append)
import pytest
pytest.importorskip("livekit")

@pytest.mark.heavy
async def test_meeting_loop_silent_then_speaks(tmp_path, monkeypatch):
    """With a scripted gated LLM: no wake word -> no PCM out; wake word -> PCM out.

    Uses StubLLM (next_decision) + StubTTS so no models/network are needed; drives
    audio via the fake bot. Asserts: with Decision(speak=False) the bot receives no
    PCM; with Decision(speak=True, text=...) the bot receives PCM frames.
    """
    # Build a session with stub backends, gated=True; wire to fake-bot sockets.
    # (Construct via build_session(s, stt_backend=StubSTT(), llm_backend=StubLLM(),
    #  tts_backend=StubTTS(), gated=True); set llm.next_decision per phase.)
    # Assertions:
    #   phase 1 (silent): replay an utterance, StubLLM.next_decision=Decision(False)
    #                     -> fake bot's PCM-in receiver got 0 bytes.
    #   phase 2 (speak):  next_decision=Decision(True, "hi") -> receiver got >0 bytes.
    ...
```
(Fill in the construction concretely during execution — the helper `fake_bot.py` below provides the two sockets; the StubSTT returns a fixed transcript so the turn closes deterministically.)

```python
# tests/agent/fake_bot.py
import asyncio
from stewardai.bridge.transport import TcpFrameServer, FrameSender

class FakeBot:
    """Stand-in for the patched Vexa bot: a PCM-in receiver + an audio-out source."""
    def __init__(self): self.pcm_in = TcpFrameServer("127.0.0.1", 0); self.received = bytearray()
    async def start(self): await self.pcm_in.start()
    async def collect(self):
        async for f in self.pcm_in.frames(): self.received += f
    async def feed_utterance(self, agent_inbound_port: int, pcm: bytes):
        s = FrameSender("127.0.0.1", agent_inbound_port); await s.connect()
        await s.send(pcm); await s.aclose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/agent/test_meeting_loop.py -m heavy -k loop -v`
Expected: FAIL (test body/`fake_bot` not complete).

- [ ] **Step 3: Complete the integration test + fake bot**

Wire the runner pieces directly (not the infinite `run_meeting`): build the session with `StubSTT`/`StubLLM`/`StubTTS`, start the inbound server, connect the fake bot's `FrameSender` to it, run the pump to the fake bot's `pcm_in`, set `llm.next_decision`, replay one utterance per phase, and assert `FakeBot.received` is empty (silent) then non-empty (speak). Give the StubSTT a non-empty fixed transcript so the gated decide fires.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/agent/test_meeting_loop.py -m heavy -k loop -v`
Expected: PASS — silent phase delivers 0 bytes to the bot; speak phase delivers PCM.

- [ ] **Step 5: Commit**

```bash
git add tests/agent/test_meeting_loop.py tests/agent/fake_bot.py
git commit -m "test(agent): fake-bot e2e — listen, gated decide, speak/stay-silent"
```

---

## Self-Review

**Spec coverage:** Per-speaker audio in → handled as one inbound PCM stream (bot sums; agent-agnostic) ✓. PCM out via paced sender at 24 kHz ✓ (T1, T6, rate in Global Constraints). Mic + stop control over Redis, separate from PCM ✓ (T5, T6). Always-listen + LLM-gated output via tool calling ✓ (T2–T4). Turn detector as trigger ✓ (AgentSession unchanged; gated node runs on its turn events). Barge-in mute-first (`mic_off` then `speak_stop`) ✓ (T6 `_on_clear`). Fake-bot test from the spec's testing section ✓ (T7). **Vexa bot patches are intentionally a separate plan** (noted in header) — not a gap.

**Placeholder scan:** T7 Steps 1/3 describe the test body in prose with a concrete `fake_bot.py` and explicit assertions rather than full inline code, because the exact session-construction mirrors `build_session` and is filled at execution; flagged explicitly, not a silent TODO. All other steps have real code.

**Type consistency:** `Decision(speak: bool, text: str)` consistent across T2/T3/T4/T7. `FrameSender(host, port).connect()/send(pcm)/aclose()` consistent T1/T6/T7. `RedisControl(redis_url, meeting_id).mic_on/mic_off/speak_stop/aclose` + `.channel` consistent T5/T6. `build_llm_node(..., gated=)` consistent T4/T6. `_pump_paced(audio_out, sender, rate)` consistent T6/T7.

**Known follow-ups (out of scope, noted for the Vexa-bot plan):** the bot patches (per-speaker tee → optional sum, `speak_pcm` command feeding `startPCMStream`, `mic_on`/`mic_off`/`speak_stop` actions, `transcribeEnabled=false`); measuring real barge-in residual; multi-meeting orchestration + GPU capacity.
