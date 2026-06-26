# StewardAI Voice Core (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a low-latency cascaded voice agent (STT → LLM → TTS with audio turn detection), orchestrated by LiveKit Agents and fed by a Vexa audio bridge, as four independent components with three test pages, evals, and structured logging.

**Architecture:** Four components (STT, TTS, LLM, Vexa bridge) behind typed `Protocol` interfaces, instantiated by an env-driven `factory`. Every component ships a **`stub` backend** (no heavy deps) plus a **real backend**. Base install runs the full pipeline with stub STT/TTS + **real Gemini LLM** and the test pages — on a laptop, no GPU. Real STT (Parakeet/NeMo) and TTS (Kokoro) live behind a `[cuda]`/`[cpu]` extra and turn on via env. Same Linux code on CPU and GPU; `DEVICE=cpu|cuda` is the only switch.

**Tech Stack:** Python 3.11+, pydantic-settings, structlog, FastAPI + uvicorn (test pages), LiteLLM (LLM, model-by-string), NeMo (Parakeet STT), Kokoro (TTS), ONNX Runtime (Silero VAD + LiveKit turn detector), LiveKit Agents (orchestration), jiwer (WER eval), Docker/compose, Vexa (existing, + thin patch).

## Global Constraints

- **Python:** ≥ 3.11. **Package name:** `stewardai`. **Src layout:** `src/stewardai/`.
- **Language scope:** English-only (Phase 1).
- **Audio format everywhere:** PCM **s16le, 16 kHz, mono**, ~**20 ms** frames (320 samples / 640 bytes).
- **Linux-only runtime**, device-parameterized: `DEVICE=cpu|cuda` selects device; NO MLX/Apple code.
- **Heavy deps are optional extras** (`[cuda]`/`[cpu]`). Base install must run: stub STT/TTS, real LLM (LiteLLM/Gemini), web test pages, evals, all unit tests — with no torch/nemo/kokoro/livekit.
- **Secrets:** reuse `standin`'s `GEMINI_API_KEY` + `GEMINI_MODEL`. `.env` is git-ignored; `.env.example` documents var names only. Never commit or print secret values.
- **LLM:** LiteLLM. Default `LLM_MODEL=gemini/<model>`; switching model = change the env value only.
- **Every component:** typed `Protocol` interface + `stub` backend + real backend, selected by `*_BACKEND` env.
- **Logging:** structured JSON; per-turn correlation id; per-stage timing fields.
- **TDD + frequent commits.** Tests that need heavy models are marked `@pytest.mark.heavy` and skipped unless deps present.

---

## File Structure

