# StewardAI — Voice Core (Phase 1) Design Spec / PRD

**Date:** 2026-06-26
**Status:** Draft for review
**Scope:** Full product vision + roadmap (context), **build-ready spec for Phase 1 only** (the real-time voice meeting core).

---

## 1. Product vision & north star

**StewardAI is a voice-driven personal AI assistant.** It attends meetings on your behalf — listening, understanding, and speaking in real time — and beyond the meeting it handles the surrounding work: scheduling meetings, sending emails, setting reminders, and other tasks. The name reflects the intent: a *steward* manages your affairs.

The voice meeting agent is the **foundation**; the broader assistant capabilities are built on top of it as tool-using agent skills.

### Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| **Phase 0** | Validation spikes: bridge end-to-end, real latency, AudioWorklet capture, barge-in | gated before full Phase 1 build |
| **Phase 1** | **Real-time voice meeting core** — STT/LLM/TTS + turn detection + Vexa bridge + test pages + evals + logging | **this spec** |
| **Phase 2** | Post-meeting actions — calendar/scheduling, email, reminders, tasks (via LLM tool-calling) | future |
| **Phase 3** | Proactive assistant, multi-channel (messaging), multi-user/scale | future |

This document specs **Phase 0 + Phase 1**. Phases 2–3 are recorded only as direction.

---

## 2. Phase 1 goals & non-goals

### Goals
1. A working **cascaded voice agent** that joins a meeting via Vexa, transcribes speech, reasons with an LLM, and speaks a response back into the meeting.
2. **Four independent components** (STT, TTS, LLM, Vexa bridge) behind clean interfaces — each runnable and testable in isolation.
3. **Three test pages**: STT-only, TTS-only, and full STT→LLM→TTS pipeline.
4. **Evals** for each component and the end-to-end loop.
5. **Structured logging** of everything, with per-turn timing.
6. **Write-once, run-anywhere**: identical Linux code on local Mac (CPU) → cloud CPU → GPU, switched by a `DEVICE` env var.
7. **English-only**, optimized for **low latency** and **cost-efficiency**.

### Non-goals (Phase 1)
- Voice cloning; multilingual support.
- Post-meeting actions (scheduling, email, reminders) — Phase 2.
- A customer-facing product frontend (only internal test pages here).
- Production multi-meeting scaling / GPU autoscaling.
- True-streaming STT via NVIDIA Riva (Phase 1 uses batch STT; Riva is a documented upgrade path).

---

## 3. Locked architecture

A cascaded **STT → LLM → TTS** pipeline with audio-based turn detection, orchestrated by **LiveKit Agents**, fed by **Vexa** which captures meeting audio and plays the agent's voice back into the meeting.

```
  ┌──────────────────────────── Vexa bot (per meeting) ────────────────────────────┐
  │  Meet/Teams ── AudioWorklet tap ┐                                               │
  │  Zoom ──────── parecord tap ────┼─► normalize → s16le/16kHz/mono ─► SOCKET ─────┼──┐
  │                                  │                                              │  │ ~20ms frames
  │  meeting ◄── virtual_mic ◄── tts_sink ◄──────────── agent TTS PCM ◄─────────────┼──┼──┐
  └──────────────────────────────────────────────────────────────────────────────────┘  │  │
                                                                                          │  │
  ┌────────────────────────── StewardAI agent (LiveKit Agents) ───────────────────────────┘  │
  │  socket reader → rtc.AudioFrame → PushAudioInput (NO WebRTC room)                          │
  │     ├─► Silero VAD + LiveKit Turn Detector v1-mini (audio, CPU)  → end-of-turn             │
  │     ├─► STT (Parakeet TDT 0.6B v3, NeMo, batch-behind-VAD)       → transcript              │
  │     └─► LLM (hosted API) → TTS (Kokoro) → PCM frames ──────────────────────────────────────┘
  └────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key architectural decisions (from research, June 2026):**
- **Roomless audio I/O**: the LiveKit pipeline consumes a custom `io.AudioInput` (an `AsyncIterator[rtc.AudioFrame]`) fed via an `aio.Chan`. No WebRTC room/SFU → no jitter buffer, no Opus round-trip. (Verified in `livekit-agents` v1.6.4; public API, no fork.)
- **STT is batch-behind-VAD** for the MVP. Parakeet TDT 0.6B is an *offline* model (verified: not true cache-aware streaming). This is acceptable because turn detection is **audio-based** and does not require interim transcripts. Riva streaming (Nemotron streaming 0.6B) is the documented latency upgrade.
- **Vexa absorbs platform differences** and emits **one uniform low-latency PCM stream**; the agent sees a single stream regardless of platform.
- **Linux-only, device-parameterized**: PyTorch/NeMo/ONNX; `DEVICE=cpu|cuda` is an env flip, not a code change. No MLX/Apple layer.

---

## 4. Components & interfaces

All four components implement a typed contract (`Protocol`/ABC) in `interfaces.py`. Application code depends only on the interfaces; a `factory.py` instantiates concrete backends from env vars. Backends are lazy-imported so a host only loads what it supports.

### Interface contracts (sketch)
```python
class STTComponent(Protocol):
    async def transcribe(self, audio: AudioBuffer, *, lang: str = "en") -> Transcript: ...
    # batch-behind-VAD: receives a finalized utterance buffer, returns text + timing

