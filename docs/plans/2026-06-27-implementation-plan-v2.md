# StewardAI Voice Core — Implementation Plan v2 (Source of Truth)

**Status:** Authoritative. This supersedes the v1 PRD/plan wherever they differ — most importantly on **deployment topology** (v2 isolates heavy backends as separate services/containers instead of one shared environment).

**Audience:** An engineer or coding model with **no prior context**. Everything needed to build StewardAI Phase 1 is in this document. Build strictly to this spec; do not infer from outside sources.

---

## 0. How to use this document

- Read §1–§4 for context and the non-negotiable decisions, then build §6 onward in the order given.
- Code blocks are the contract. Where a block is complete, use it as-is. Where it says `# ... (implement per spec)`, follow the prose immediately around it.
- Anything marked **VERIFY** must be checked against the installed library version at build time (APIs drift); the spec gives the expected shape and a fallback.
- Every component ends with a **validation gate** — it is not "done" until that gate passes against a *real* input, not a stub.

---

## 1. Product context

**StewardAI** is a voice-driven personal AI assistant. **Phase 1** (this document) is the real-time meeting voice core: a cascaded **STT → LLM → TTS** pipeline with audio-based turn detection, fed live meeting audio by **Vexa** (an existing meeting-bot system) and orchestrated by **LiveKit Agents**. Later phases (out of scope) add post-meeting actions (calendar, email, reminders).

**Phase 1 goals:** four independent components (STT, TTS, LLM, Vexa bridge) behind clean interfaces; three browser test pages (STT, TTS, full pipeline); evals; structured logging; **the real models actually installed, running, and validated** — not stubs. English-only. Optimize for low latency and cost.

**Non-goals (Phase 1):** voice cloning, multilingual, post-meeting actions, a customer UI, multi-tenant scaling, true-streaming STT (Parakeet is batch; streaming is a documented upgrade).

---

## 2. Locked technology stack (do not substitute)

| Stage | Choice | Notes |
|---|---|---|
| **STT** | **NVIDIA Parakeet TDT 0.6B v3** via **NeMo** (`nemo_toolkit[asr]`) | English, ~6.3% WER, **offline/batch** model (NOT streaming). Model id `nvidia/parakeet-tdt-0.6b-v3`. Upgrade path for true streaming: `nvidia/nemotron-speech-streaming-en-0.6b` via Riva — out of Phase-1 scope. |
| **TTS** | **Kokoro 82M** (`kokoro` pip pkg) | Default voice `af_heart`; alternates `af_bella, am_michael, bf_emma`. Outputs 24 kHz → resample to 16 kHz. Needs system `espeak-ng`. |
| **LLM** | **Gemini** via **LiteLLM** | Model by string: `gemini/<model>`. Switch model/provider by changing ONE env var. Reuse a `GEMINI_API_KEY`. |
| **VAD** | **Silero VAD** (`livekit-plugins-silero`) | Acoustic speech presence + barge-in. |
| **Turn detection** | **LiveKit Turn Detector v1.0 (audio, v1-mini)** (`livekit-plugins-turn-detector`) | Semantic end-of-turn; CPU ONNX; runs alongside VAD. |
| **Orchestration** | **LiveKit Agents** (`livekit-agents`, Apache-2.0) | **Roomless** — fed audio via a custom `io.AudioInput`, NOT a WebRTC room. |
| **Transport (Vexa↔agent)** | Length-prefixed PCM over Unix socket / TCP | See §7g. |
| **Compute** | `DEVICE=cpu|cuda` | Same code; one env switch. Linux-native (no Apple MLX). |

**DO NOT** introduce other STT/TTS models (e.g. faster-whisper, XTTS) — the stack is locked.

**Audio format everywhere:** PCM **s16le, 16 kHz, mono**, **20 ms** frames (320 samples = 640 bytes).

---

## 3. Architecture — service-per-heavy-stage (the corrected design)

The system is split into **independent services**, each with its **own dependency environment / container**. They communicate over **localhost** (HTTP for request/response, a socket for the audio stream).

```
                         ┌─────────────────────────────────────────────────────┐
   meeting audio ──────► │  Vexa bot (existing + thin tap patch)                 │
                         │   taps all platforms → uniform 20ms s16le PCM frames  │
                         └───────────────┬───────────────────────────▲──────────┘
                                         │ length-prefixed PCM socket │ agent TTS PCM → tts_sink
                                         ▼                            │
   ┌──────────────────── orchestrator service (light) ───────────────┴──────────┐
   │  LiveKit Agents (roomless) + Silero VAD + Turn Detector v1.0                │
   │  LLM = LiteLLM/Gemini (in-process; it's just an API call)                   │
   │  STT/TTS backends = HTTP CLIENTS to the services below                      │
   │  + FastAPI web test pages                                                   │
   └───────────┬───────────────────────────────────┬────────────────────────────┘
               │ POST /transcribe (PCM→text)        │ POST /synthesize (text→PCM stream)
               ▼                                     ▼
   ┌──────────────────────┐              ┌──────────────────────────┐
   │  stt service         │              │  tts service             │
   │  NeMo + Parakeet     │              │  Kokoro + espeak-ng      │
   │  own venv/container  │              │  own venv/container      │
   │  DEVICE=cpu|cuda      │              │  DEVICE=cpu|cuda          │
   └──────────────────────┘              └──────────────────────────┘
```