```
stewardai/
  pyproject.toml                 # deps + [cpu]/[cuda] extras + tool config
  .env.example                   # documented var names (no secrets)
  .env                           # git-ignored; real keys (created locally)
  docker-compose.yml             # agent + (reference to) Vexa; profiles for cpu/gpu
  Dockerfile                     # agent image (Linux)
  scripts/
    setup.sh                     # install deps (base or extra), pull models
    run-web.sh                   # launch the test-page server
    run-agent.sh                 # launch the LiveKit agent worker
  src/stewardai/
    __init__.py
    config.py                    # Settings (pydantic-settings), env loading
    interfaces.py                # STTBackend / TTSBackend / LLMBackend / AudioBridge Protocols
    factory.py                   # make_stt/make_tts/make_llm/make_bridge (env-driven, lazy)
    common/
      __init__.py
      audio.py                   # AudioFrame, constants, resample/convert helpers, Transcript, Message
      logging.py                 # structured JSON logger, TurnTimer, correlation-id contextvar
      errors.py                  # StewardError hierarchy
    stt/
      __init__.py
      stub.py                    # StubSTT (canned/deterministic)
      parakeet_nemo.py           # real STT (NeMo, batch-behind-VAD, device-param)  [extra]
    tts/
      __init__.py
      stub.py                    # StubTTS (beep/silence frames)
      kokoro.py                  # real TTS (Kokoro, streaming, voices)  [extra]
    llm/
      __init__.py
      stub.py                    # StubLLM (echo/rule-based)
      litellm_client.py          # real LLM (LiteLLM, Gemini default, streaming)
    turn/
      __init__.py
      vad.py                     # Silero VAD wrapper (ONNX) — used by web pipeline  [extra]
      endpointer.py              # silence-based endpointing for the web pipeline (light)
    bridge/
      __init__.py
      transport.py               # UnixSocketTransport / TcpTransport (frame framing)
      audio_input.py             # PushAudioInput(io.AudioInput) + socket reader  [livekit extra]
      audio_output.py            # QueueAudioOutput + tts_sink/speak player
      vexa_client.py             # POST /speak helper + pactl mute helpers
    agent/
      __init__.py
      assembly.py                # LiveKit AgentSession wiring (roomless)  [livekit extra]
      nodes.py                   # custom STT/LLM/TTS LiveKit nodes wrapping our components  [extra]
  web/
    app.py                       # FastAPI app + routes + websockets
    static/                      # index.html, stt.html, tts.html, pipeline.html, app.js, style.css
  evals/
    __init__.py
    datasets/                    # tiny English sample clips + transcripts
    stt_eval.py                  # WER via jiwer + latency
    tts_eval.py                  # TTFA + RTF
    e2e_eval.py                  # voice-to-voice latency, turn metrics (with stubs)
    run.py                       # CLI to run all evals → JSON report
  vexa-patch/
    README.md                    # how to apply the tap to vexa-bot
    zoom_tap.md                  # parecord-stdout frame tap (diff/instructions)
    audioworklet/                # pcm-worklet.js + integration notes (Meet/Teams)
    forwarder.ts                 # Node: normalize → socket emitter
  tests/                         # mirrors src/ ; unit tests (+ @pytest.mark.heavy)
  STATUS.md                      # living handoff: done / validated / next steps
```

---

## Interfaces (locked — every backend matches these exactly)

```python
# common/audio.py
SAMPLE_RATE = 16000
CHANNELS = 1
FRAME_MS = 20
SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000   # 320
BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2              # 640 (s16le)

@dataclass(slots=True)
class AudioFrame:
    pcm: bytes                       # s16le, mono, 16 kHz
    sample_rate: int = SAMPLE_RATE
    @property
    def num_samples(self) -> int: return len(self.pcm) // 2
    @property
    def duration_ms(self) -> float: return 1000 * self.num_samples / self.sample_rate

@dataclass(slots=True)
class Transcript:
    text: str
    is_final: bool = True
    confidence: float | None = None
    t_start_ms: float | None = None
    t_end_ms: float | None = None

@dataclass(slots=True)
class Message:
    role: str                        # "system" | "user" | "assistant"
    content: str

# interfaces.py
class STTBackend(Protocol):
    name: str
    async def transcribe(self, pcm: bytes, *, sample_rate: int = 16000, lang: str = "en") -> Transcript: ...
    async def aclose(self) -> None: ...

class TTSBackend(Protocol):
    name: str
    @property
    def voices(self) -> list[str]: ...
    def synthesize(self, text: str, *, voice: str | None = None) -> AsyncIterator[AudioFrame]: ...
    async def aclose(self) -> None: ...

class LLMBackend(Protocol):
    name: str
    def complete(self, messages: list[Message], *, system: str | None = None,
                 temperature: float = 0.4) -> AsyncIterator[str]: ...
    async def aclose(self) -> None: ...

class AudioBridge(Protocol):
    def inbound(self) -> AsyncIterator[AudioFrame]: ...
    async def play(self, frames: AsyncIterator[AudioFrame]) -> None: ...
    async def aclose(self) -> None: ...
```

`config.Settings` (pydantic-settings, reads `.env`): `device: Literal["cpu","cuda"]`, `stt_backend`, `tts_backend`, `llm_backend`, `llm_model`, `gemini_api_key`, `turn_detector`, `bridge_transport`, `bridge_socket_path`, `bridge_tcp_host`, `bridge_tcp_port`, `tts_default_voice`, `log_level`, `log_format`.