class TTSComponent(Protocol):
    def synthesize(self, text: str, *, voice: str) -> AsyncIterator[AudioFrame]: ...
    # streaming PCM frames out

class LLMComponent(Protocol):
    def respond(self, messages: list[Message], *, ctx: TurnContext) -> AsyncIterator[str]: ...
    # streaming token output

class AudioBridge(Protocol):
    def inbound(self) -> AsyncIterator[AudioFrame]: ...   # meeting audio in
    async def play(self, frames: AsyncIterator[AudioFrame]) -> None: ...  # agent voice out
```

### Concrete backends (Phase 1)

| Component | Backend | Runtime | Device | Notes |
|---|---|---|---|---|
| **STT** | `nvidia/parakeet-tdt-0.6b-v3` | NeMo (PyTorch) | `cpu`/`cuda` | batch decode on finalized utterance; English |
| **TTS** | Kokoro 82M | PyTorch or `kokoro-onnx` | `cpu`/`cuda` | streaming PCM; ~50 voices; pick a default + 2–3 options |
| **LLM** | hosted API | provider SDK | n/a | provider/model via env; streaming |
| **VAD** | Silero VAD | ONNX Runtime | cpu | speech presence + barge-in |
| **Turn detector** | LiveKit Turn Detector **v1-mini** (audio) | ONNX Runtime | cpu | semantic + acoustic; VAD auto-provided by AgentSession |
| **Vexa bridge** | uniform-PCM socket consumer | Python | n/a | → `PushAudioInput`; TTS out → `tts_sink`/`/speak` |
| **Orchestration** | LiveKit Agents (`AgentSession`) | Python | n/a | roomless; assembles the four |

### Environment model
```
DEVICE=cpu|cuda                  # CPU dev ↔ GPU prod (no code change)
STT_BACKEND=parakeet_nemo
TTS_BACKEND=kokoro
LLM_PROVIDER=<provider>  LLM_MODEL=<model>  LLM_API_KEY=...
BRIDGE_TRANSPORT=unix|tcp        # unix on Linux host; tcp for Mac-Docker dev
TURN_DETECTOR=livekit_v1_mini
LOG_LEVEL=info  LOG_FORMAT=json
```
Optional dependency groups: `pip install ".[cuda]"` (torch+cuda, nemo, kokoro, livekit) — single Linux stack; CPU and GPU share it.

---

## 5. Vexa ↔ agent bridge design

The trickiest integration; designed for **near-zero transport overhead** and **platform uniformity**.

### Inbound (meeting audio → agent)
- **Vexa absorbs platform differences** and emits a single uniform stream:
  - **Zoom**: tap `parecord` stdout (raw s16le) **before** 15s WAV wrapping.
  - **Meet/Teams**: add an **AudioWorklet** on the combined audio stream emitting ~20ms raw PCM frames (raw Float32 already exists in-browser via a per-speaker `ScriptProcessor`; this exposes it at frame granularity).
  - Node side normalizes both to **s16le / 16kHz / mono, ~20ms frames**.
- Frames cross the process boundary over a **Unix domain socket** (Linux host) or **TCP localhost** (Mac-Docker dev) — both co-located, sub-1ms.
- Python reader wraps each frame as `rtc.AudioFrame` and pushes into a custom **`PushAudioInput(io.AudioInput)`** via `aio.Chan.send_nowait()`. The agent runs **with no room**.
- **Rejected**: publishing into a LiveKit room (30–80ms jitter buffer); using Vexa's recording/transcription chunks (15–30s chunking).

### Outbound (agent voice → meeting)
- Agent TTS frames leave the session via a custom **`io.AudioOutput`** (copy `QueueAudioOutput`).
- Played into the meeting via Vexa's existing path: write PCM to **`tts_sink`** (→ `virtual_mic` → meeting) or call **`POST /bots/{platform}/{meeting_id}/speak`** (Redis → playback). Vexa already supports interruptible playback.

### Echo & barge-in
- **Echo is a non-issue**: capture (meeting-incoming audio) and TTS output (`tts_sink`) are on **separate PulseAudio sinks** (verified), so the agent never transcribes its own voice.
- **Barge-in**: Silero VAD on the inbound stream detects user speech during agent playback → interrupt TTS. A **mute/stop handshake** flushes Vexa's `tts_sink` buffer promptly when the agent yields. *(Validated in Phase 0.)*

### Latency
Transport overhead = frame size (~10–20ms) + <1ms IPC. Everything else (STT/LLM/TTS) dominates.

---

## 6. Test pages

A small **FastAPI** server + minimal HTML/JS (WebAudio for mic capture, WebSocket for audio streaming). Each page has a live output area and a **timing/log panel**. No heavy frontend framework.

| Page | Flow | Proves |
|---|---|---|
| **`/stt`** | mic → STT → live transcript | STT correctness + latency (capture→transcript) |
| **`/tts`** | text box → TTS → audio playback | TTS quality, voice selection, time-to-first-audio |
| **`/pipeline`** | mic → VAD/turn → STT → LLM → TTS → audio | full voice-to-voice loop + per-stage timing + barge-in |

The pipeline page is the integration proof; the per-component pages isolate failures.

---

## 7. Evals

Each component and the e2e loop has an automated eval with stored datasets under `evals/`. Reuse existing libraries (e.g. `jiwer` for WER).

| Eval | Metric | Phase-1 target (GPU) |
|---|---|---|
| **STT** | WER on a small labeled English set; per-utterance latency | WER ≤ ~7%; batch decode of a 5s utterance < ~150ms |
| **TTS** | time-to-first-audio (streaming); RTF; optional UTMOS | TTFA < ~150ms; RTF < 0.3 |
| **LLM** | response-quality rubric (graded); time-to-first-token | TTFT < ~400ms (provider-dependent) |
| **E2E** | voice-to-voice latency (P50/P90); false-cutoff rate; barge-in stop time | V2V P50 < ~1s; false-cutoff comparable to Turn Detector v1 (~10% @300ms); barge-in < ~300ms |

> Targets are **GPU** figures. CPU/Mac runs are for functional validation only and will not meet them.

---

## 8. Logging / observability

- **Structured JSON logs** via a shared logger in `common/`.
- **Per-turn correlation ID** threaded through every stage: capture → VAD/turn → STT → LLM → TTS → playback.
- **Per-stage timing** emitted as fields (ms): `t_capture`, `t_eou`, `t_stt`, `t_llm_ttft`, `t_tts_ttfa`, `t_playback`, `t_v2v`.
- Log inputs/outputs (transcript, response text) at debug level; be mindful of meeting-content sensitivity (gated by `LOG_LEVEL` / redaction flag).
- Errors carry the turn ID + component label. A per-turn summary line mirrors the readable timing logs already used in `standin`.

---

## 9. Latency budget (acceptance criteria, GPU)

| Segment | Budget |
|---|---|
| Vexa→agent transport | < 5ms (frame size dominated) |
| VAD + turn detection | ~10–25ms |
| STT (batch decode at end-of-turn) | < ~150ms |
| LLM time-to-first-token | 200–400ms (API) |
| TTS time-to-first-audio | 100–300ms |
| **Voice-to-voice (P50 target)** | **< ~1s** |

If end-of-turn→transcript latency proves too high, upgrade STT to **Nemotron streaming 0.6B via Riva** (true streaming + speculative LLM).

---

## 10. Deployment & environments

| Env | Host | Device | Bridge | Purpose |
|---|---|---|---|---|
| **Local dev** | Mac M1, Linux containers (Docker/Colima) | `cpu` (ARM64) | TCP localhost | functional build & test; free |
| **Cloud CPU** | GCP `e2-standard-8` (x86) | `cpu` | Unix socket | x86 parity, cheaper functional/integration |
| **GPU** | GCP `g2-standard-8` (L4, x86) | `cuda` | Unix socket | latency tuning + (later) prod |

- **Same code across all three**; switch via `DEVICE` (+ optional `--platform linux/amd64` for x86 parity on the Mac).
- **Vexa** runs as Docker `docker-compose` on the host; the agent runs co-located (same host) so the socket bridge stays local.
- Progression: **Mac → cloud CPU → GPU**, validating function first, latency last.

---

## 11. Phase 0 — validation spikes (gates before full Phase 1)

Built/measured on the local Mac (CPU) where possible:

1. **Bridge end-to-end**: Zoom `parecord` tap → socket → `PushAudioInput` → batch Parakeet → Kokoro. **Measure** capture→transcript and voice-to-voice latency. *Success: stable frame flow; documented baseline latency.*
2. **AudioWorklet capture** (Meet/Teams): confirm an AudioWorklet can be injected in Vexa's Playwright/headless-Chrome context and emit ~20ms PCM frames. *Success: frames arrive at the Node forwarder.* *(Highest implementation risk.)*
3. **Barge-in propagation**: user speech during agent playback stops TTS and flushes Vexa `tts_sink`. *Success: stop time < ~300ms.*

---

## 12. Risks & open questions

| Risk | Mitigation |
|---|---|
| **NeMo / ML deps on ARM64** (Mac dev) | accept arm64 friction, or `--platform linux/amd64`, or move to x86 cloud CPU box |
| **AudioWorklet injection** in Vexa's headless Chrome | Phase-0 spike #2; fallback = route Chrome audio to a PulseAudio sink and tap its monitor |
| **Parakeet batch end-of-turn latency** too high | upgrade STT to Nemotron streaming 0.6B via Riva NIM (official LiveKit NVIDIA plugin) |
| **GPU cold start** (prod, later) | GPU memory snapshot (Parakeet 20s→2s) + calendar pre-warm; out of Phase-1 scope |
| **Vexa bot meeting-join reliability** (Google bot-detection) | known issue; use authenticated bot (tracked separately in `standin` notes) |
| **LLM provider/model** not yet chosen | configurable via env; choose during build |

### Open questions
1. Which **LLM provider/model** for Phase 1 (latency vs cost vs quality)?
2. Default **Kokoro voice** + which 2–3 alternates to expose?
3. STT eval dataset — source a small labeled English meeting-style set.

---

## Appendix — repo layout (target, created during implementation)

```
stewardai/
  pyproject.toml  .env.example  docker-compose.yml  README.md
  docs/specs/2026-06-26-stewardai-voice-core-design.md   # this file
  src/stewardai/
    interfaces.py        # STT / TTS / LLM / AudioBridge contracts
    factory.py           # env-driven backend selection (DEVICE, *_BACKEND)
    common/              # structured logging, config, timing, audio utils
    stt/                 # parakeet_nemo.py
    tts/                 # kokoro.py
    llm/                 # api_client.py
    bridge/              # socket consumer → io.AudioInput; output → tts_sink/speak
    agent/               # LiveKit AgentSession assembly
  web/                   # FastAPI + HTML/JS test pages (/stt, /tts, /pipeline)
  evals/                 # per-component + e2e suites + datasets
  vexa-patch/            # thin tap + socket emitter for the vexa-bot image
```