**Why this topology (see §4 for the failures that motivated it):**
- Each heavy ML library (NeMo, Kokoro) has a large, opinionated dependency tree. Co-installing them with each other and the app in ONE venv forces a single dependency resolution that downgrades/breaks shared packages and pollutes the namespace. Separate environments eliminate this.
- A crash/segfault/OOM in one model no longer takes down the whole agent.
- Each service scales/restarts independently and pins exactly its own system libs (CUDA, espeak-ng).
- **Latency cost is one local IPC hop (~0.1–1 ms per HTTP-over-Unix-socket call)** — negligible vs. the model stages, and the same pattern already used for the Vexa bridge.

**Co-location:** all services run on the **same host** (the GPU box) and talk over localhost/unix sockets. "Isolated" means separate *processes/containers*, not separate *machines*.

**Backend flexibility:** every component is behind a `Protocol` (§6). The factory can return one of three backend kinds, chosen by env:
- `stub` — deterministic, no deps (for tests / pipeline wiring).
- `service` — an HTTP client to the isolated service (**default for STT/TTS in prod**).
- `inprocess` — loads the model in the orchestrator process (offered for single-box dev convenience; **not recommended** due to §4).

LLM is always in-process (it's a network API, no local model). VAD + Turn Detector live in the orchestrator (they must run inside the LiveKit `AgentSession`).

---

## 4. Non-negotiable practices (do exactly this)

1. **Isolate each heavy backend in its own service/image** (§3). The orchestrator image must NOT install or import `nemo` or `kokoro`. The `stt` image installs only NeMo+torch; the `tts` image only Kokoro+torch. This keeps each dependency resolution independent — no cross-component version downgrades, no namespace collisions.

2. **A component is "done" only when its real backend is installed and validated against a real input** (§10). Stubs exist solely for tests and pipeline wiring — never treat a stub as the finished component.

3. **Use only the models in §2.** Never substitute an STT/TTS model. If a locked model won't run in an environment, fix the environment (or isolate it).

4. **Pre-download models as an explicit, verified step** — never download inside the request path. Use exactly this (xet disabled + resumable), and gate the service's `/health` on the model being loaded:
   ```python
   import os
   os.environ["HF_HUB_DISABLE_XET"] = "1"     # avoids the xet transfer stalling
   from huggingface_hub import snapshot_download
   snapshot_download("nvidia/parakeet-tdt-0.6b-v3", allow_patterns=["*.nemo"])  # resumable + idempotent
   ```
   **Fetch only the file the loader uses.** Parakeet's repo ships BOTH a `.nemo` and a `model.safetensors` (~2.3 GB each); NeMo loads the `.nemo`, so `allow_patterns=["*.nemo"]` halves the download. Mount the host HF cache (or a named volume) into the `stt`/`tts` images so the model is fetched once and reused (no re-download per build/run).

5. **Share test helpers via pytest fixtures; never `import tests.*`** (a cross-test import breaks if any installed dependency ships a top-level `tests` package). Put helpers in `conftest.py` as fixtures, request them by name:
   ```python
   # conftest.py
   import numpy as np, pytest
   from stewardai_common.audio import SAMPLE_RATE, SAMPLES_PER_FRAME, pcm_from_float
   def _speech(freq=440.0, amp=0.3):
       t = np.arange(SAMPLES_PER_FRAME) / SAMPLE_RATE
       return pcm_from_float((amp * np.sin(2 * np.pi * freq * t)).astype(np.float32))
   @pytest.fixture
   def speech_frame(): return _speech
   @pytest.fixture
   def silence_frame(): return lambda: b"\x00\x00" * SAMPLES_PER_FRAME
   # usage:  def test_x(speech_frame, silence_frame): ...; speech_frame(); silence_frame()
   ```

6. **Validate STT/TTS with real speech, not synthetic tones** (§10). Generate a known clip (`say -o c.aiff "the quick brown fox" && afconvert -f WAVE -d LEI16@16000 -c 1 c.aiff c.wav`, or `espeak`), or bundle one.

7. **Pin `livekit-agents` to a fixed version and verify every LiveKit API in §7f against that version** before relying on it (the node base-classes, the turn-detector class path, and roomless `start()` semantics drift across minor versions).

---

## 5. Repository / service layout

A monorepo with one shared library and three deployable services.

```
stewardai/
  pyproject.toml                     # shared lib `stewardai_common` only (light deps)
  docker-compose.yml                 # orchestrator + stt + tts (+ how to attach Vexa)
  .env.example
  packages/
    common/                          # installable shared lib (no heavy deps)
      pyproject.toml
      src/stewardai_common/
        audio.py                     # DTOs, constants, conversions  (§6)
        protocol.py                  # wire framing for the PCM socket (§7g)
        logging.py                   # structured logging + TurnTimer (§6)
        config.py                    # base settings helpers
  services/
    stt/                             # NeMo + Parakeet service
      pyproject.toml                 # heavy: nemo_toolkit[asr], torch, fastapi
      Dockerfile
      src/stt_service/
        app.py                       # FastAPI: POST /transcribe, GET /health
        parakeet.py                  # ParakeetEngine (loads model, batch decode)
      scripts/predownload.py         # robust model pre-download (§4 rule 4)
    tts/                             # Kokoro service
      pyproject.toml                 # heavy: kokoro, torch, fastapi
      Dockerfile                     # installs espeak-ng
      src/tts_service/
        app.py                       # FastAPI: POST /synthesize (streams PCM), /health
        kokoro_engine.py
    orchestrator/                    # the brain
      pyproject.toml                 # livekit-agents, plugins, litellm, fastapi, httpx
      Dockerfile
      src/orchestrator/
        interfaces.py                # STT/TTS/LLM/AudioBridge Protocols (§6)
        factory.py                   # stub|service|inprocess selection (§7h)
        backends/
          stub.py                    # StubSTT/StubTTS/StubLLM
          stt_client.py              # HTTP client -> stt service  (STTBackend)
          tts_client.py              # HTTP client -> tts service  (TTSBackend)
          llm_litellm.py             # LiteLLMClient (Gemini)      (LLMBackend)
        turn/endpointer.py           # Silero-VAD endpointing (+ energy fallback); trims trailing silence
        bridge/                      # Vexa socket in / tts_sink out (§7g)
          transport.py  audio_input.py  audio_output.py  vexa_client.py
        agent/                       # LiveKit roomless assembly (§7f)
          nodes.py  assembly.py
        web/                         # FastAPI test pages (§7i)
          app.py  static/...
    evals/                           # eval harness (§7j) — runs against services or stubs
  vexa-patch/                        # tap + forwarder for the Vexa bot (§7g)
    README.md  zoom_tap.md  audioworklet/pcm-worklet.js  forwarder.ts
```

**Dependency isolation is structural:** `packages/common` has only light deps and is installed into every service. `services/stt` and `services/tts` never import `livekit` or `litellm`; the orchestrator never imports `nemo` or `kokoro`.

---

## 6. Shared library (`stewardai_common`) — complete code

### `audio.py`
```python
from __future__ import annotations
from collections.abc import Iterator
from dataclasses import dataclass, field
import numpy as np

SAMPLE_RATE = 16_000
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
    def duration_ms(self) -> float: return 1000.0 * self.num_samples / self.sample_rate

@dataclass(slots=True)
class Transcript:
    text: str
    is_final: bool = True
    confidence: float | None = None

@dataclass(slots=True)
class Message:
    role: str                        # "system" | "user" | "assistant"
    content: str

def float_from_pcm(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0

def pcm_from_float(arr: np.ndarray) -> bytes:
    return (np.clip(arr, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()

def chunk_pcm(pcm: bytes, frame_bytes: int = BYTES_PER_FRAME) -> Iterator[bytes]:
    for i in range(0, len(pcm), frame_bytes):
        yield pcm[i:i + frame_bytes]

def resample_linear(arr: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or arr.size == 0: return arr.astype(np.float32)
    n = int(round(arr.size / src * dst))
    return np.interp(np.linspace(0, arr.size - 1, n), np.arange(arr.size), arr).astype(np.float32)

def rms(pcm: bytes) -> float:
    if not pcm: return 0.0
    return float(np.sqrt(np.mean(float_from_pcm(pcm) ** 2)))
```

### `protocol.py` (the PCM wire framing — used by Vexa forwarder, bridge, and any socket audio)
```python
# Frame on the wire: [4-byte big-endian uint32 length N][N bytes s16le PCM]. N is normally 640.
import asyncio, struct

async def read_frame(reader: asyncio.StreamReader) -> bytes | None:
    header = await reader.readexactly(4)
    (n,) = struct.unpack(">I", header)
    return await reader.readexactly(n)

def encode_frame(pcm: bytes) -> bytes:
    return struct.pack(">I", len(pcm)) + pcm
```

### `logging.py` (structured JSON + per-turn timing)
```python
import contextvars, logging, time, uuid
from collections.abc import Iterator
from contextlib import contextmanager
import structlog

_turn: contextvars.ContextVar[str | None] = contextvars.ContextVar("turn_id", default=None)
_configured = False

def new_turn() -> str:
    tid = uuid.uuid4().hex[:12]; _turn.set(tid); return tid

def _inject_turn(_l, _m, ev): 
    if _turn.get(): ev.setdefault("turn_id", _turn.get())
    return ev

def configure_logging(level="info", fmt="json"):
    global _configured
    r = structlog.processors.JSONRenderer() if fmt == "json" else structlog.dev.ConsoleRenderer()
    structlog.configure(
        processors=[structlog.contextvars.merge_contextvars, _inject_turn,
                    structlog.processors.add_log_level,
                    structlog.processors.TimeStamper(fmt="iso"), r],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), 20)),
        logger_factory=structlog.PrintLoggerFactory(), cache_logger_on_first_use=True)
    _configured = True

def get_logger(name="stewardai"):
    if not _configured: configure_logging()
    return structlog.get_logger(name)

class TurnTimer:
    """Record per-stage latencies; emit one JSON summary per turn."""
    def __init__(self, logger=None): self._t0 = time.perf_counter(); self.t = {}; self._log = logger or get_logger("turn")
    def mark(self, name): self.t[name] = round((time.perf_counter() - self._t0) * 1000, 1)
    @contextmanager
    def stage(self, name) -> Iterator[None]:
        s = time.perf_counter()
        try: yield
        finally: self.t[name] = round((time.perf_counter() - s) * 1000, 1)
    def summary(self) -> dict:
        d = {f"t_{k}": v for k, v in self.t.items()} | {"t_total": round((time.perf_counter() - self._t0) * 1000, 1)}
        self._log.info("turn_complete", **d); return d
```

---

## 7. Components

### 7a. Interfaces (`orchestrator/interfaces.py`) — complete
```python
from __future__ import annotations
from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable
from stewardai_common.audio import AudioFrame, Message, Transcript

@runtime_checkable
class STTBackend(Protocol):
    name: str
    async def transcribe(self, pcm: bytes, *, sample_rate: int = 16000, lang: str = "en") -> Transcript: ...
    async def aclose(self) -> None: ...

@runtime_checkable
class TTSBackend(Protocol):
    name: str
    @property
    def voices(self) -> list[str]: ...
    def synthesize(self, text: str, *, voice: str | None = None) -> AsyncIterator[AudioFrame]: ...
    async def aclose(self) -> None: ...

@runtime_checkable
class LLMBackend(Protocol):
    name: str
    def complete(self, messages: list[Message], *, system: str | None = None,
                 temperature: float = 0.4) -> AsyncIterator[str]: ...
    async def aclose(self) -> None: ...
```

### 7b. STT service (`services/stt`) — Parakeet/NeMo behind HTTP

**`parakeet.py`** (engine; model is pre-downloaded, see predownload script):
```python
import asyncio
from stewardai_common.audio import Transcript, float_from_pcm
from stewardai_common.logging import get_logger
log = get_logger("stt.parakeet")
MODEL = "nvidia/parakeet-tdt-0.6b-v3"

class ParakeetEngine:
    def __init__(self, device: str = "cpu"):
        import torch  # noqa
        from nemo.collections.asr.models import ASRModel       # VERIFY import path
        log.info("loading_model", model=MODEL, device=device)
        self._m = ASRModel.from_pretrained(model_name=MODEL)   # VERIFY kwarg name
        self._m = self._m.to(device).eval()
        self._device = device

    async def transcribe(self, pcm: bytes, sample_rate: int = 16000) -> Transcript:
        if not pcm: return Transcript(text="", is_final=True)
        audio = float_from_pcm(pcm)  # 16 kHz float32 mono
        def _run():
            import numpy as np
            out = self._m.transcribe([audio], batch_size=1)   # VERIFY: returns list[str] or list[Hypothesis]
            first = out[0]
            return getattr(first, "text", first)
        text = await asyncio.to_thread(_run)
        return Transcript(text=str(text), is_final=True)
```

**`app.py`** (FastAPI):
```python
import os
from fastapi import FastAPI, Request, Response
from stewardai_common.logging import configure_logging, get_logger
from stt_service.parakeet import ParakeetEngine
configure_logging(); log = get_logger("stt.app")
app = FastAPI()

@app.on_event("startup")
async def _start():
    app.state.engine = ParakeetEngine(device=os.getenv("DEVICE", "cpu"))

@app.get("/health")
async def health(): return {"ok": True, "model": "parakeet-tdt-0.6b-v3"}

@app.post("/transcribe")            # body = raw s16le 16 kHz mono PCM bytes
async def transcribe(req: Request):
    pcm = await req.body()
    t = await app.state.engine.transcribe(pcm)
    return {"text": t.text, "is_final": t.is_final}
```

**`scripts/predownload.py`** (robust, resumable, xet disabled — §4 rule 4):
```python
import os
os.environ["HF_HUB_DISABLE_XET"] = "1"
from huggingface_hub import snapshot_download
# This repo ships BOTH parakeet-tdt-0.6b-v3.nemo AND model.safetensors (~2.3 GB each).
# NeMo's ASRModel.from_pretrained loads the .nemo, so fetch ONLY that — halves the
# download and skips the redundant safetensors. (Confirmed on the v1 spike.)
path = snapshot_download("nvidia/parakeet-tdt-0.6b-v3", allow_patterns=["*.nemo"])
print("Parakeet .nemo at:", path)
```

### 7c. STT service client (`orchestrator/backends/stt_client.py`) — implements `STTBackend`
```python
import httpx
from stewardai_common.audio import Transcript

class ServiceSTT:
    name = "service"
    def __init__(self, settings):
        # HTTP over a Unix domain socket: lowest-latency local IPC; connection kept alive.
        self._client = httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(uds=settings.stt_uds),  # e.g. /run/stewardai/stt.sock
            base_url="http://stt", timeout=30.0)
    async def transcribe(self, pcm: bytes, *, sample_rate: int = 16000, lang: str = "en") -> Transcript:
        r = await self._client.post("/transcribe", content=pcm,
                                    headers={"content-type": "application/octet-stream"})
        r.raise_for_status(); d = r.json()
        return Transcript(text=d["text"], is_final=d.get("is_final", True))
    async def aclose(self): await self._client.aclose()
```

### 7d. TTS service (`services/tts`) — Kokoro behind HTTP (streams PCM)

> The TTS image MUST install Kokoro's G2P system dependency, or synthesis fails at runtime: `RUN apt-get update && apt-get install -y espeak-ng`.
>
> **CONFIRMED (v1 spike, kokoro 0.9.4):** the API below works as written — `from kokoro import KPipeline`, `KPipeline(lang_code="a", device=...)`, iterate `pipeline(text, voice=...)` for per-segment results whose `.audio` is 24 kHz float (resample to 16 kHz). Voices `af_heart` (default, validated), `af_bella`, `am_michael`, `bf_emma`. Validated by a Kokoro→Parakeet round-trip (synthesized speech transcribed back to the exact input text).

**`kokoro_engine.py`**:
```python
import asyncio
from collections.abc import AsyncIterator
from stewardai_common.audio import (AudioFrame, SAMPLE_RATE, chunk_pcm, pcm_from_float, resample_linear)
from stewardai_common.logging import get_logger
log = get_logger("tts.kokoro")
VOICES = ["af_heart", "af_bella", "am_michael", "bf_emma"]   # VERIFY against installed kokoro

class KokoroEngine:
    def __init__(self, device: str = "cpu"):
        from kokoro import KPipeline                          # VERIFY import + ctor
        self._p = KPipeline(lang_code="a", device=device)     # 'a' = American English; VERIFY
        self._device = device
    @property
    def voices(self): return list(VOICES)
    async def synthesize(self, text: str, voice: str | None = None) -> AsyncIterator[AudioFrame]:
        v = voice if voice in VOICES else "af_heart"
        def _segments():
            return list(self._p(text, voice=v))               # VERIFY: yields objects with .audio (24 kHz)
        segs = await asyncio.to_thread(_segments)
        import numpy as np
        for s in segs:
            audio = getattr(s, "audio", s)
            if hasattr(audio, "detach"): audio = audio.detach().cpu().numpy()
            pcm = pcm_from_float(resample_linear(np.asarray(audio, dtype="float32"), 24000, SAMPLE_RATE))
            for f in chunk_pcm(pcm): yield AudioFrame(pcm=f)
```

**`app.py`** streams concatenated PCM (the client re-frames):
```python
import os
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from tts_service.kokoro_engine import KokoroEngine
app = FastAPI()
@app.on_event("startup")
async def _s(): app.state.engine = KokoroEngine(device=os.getenv("DEVICE", "cpu"))
@app.get("/health")
async def health(): return {"ok": True, "voices": app.state.engine.voices}
@app.post("/synthesize")            # body {"text":..., "voice":...} -> streamed raw s16le PCM
async def synth(req: Request):
    body = await req.json()
    async def gen():
        async for frame in app.state.engine.synthesize(body["text"], body.get("voice")):
            yield frame.pcm
    return StreamingResponse(gen(), media_type="application/octet-stream")
```

**TTS client** (`tts_client.py`): same UDS transport as `ServiceSTT` (`httpx.AsyncHTTPTransport(uds=settings.tts_uds)`, `base_url="http://tts"`); POST `{text, voice}`, read the streamed PCM via `httpx` `stream`, re-chunk into 640-byte `AudioFrame`s.

### 7e. LLM (`orchestrator/backends/llm_litellm.py`) — in-process, complete
```python
import os
from collections.abc import AsyncIterator
from stewardai_common.audio import Message

class LiteLLMClient:
    name = "litellm"
    def __init__(self, settings):
        self._model = settings.resolved_llm_model            # "gemini/<model>"
        if settings.gemini_api_key: os.environ.setdefault("GEMINI_API_KEY", settings.gemini_api_key)
    async def complete(self, messages, *, system=None, temperature=0.4) -> AsyncIterator[str]:
        import litellm
        payload = ([{"role": "system", "content": system}] if system else []) + \
                  [{"role": m.role, "content": m.content} for m in messages]
        resp = await litellm.acompletion(model=self._model, messages=payload, stream=True, temperature=temperature)
        async for chunk in resp:
            delta = chunk.choices[0].delta.content
            if delta: yield delta
    async def aclose(self): pass
```
`resolved_llm_model`: if `LLM_MODEL` set use it; else `gemini/<GEMINI_MODEL>` (add `gemini/` prefix if absent).

### 7f. Orchestrator: LiveKit roomless agent (`orchestrator/agent/`)

**Critical facts (VERIFY against the pinned `livekit-agents` version):**
- The pipeline consumes an `AudioInput` = `AsyncIterator[rtc.AudioFrame]`. Feed it via a custom subclass backed by `livekit.agents.utils.aio.Chan`; **no room required**.
- `AgentSession.start(room=...)` — `room` is optional; if `session.input.audio` is set before `start()`, RoomIO is bypassed.
- Imports: `from livekit import rtc`; `from livekit.agents.utils import aio`; `from livekit.agents.voice import io as lk_io` (`AudioInput`, `AudioOutput`, `AudioOutputCapabilities`).

**`agent/nodes.py`** — adapt our backends to LiveKit node base classes. **VERIFY** each base class + method:
- STT node: subclass `livekit.agents.stt.STT(capabilities=STTCapabilities(streaming=False, interim_results=False))`; implement `async def _recognize_impl(self, buffer, *, language, conn_options)` → flatten `buffer` to s16le → `await our_stt.transcribe(pcm)` → return `SpeechEvent(type=FINAL_TRANSCRIPT, alternatives=[SpeechData(language=language, text=..., confidence=...)])`.
- LLM node: subclass `livekit.agents.llm.LLM`; `chat(...)` returns an `LLMStream` whose `_run` pushes `ChatChunk(id=..., delta=ChoiceDelta(role="assistant", content=delta))`.
- TTS node: subclass `livekit.agents.tts.TTS(capabilities=TTSCapabilities(streaming=False), sample_rate=16000, num_channels=1)`; `synthesize(text, *, conn_options)` returns a `ChunkedStream` whose `_run(output_emitter)` calls `output_emitter.initialize(request_id, 16000, 1, mime_type="audio/pcm")` then `.push(pcm)`/`.flush()`. (Older 1.x: `_run(self)` pushing `SynthesizedAudio(frame=rtc.AudioFrame(...))` — support both via `inspect.signature`.)

**`agent/assembly.py`**:
```python
def build_session(settings):
    from livekit.agents import AgentSession, Agent
    from livekit.plugins import silero
    from .nodes import build_stt_node, build_llm_node, build_tts_node
    from ..bridge.audio_input import PushAudioInput
    from ..bridge.audio_output import QueueAudioOutput
    turn = _load_turn_detector()                              # VERIFY: turn_detector.multilingual.MultilingualModel()
    session = AgentSession(vad=silero.VAD.load(), stt=build_stt_node(settings),
                           llm=build_llm_node(settings), tts=build_tts_node(settings),
                           turn_detection=turn)
    session.input.audio = PushAudioInput()
    session.output.audio = QueueAudioOutput()
    return session

async def run_agent(settings):
    from livekit.agents import Agent
    from ..bridge.audio_input import SocketAudioBridge
    session = build_session(settings)
    bridge = SocketAudioBridge(settings)                      # serves the Vexa PCM socket
    bridge.attach(session.input.audio)                        # pump socket frames -> PushAudioInput
    await session.start(agent=Agent(instructions=settings.system_prompt))  # NO room=
    await bridge.run_forever()

def _load_turn_detector():
    try:
        from livekit.plugins.turn_detector.multilingual import MultilingualModel
        return MultilingualModel()
    except Exception:
        return None   # fall back to VAD-only; log a warning
```

### 7g. Vexa ↔ agent bridge

**Inbound (Vexa → agent):** Vexa is patched to tap meeting audio for all platforms and emit **uniform 20 ms s16le/16 kHz/mono PCM frames** over a socket using the `protocol.py` framing.
- Zoom: tap the `parecord` stdout (s16le) before the 15 s WAV wrapping.
- Meet/Teams: an **AudioWorklet** on the combined audio graph emits 20 ms frames; a Node forwarder sends them.
- See `vexa-patch/` for `pcm-worklet.js` + `forwarder.ts` (must use `protocol.py` framing exactly).

**`bridge/audio_input.py`**:
```python
class PushAudioInput:                                          # subclass lk_io.AudioInput; VERIFY base
    def __init__(self):
        from livekit.agents.utils import aio
        from livekit.agents.voice import io as lk_io
        lk_io.AudioInput.__init__(self, label="vexa")          # VERIFY ctor kwargs
        self._ch = aio.Chan()
    def push(self, pcm: bytes, sample_rate: int = 16000):
        from livekit import rtc
        self._ch.send_nowait(rtc.AudioFrame(pcm, sample_rate, 1, len(pcm)//2))
    async def __anext__(self):
        from livekit.agents.utils import aio
        try: return await self._ch.recv()
        except aio.ChanClosed: raise StopAsyncIteration

class SocketAudioBridge:
    def __init__(self, settings): self._settings = settings; self._sink = None
    def attach(self, push_input): self._sink = push_input
    async def run_forever(self):
        # asyncio server per settings.bridge_transport (unix|tcp); for each frame read via
        # stewardai_common.protocol.read_frame -> self._sink.push(frame)
        ...   # implement per protocol.py
```

**Outbound (agent → meeting):** `bridge/audio_output.py` `QueueAudioOutput` (subclass `lk_io.AudioOutput`; **VERIFY** ctor needs `capabilities=AudioOutputCapabilities(pause=False)`) buffers TTS frames; a player writes s16le to Vexa's `tts_sink` via `paplay --raw --format=s16le --rate=16000 --channels=1 --device=tts_sink` (fallback: POST to Vexa `/bots/{platform}/{meeting_id}/speak` with base64). `vexa_client.py` wraps the `/speak` HTTP call + `pactl` mute helpers.

**Echo/barge-in:** Vexa capture (incoming meeting audio) and TTS output (`tts_sink`) are on **separate PulseAudio sinks**, so the agent never transcribes its own voice. Barge-in = Silero VAD on the inbound stream interrupts TTS; on interruption, flush `QueueAudioOutput` and stop `paplay`.

### 7h. Factory (`orchestrator/factory.py`)
```python
import importlib
def _load(path, cls): return getattr(importlib.import_module(path), cls)

_STT = {"stub": ("orchestrator.backends.stub", "StubSTT"),
        "service": ("orchestrator.backends.stt_client", "ServiceSTT"),
        "inprocess": ("orchestrator.backends.stt_inprocess", "InprocessParakeetSTT")}
_TTS = {"stub": ("orchestrator.backends.stub", "StubTTS"),
        "service": ("orchestrator.backends.tts_client", "ServiceTTS"),
        "inprocess": ("orchestrator.backends.tts_inprocess", "InprocessKokoroTTS")}
_LLM = {"stub": ("orchestrator.backends.stub", "StubLLM"),
        "litellm": ("orchestrator.backends.llm_litellm", "LiteLLMClient")}

def make_stt(s): return _load(*_STT[s.stt_backend])(s)
def make_tts(s): return _load(*_TTS[s.tts_backend])(s)
def make_llm(s): return _load(*_LLM[s.llm_backend])(s)
```
Selection via env: `STT_BACKEND=service|stub|inprocess`, `TTS_BACKEND=service|stub|inprocess`, `LLM_BACKEND=litellm|stub`. **Prod default: `service` for STT/TTS, `litellm` for LLM.** Lazy-import so the orchestrator never imports a service's heavy deps.

### 7i. Web test pages (`orchestrator/web/`)
FastAPI + vanilla JS. Routes: `GET /` `/stt` `/tts` `/pipeline`; `GET /api/voices`; `POST /api/tts` (text→WAV); `WS /ws/stt` (browser streams 16 kHz s16le PCM → `SilenceEndpointer` → `make_stt().transcribe` → transcript JSON); `WS /ws/pipeline` (capture → endpointer → STT → `make_llm().complete` streamed → `make_tts().synthesize` streamed back as binary → `TurnTimer` summary JSON). Browser mic capture: AudioWorklet (ScriptProcessor fallback), downsample to 16 kHz mono s16le, 320-sample frames. The `/pipeline` page exercises STT/LLM/TTS via whatever backends are configured (point at the running services for a real end-to-end test).

**Endpointing — do this exactly (avoids "words during silence"):** use **Silero VAD** for speech detection (it's already in the orchestrator image), NOT a raw RMS energy gate — an energy threshold treats ambient mic noise as speech, and the ASR then **hallucinates words on noise/silence**. Then: require ≥250 ms of detected speech before accepting an utterance, and **trim trailing silence** — send only the speech span (+ ~60 ms tail pad) to STT, because Parakeet (like most ASR) emits phantom words when fed trailing silence. A tuned energy endpointer (threshold ≥0.02, trailing-silence trimmed) is acceptable only as a no-dependency fallback for the standalone pages.

**Voice replies — keep them short (TTS time dominates):** always pass a brevity **system prompt** (e.g. "Reply in ONE short conversational sentence, ≤20 words, plain spoken text — no lists/markdown"). A verbose LLM reply makes TTS synthesis the latency bottleneck (a paragraph took ~18 s on CPU; one sentence is a few seconds). For longer replies, **pipeline LLM→TTS per sentence** — synthesize each sentence as it streams from the LLM so time-to-first-audio tracks the first sentence, not the whole reply. (The agent persona in §7f already instructs brevity; the web pipeline must too.)

### 7j. Evals (`services/evals` or a CLI)
- STT: WER via `jiwer.wer(ref, hyp)` over a labeled clip set + per-clip latency. **Use real labeled audio** (or `say`-generated clips with known text); document that synthetic audio is a wiring check only.
- TTS: time-to-first-audio + RTF.
- E2E: voice-to-voice latency, endpointer/turn behavior.
- `run.py` → `report.json`. Runs against the **services** (real) or stubs (wiring).

---

## 8. Environment / config

Per-service env (all read from `.env`):
```
# orchestrator
DEVICE=cpu                       # cpu|cuda (also set on stt/tts)
STT_BACKEND=service              # service|stub|inprocess
TTS_BACKEND=service              # service|stub|inprocess
LLM_BACKEND=litellm              # litellm|stub
STT_UDS=/run/stewardai/stt.sock      # stt service listens here (uvicorn --uds); client dials it
TTS_UDS=/run/stewardai/tts.sock      # tts service listens here
GEMINI_API_KEY=...               # reused; never commit
GEMINI_MODEL=gemini-2.5-flash-lite
# LLM_MODEL=gemini/...           # optional explicit override (switch model here)
TTS_DEFAULT_VOICE=af_heart
BRIDGE_TRANSPORT=unix            # unix (Linux host) | tcp
BRIDGE_SOCKET_PATH=/tmp/stewardai.sock
BRIDGE_TCP_HOST=127.0.0.1
BRIDGE_TCP_PORT=8765
SYSTEM_PROMPT=You are StewardAI, a concise meeting assistant.
LOG_LEVEL=info  LOG_FORMAT=json
```
`.env` is git-ignored; `.env.example` documents names only; **never print or commit secrets**.

---

## 9. Deployment

- **Each service is its own container** with its own deps (§3, §4). The `stt`/`tts` services listen on a **Unix domain socket** (`uvicorn stt_service.app:app --uds $STT_UDS`, no TCP port); the orchestrator dials them via the `httpx` UDS transport. Mount a **shared volume** (e.g. `/run/stewardai`) into `orchestrator`, `stt`, and `tts` so the sockets are reachable across containers. Vexa's bridge socket is shared the same way.
- **GPU:** `stt`/`tts` containers get the GPU (`deploy.resources.reservations.devices` for nvidia; build torch from the CUDA index) and `DEVICE=cuda`. Orchestrator stays CPU.
- **Model pre-download** is a build/startup step (`scripts/predownload.py`) — the service `/health` must not report ready until the model is loaded.
- **Mac/dev:** you may run the orchestrator with `STT_BACKEND=stub TTS_BACKEND=stub` + real `litellm` for fast iteration with no heavy deps; OR run the real `stt`/`tts` containers and point `STT_UDS`/`TTS_UDS` at the shared socket dir. **macOS caveat:** Unix sockets between the Docker VM and the host are unreliable on macOS — on Mac, either run the orchestrator in a container too (so all sockets live inside the Linux VM), or fall back to TCP locally. UDS is the production path on a native Linux host. Do **not** install nemo+kokoro+livekit into one shared venv (§4 rule 1).
- **CPU↔GPU is `DEVICE` only** — same images, same code.

---

## 10. Validation gates (a stage is not "done" until its gate passes)

| Stage | Gate (must use a REAL input) |
|---|---|
| Common lib | `pytest` green; audio round-trip + framing tests pass |
| **STT service** | `predownload.py` completes; `GET /health` ok; `POST /transcribe` with a **real speech clip** (e.g. `say -o c.aiff "the quick brown fox" && afconvert -f WAVE -d LEI16@16000 -c 1 c.aiff c.wav`) returns the correct words |
| **TTS service** | `GET /health` lists voices; `POST /synthesize` returns PCM that plays back as intelligible speech in the chosen voice |
| **LLM** | a real Gemini call returns a sensible streamed reply |
| Turn/VAD | endpointer unit tests; Silero loads; Turn Detector v1.0 loads |
| **Orchestrator agent** | `build_session()` constructs with **service** backends; a scripted utterance (real clip pushed via the bridge socket) drives one full turn → transcript → Gemini reply → TTS PCM out |
| Web `/pipeline` | in a real browser, mic → real transcript → real Gemini → real spoken reply, timing panel populated |
| Vexa bridge | live meeting: speech in → agent responds in-meeting; barge-in interrupts TTS |
| Evals | `run.py` produces `report.json` with real WER/latency on real audio |

**Rule:** report each gate's actual result (pass/fail with the real output), never "code complete" as a substitute.

---

## 11. Build order

1. `packages/common` (§6) + its tests.
2. `services/stt` (§7b) — predownload, engine, app; **pass the STT gate with real speech**.
3. `services/tts` (§7d) — engine, app; **pass the TTS gate** (intelligible playback).
4. Orchestrator backends: `stub`, `stt_client`, `tts_client`, `llm_litellm` (§7c–e) + factory (§7h); **LLM gate** with real Gemini.
5. Web test pages (§7i) pointed at the real services; **`/pipeline` gate** in a browser.
6. Turn/VAD wrappers; LiveKit agent assembly (§7f) — **VERIFY every LiveKit API**; **agent gate** with a scripted real clip.
7. Vexa patch + bridge (§7g); **bridge gate** in a live meeting.
8. Evals (§7j); deployment (§9); **eval gate** on real audio.

---

## 12. Final checklist

- **Never** co-install `nemo` + `kokoro` + `livekit` + the app in one venv. One heavy lib per service.
- **Never** lazy-download models in the request path; pre-download with `HF_HUB_DISABLE_XET=1` + resumable `snapshot_download`; verify files exist.
- **Never** substitute an off-stack model; fix the environment instead.
- **Never** `import tests.*`; use pytest fixtures.
- **Never** validate STT/TTS with synthetic tones; use real speech.
- **Never** call something "done" because code compiles; the validation gate (real input) is the definition of done.
- **Always** treat LiveKit APIs as version-specific; pin `livekit-agents` and VERIFY the node/turn-detector APIs in §7f against it.
- **Always** keep the audio format identical end-to-end: s16le / 16 kHz / mono / 20 ms / 640-byte frames.