`factory.py`: `make_stt() -> STTBackend`, `make_tts() -> TTSBackend`, `make_llm() -> LLMBackend`, `make_bridge() -> AudioBridge` — read Settings, lazy-import the chosen backend module, raise a clear error if a heavy backend is selected without its extra installed.

---

## Tasks

> Ordering: **T1–T4 (foundation)** are sequential and must land first — everything imports them. **T5–T11 are independent** (disjoint files, depend only on T1–T4 interfaces) and are dispatched to parallel agents. **T12–T14 (integration/validation/handoff)** land last.

### Task 1: Project scaffold + config + packaging
**Files:** Create `pyproject.toml`, `src/stewardai/__init__.py`, `src/stewardai/config.py`, `.env.example`, `tests/test_config.py`.
**Produces:** `Settings` (importable), base install runnable.
- [ ] Write `pyproject.toml`: project metadata, base deps (`pydantic-settings`, `structlog`, `python-dotenv`, `numpy`, `soundfile`, `litellm`, `fastapi`, `uvicorn[standard]`, `websockets`, `jiwer`, `pytest`, `pytest-asyncio`, `ruff`, `mypy`); extras `cpu` = `[torch, onnxruntime, "nemo_toolkit[asr]", kokoro, silero-vad, livekit-agents, livekit-plugins-silero, livekit-plugins-turn-detector]`, `cuda` = same but `onnxruntime-gpu` (+ CUDA torch index note); `[tool.pytest]` registers `heavy` marker; ruff/mypy config.
- [ ] Write `config.py` (`Settings(BaseSettings)`, env-prefix none, `.env` file, defaults: `device="cpu"`, `stt_backend="stub"`, `tts_backend="stub"`, `llm_backend="litellm"`, `llm_model="gemini/<from GEMINI_MODEL or a default>"`, reads `GEMINI_API_KEY`, `bridge_transport="tcp"`, etc.).
- [ ] Write `tests/test_config.py`: asserts defaults load, env override works.
- [ ] Run `pytest tests/test_config.py -v` → PASS. Commit.

### Task 2: Common — audio types + helpers
**Files:** Create `src/stewardai/common/audio.py`, `tests/test_audio.py`.
**Produces:** `AudioFrame`, `Transcript`, `Message`, constants, `pcm_from_float`, `float_from_pcm`, `resample_to_16k`, `chunk_pcm(pcm, frame_bytes)`.
- [ ] Tests: frame duration/num_samples math; float↔s16le round-trip within tolerance; chunker yields 640-byte frames + remainder handling.
- [ ] Implement. Run tests → PASS. Commit.

### Task 3: Common — structured logging + per-turn timing
**Files:** Create `src/stewardai/common/logging.py`, `src/stewardai/common/errors.py`, `tests/test_logging.py`.
**Produces:** `get_logger(name)`, `turn_id` contextvar + `new_turn()`, `TurnTimer` (context manager accumulating `t_stt/t_eou/t_llm_ttft/t_tts_ttfa/t_v2v`, emits one JSON summary), `StewardError` hierarchy.
- [ ] Tests: log line is valid JSON with `turn_id`; `TurnTimer` records stage durations and emits a summary dict with expected keys.
- [ ] Implement (structlog JSON renderer; contextvar). Run tests → PASS. Commit.

### Task 4: Interfaces + factory
**Files:** Create `src/stewardai/interfaces.py`, `src/stewardai/factory.py`, `tests/test_factory.py`.
**Produces:** the `Protocol`s above; `make_stt/make_tts/make_llm/make_bridge`.
- [ ] Tests: factory returns stub backends by default; selecting an uninstalled heavy backend raises `BackendUnavailable` with an actionable message; runtime_checkable Protocol conformance of stubs (after T5–T7 exist, this test imports stubs — keep factory test on stub presence via lazy import + skip if absent, OR land stubs minimal here). *(Implementation note: define trivial inline stubs is NOT allowed — import the real stub modules; so T5–T7 stubs may be created first or this test imports lazily.)*
- [ ] Implement lazy-import factory. Run tests → PASS. Commit.

