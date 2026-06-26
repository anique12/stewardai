# StewardAI

A voice-driven **personal AI assistant**. It attends meetings on your behalf — listening, understanding, and speaking in real time — and (in later phases) handles the work around them: scheduling, email, reminders, and tasks.

> **Status:** Design phase. The build-ready spec for Phase 1 (the real-time voice meeting core) lives in
> [`docs/specs/2026-06-26-stewardai-voice-core-design.md`](docs/specs/2026-06-26-stewardai-voice-core-design.md).

## What this is (Phase 1)

A low-latency cascaded voice agent — **STT → LLM → TTS** with audio-based turn detection — orchestrated by **LiveKit Agents**, fed live meeting audio from **Vexa**. Built **Linux-native** (PyTorch / NeMo / ONNX), **device-parameterized** so the *same code* runs on CPU for development and flips to GPU for production with one env var.

## Separation of concerns

Four independent components behind clean interfaces, each developed/tested/swapped on its own:

- **STT** — speech → text (NVIDIA Parakeet TDT 0.6B v3, English)
- **TTS** — text → speech (Kokoro)
- **LLM** — reasoning (hosted API)
- **Vexa bridge** — live meeting audio in / agent voice out

Plus: three **test pages** (`/stt`, `/tts`, `/pipeline`), an **eval** harness, and **structured logging** throughout.

## Relationship to `standin`

StewardAI is a **separate product/repo** from the existing `standin` project. They are kept independent.

## Roadmap

- **Phase 0** — validation spikes (bridge end-to-end, latency, AudioWorklet, barge-in)
- **Phase 1** — real-time voice meeting core *(current build scope)*
- **Phase 2** — post-meeting actions: calendar/scheduling, email, reminders (LLM tool-calling)
- **Phase 3** — proactive assistant, multi-channel
