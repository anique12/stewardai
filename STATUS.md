# StewardAI — Build Status (Phase 1)

_Last updated: 2026-06-27 (overnight autonomous build)_

## TL;DR

The full Phase-1 codebase is implemented and committed. **It runs today on a laptop with no GPU and no heavy ML deps** — stub STT/TTS + **real Gemini LLM** + the web test pages + evals all work. The **real** STT (Parakeet/NeMo) and TTS (Kokoro), the LiveKit agent loop, and the live Vexa bridge are fully authored but need the CPU/GPU box + a live meeting to install-and-validate (as expected — no box existed at build time).

## What was validated tonight (on the Mac, base install)

| Check | Result |
|---|---|
| `pytest -m "not heavy"` | ✅ **39 passed, 3 skipped (heavy)** |
| `ruff check src web evals tests` | ✅ clean (after fixes) |
| Eval harness `python -m evals.run` (stubs) | ✅ STT wer=0, TTS ttfa≈0.15ms, E2E recall=1.0 → `evals/report.json` |
| Web server live boot | ✅ `/`, `/api/voices`, `/api/tts` (valid RIFF WAV) all 200 |
| **Real Gemini call** (LiteLLM, your key) | ✅ model `gemini/gemini-2.5-flash-lite`, replied correctly |

## Architecture as built

Four components behind `Protocol` interfaces (`src/stewardai/interfaces.py`), selected by env via `factory.py`. Every component has a **stub** (no heavy deps) and a **real** backend. `DEVICE=cpu|cuda` is the only compute switch; no MLX/Apple code.

- **STT** — `stt/stub.py` (works) · `stt/parakeet_nemo.py` (`ParakeetNeMoSTT`, NeMo, batch-behind-VAD; needs `[cpu]`/`[cuda]`)
- **TTS** — `tts/stub.py` (works) · `tts/kokoro.py` (`KokoroTTS`, streaming 16 kHz; needs extra)
- **LLM** — `llm/stub.py` · `llm/litellm_client.py` (**works now**, Gemini via LiteLLM; switch model with `LLM_MODEL`)
- **Turn** — `turn/endpointer.py` (energy endpointer for the web pipeline; works)
- **Bridge** — `bridge/{transport,audio_output,vexa_client}.py` (light, tested) · `bridge/audio_input.py` (`PushAudioInput`, `SocketAudioBridge`; needs livekit)
- **Agent** — `agent/{nodes,assembly}.py` (roomless LiveKit `AgentSession`; needs livekit)
- **Web** — `web/app.py` + `web/static/*` (3 test pages; works on stubs)
- **Evals** — `evals/*` (works on stubs)
- **Vexa patch** — `vexa-patch/*` (copy-paste integration artifacts; framing matches `bridge/transport.py`)

## How to run (now, on any machine)

```bash
scripts/setup.sh                 # base venv (no heavy ML)
cp .env.example .env             # add GEMINI_API_KEY (already copied locally)
scripts/run-web.sh               # http://localhost:8080
.venv/bin/python -m pytest -m "not heavy" -q
.venv/bin/python -m evals.run
```
The `/pipeline` page works end-to-end **now**: mic → stub STT → **real Gemini** → stub TTS (a tone), with a live timing panel.

## Next steps (the box)

1. **Provision the CPU box** (GCP `e2-standard-8`, x86) → `scripts/setup.sh cpu` to install real Parakeet + Kokoro + LiveKit.
2. **Flip backends**: `STT_BACKEND=parakeet_nemo`, `TTS_BACKEND=kokoro`, `TURN_DETECTOR=silero`. Run `pytest` (heavy tests now execute) and the `/pipeline` page with real models. Measure latency.
3. **Vexa bridge**: apply `vexa-patch/` to the vexa-bot image, run a live meeting, validate the socket → `PushAudioInput` → agent → `tts_sink` loop and barge-in.
4. **GPU**: `scripts/setup.sh cuda` + `DEVICE=cuda` (zero code change) for the latency targets.

## Known caveats & API points to verify on the box

These are authored against documented/assumed APIs (no heavy deps locally to run them); verify when the extras are installed:

- **NeMo STT**: confirm `ASRModel.from_pretrained` kwarg, the `transcribe()` return shape (`list[str]` vs `Hypothesis.text`), and device placement. (`stt/parakeet_nemo.py` handles both return shapes.)
- **Kokoro TTS**: confirm voice ids (`af_heart`, `af_bella`, `am_michael`, `bf_emma`) and the streaming API (`KPipeline(lang_code="a")`, per-segment `.audio`). Tuple/`.audio` fallbacks coded.
- **LiveKit agent** (`agent/nodes.py`, `agent/assembly.py`): verify the STT/LLM/TTS node base-class method names (`_recognize_impl`, `LLMStream._run`/`ChatChunk`, `ChunkedStream._run`/`output_emitter`), the turn-detector class path (`turn_detector.multilingual.MultilingualModel`), and roomless `session.start(agent=...)` with `session.input.audio` set. Full list in the git history / agent notes.
- **Vexa Meet/Teams tap**: the combined-mix AudioWorklet is the one genuinely new browser graph — needs live validation. Zoom `parecord` tap insertion point verified at `audio-pipeline.ts:410`.
- **macOS only**: `AF_UNIX` socket paths are length-limited (~104 chars); use a short `BRIDGE_SOCKET_PATH` (e.g. `/tmp/stewardai.sock`) or `BRIDGE_TRANSPORT=tcp` on Mac.
- **soundfile** is a base dep (always present); STT/TTS extras rely on it.

## Resolved PRD open questions

- **LLM**: Gemini via LiteLLM — working, resolved model `gemini/gemini-2.5-flash-lite` (from your `GEMINI_MODEL`). Change `LLM_MODEL` to switch.
- **Kokoro default voice**: `af_heart` + alternates exposed in the TTS page.
- **STT eval dataset**: a self-generating synthetic stub set (`evals/datasets/`) for wiring checks; README documents how to drop in a real labeled set for true WER.