> **Parallel block (T5–T11):** dispatch one agent per task. Each reads `interfaces.py`, `common/audio.py`, `common/logging.py`, `config.py`. Each writes ONLY its own directory + its own tests. None edits `pyproject.toml` (report new deps to the integrator instead).

### Task 5: STT — stub + real (Parakeet/NeMo)
**Files:** `src/stewardai/stt/stub.py`, `src/stewardai/stt/parakeet_nemo.py`, `tests/stt/test_stub.py`, `tests/stt/test_parakeet.py`.
- **Consumes:** `STTBackend`, `Transcript`, `Settings`, logging.
- **Produces:** `StubSTT(name="stub")` — deterministic (returns a fixed/echo transcript, optional canned-by-fixture); `ParakeetNeMoSTT(name="parakeet_nemo")` — loads `nvidia/parakeet-tdt-0.6b-v3` via NeMo onto `settings.device`, **batch decode** of a finalized utterance buffer → `Transcript`. Lazy heavy import inside `__init__`.
- [ ] `test_stub`: `await StubSTT().transcribe(pcm)` returns expected `Transcript(text=…, is_final=True)`.
- [ ] `test_parakeet` (`@pytest.mark.heavy`): skip unless `nemo_toolkit` importable; asserts a known WAV → non-empty transcript; asserts device honored.
- [ ] Implement both; commit.

### Task 6: TTS — stub + real (Kokoro)
**Files:** `src/stewardai/tts/stub.py`, `src/stewardai/tts/kokoro.py`, `tests/tts/test_stub.py`, `tests/tts/test_kokoro.py`.
- **Produces:** `StubTTS(name="stub", voices=["stub"])` — yields ~N frames of a low-amplitude sine/beep sized to the text length; `KokoroTTS(name="kokoro")` — `voices` lists Kokoro voices; `synthesize` streams 20 ms `AudioFrame`s at 16 kHz (resample from Kokoro's native rate), `voice` defaults to `settings.tts_default_voice`.
- [ ] `test_stub`: synthesize yields ≥1 frame, each `BYTES_PER_FRAME`, valid s16le.
- [ ] `test_kokoro` (`@pytest.mark.heavy`): skip unless `kokoro` importable; "hello" → frames; first frame arrives; voices non-empty.
- [ ] Implement; commit.

### Task 7: LLM — stub + real (LiteLLM/Gemini)
**Files:** `src/stewardai/llm/stub.py`, `src/stewardai/llm/litellm_client.py`, `tests/llm/test_stub.py`, `tests/llm/test_litellm.py`.
- **Produces:** `StubLLM(name="stub")` — streams a deterministic reply (e.g., echoes last user msg, word-by-word); `LiteLLMClient(name="litellm")` — `complete()` calls `litellm.acompletion(model=settings.llm_model, messages=[...], stream=True)`, yields content deltas; reads `GEMINI_API_KEY`; prepends `system`.
- [ ] `test_stub`: streams tokens that join to the expected reply.
- [ ] `test_litellm`: mock `litellm.acompletion` (no network) → assert messages/model wiring + delta yielding. (A live `@pytest.mark.heavy` smoke test optional, gated on key presence.)
- [ ] Implement; commit.

### Task 8: Turn — VAD + endpointer (web pipeline)
**Files:** `src/stewardai/turn/endpointer.py`, `src/stewardai/turn/vad.py`, `tests/turn/test_endpointer.py`, `tests/turn/test_vad.py`.
- **Produces:** `SilenceEndpointer(silence_ms=600, min_speech_ms=200)` — light, energy-based, feed 20 ms frames → emits `on_utterance(pcm_bytes)` when speech followed by silence (used by the web `/pipeline` page; no heavy deps); `SileroVAD` (`@heavy`, ONNX) — `is_speech(frame)->bool` for higher quality.
- [ ] `test_endpointer`: synthetic speech-then-silence buffer triggers exactly one utterance with the speech span.
- [ ] `test_vad` (`@heavy`): skip unless onnx model present.
- [ ] Implement; commit.

### Task 9: Bridge — transport + audio in/out
**Files:** `src/stewardai/bridge/transport.py`, `src/stewardai/bridge/audio_output.py`, `src/stewardai/bridge/vexa_client.py`, `src/stewardai/bridge/audio_input.py`, tests for each.
- **Produces:**
  - `transport.py`: `FrameTransport` Protocol; `TcpFrameServer(host,port)` & `UnixFrameServer(path)` — length-prefixed 640-byte frame framing; async `frames() -> AsyncIterator[bytes]`; client helpers for tests.
  - `audio_output.py`: `QueueAudioOutput` (LiveKit `io.AudioOutput` if livekit present, else a plain queue) + `SinkPlayer.play(frames)` writing s16le to `tts_sink` via `paplay`/pactl (subprocess) — **stubbed to a no-op/file-write when `pactl` absent** (Mac dev).
  - `vexa_client.py`: `speak(text|audio_url|base64)` → `POST /bots/{platform}/{meeting_id}/speak`; `mute(sink)`/`unmute(sink)` via `pactl` (no-op if absent).
  - `audio_input.py` (`@heavy`, needs livekit): `PushAudioInput(io.AudioInput)` backed by `aio.Chan`; `SocketAudioBridge(AudioBridge)` reads a `FrameTransport` → pushes `rtc.AudioFrame`; `inbound()`/`play()`.
- [ ] Tests: TCP server round-trips frames (client sends 3×640B → server yields 3 frames); `SilenceEndpointer`-free; output player writes expected bytes to a temp file when `pactl` absent; `vexa_client.speak` builds correct request (mock httpx).
- [ ] Implement; commit.

### Task 10: Web test pages (FastAPI + JS)
**Files:** `web/app.py`, `web/static/{index,stt,tts,pipeline}.html`, `web/static/app.js`, `web/static/style.css`, `tests/web/test_app.py`, `scripts/run-web.sh`.
- **Consumes:** `factory.make_stt/make_tts/make_llm`, `common`, `turn.SilenceEndpointer`.
- **Produces:** FastAPI app with: `GET /` (index linking the three), `GET /stt|/tts|/pipeline` (serve pages), `WS /ws/stt` (browser streams 16 kHz PCM frames → endpointer → `make_stt().transcribe` → push transcript JSON + timing), `WS /ws/pipeline` (mic → endpointer → STT → `make_llm().complete` → `make_tts().synthesize` → stream audio back + per-stage timing), `POST /api/tts` (text+voice → wav), `GET /api/voices`. JS uses WebAudio (AudioWorklet/ScriptProcessor) to capture 16 kHz mono PCM, WebSocket streaming, plays returned PCM, renders a timing/log panel.
- [ ] Tests: `TestClient` — `/` 200; `/api/voices` returns stub voice; `/api/tts` returns wav bytes (stub); a websocket smoke test feeding canned PCM yields a transcript message (stub STT). Boot app with stubs (no heavy deps).
- [ ] Implement; commit. `run-web.sh`: `uvicorn web.app:app --host 0.0.0.0 --port 8080`.

### Task 11: Evals
**Files:** `evals/{stt_eval,tts_eval,e2e_eval,run}.py`, `evals/datasets/…`, `tests/evals/test_evals.py`.
- **Produces:** `stt_eval` (jiwer WER over `datasets/` clips+refs + per-clip latency), `tts_eval` (TTFA, RTF for sample sentences), `e2e_eval` (drive the stub pipeline; measure simulated v2v + endpointer accuracy), `run.py` → writes `evals/report.json`. Ship a tiny sample dataset (3–5 short clips; if real audio unavailable, generate with stub TTS and use its text as reference for a wiring test).
- [ ] Tests: `stt_eval` computes WER=0 when hypothesis==reference; `run.py` produces a report dict with the expected keys (stub backends).
- [ ] Implement; commit.

### Task 12: Agent assembly (LiveKit, roomless) — integrator
**Files:** `src/stewardai/agent/nodes.py`, `src/stewardai/agent/assembly.py`, `tests/agent/test_assembly.py` (`@heavy`), `scripts/run-agent.sh`.
- **Produces:** custom LiveKit `STT`/`LLM`/`TTS` nodes wrapping our backends; `build_session()` → `AgentSession` with Silero VAD plugin + Turn Detector v1-mini + our nodes + `PushAudioInput`/`QueueAudioOutput`, started with **no room**; `run_agent(bridge)` connects the Vexa `SocketAudioBridge`.
- [ ] `@heavy` test: with stub backends + a fake `FrameTransport` feeding silence, `build_session()` constructs without error; a short scripted utterance (canned PCM) drives one turn → TTS output frames observed. (Skipped unless livekit installed.)
- [ ] Implement; commit.

### Task 13: Vexa patch (documented, not auto-applied)
**Files:** `vexa-patch/README.md`, `vexa-patch/zoom_tap.md`, `vexa-patch/audioworklet/pcm-worklet.js`, `vexa-patch/forwarder.ts`.
- **Produces:** copy-paste-ready patch: (a) Zoom — tap `parecord` stdout before WAV wrapping, emit 20 ms frames; (b) Meet/Teams — `pcm-worklet.js` AudioWorklet capturing 16 kHz mono 20 ms frames + integration notes for the combined stream; (c) `forwarder.ts` — normalize → length-prefixed frames → Unix/TCP socket matching `bridge/transport.py`. README maps exact insertion points (`audio-pipeline.ts`, `index.ts`) from the spec.
- [ ] No automated test (integration artifact). Verify forwarder framing matches `transport.py` (documented). Commit.

### Task 14: Containerization, docs, validation, STATUS
**Files:** `Dockerfile`, `docker-compose.yml`, `scripts/setup.sh`, `.env.example` (finalize), `STATUS.md`, `README.md` (update run steps).
- [ ] Consolidate component deps reported by T5–T11 into `pyproject.toml` extras.
- [ ] `Dockerfile` (python:3.11-slim base; `[cpu]` extra by default; `--build-arg EXTRA=cuda` for GPU on the box). `docker-compose.yml`: `web` + `agent` services, `profiles: [cpu, gpu]`, mounts `.env`, references how to attach Vexa.
- [ ] **Light validation gauntlet** (run, capture results in STATUS.md): `ruff check`, `mypy src`, `pytest -m "not heavy" -v`, boot `uvicorn web.app:app` and curl `/` + `/api/voices` + `/api/tts`, run `evals/run.py` (stub) → report.json. Run the `/pipeline` stub path with **real Gemini** (key present) to validate end-to-end wiring.
- [ ] Write `STATUS.md`: what's implemented, what passed light validation, what needs the box (heavy deps + live meeting), exact next commands. Commit.

---

## Self-Review (run after implementation)
- **Spec coverage:** every PRD §3–§11 item maps to a task (components→T5–T9/T12, bridge→T9/T13, test pages→T10, evals→T11, logging→T3, deployment→T14, Phase-0 spikes→noted in STATUS as next-session). ✅
- **Placeholder scan:** none permitted in code; stubs are real deterministic implementations, not placeholders.
- **Type consistency:** all backends implement the exact `interfaces.py` signatures; `AudioFrame`/`Transcript`/`Message` are the only audio/text DTOs.

## Validation boundary (honest)
Base install (no extras) + real Gemini validates: config, logging, all interfaces/factory, stub STT/TTS, LLM, bridge transport, web test pages, evals, agent construction (stub). **Not** validated unattended (needs the box / live meeting / heavy deps): real Parakeet/Kokoro inference, the LiveKit live audio loop, the Vexa AudioWorklet capture, barge-in, and latency numbers. Those are scripted (`setup.sh`, `run-agent.sh`, vexa-patch) for the next session on the CPU/GPU box.
