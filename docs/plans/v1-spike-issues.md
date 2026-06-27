# v1 Spike — Issues Log (feeds the v2 plan)

**Purpose:** v1 (the monolith) is a **spike** to surface real-world issues before building v2 cleanly. Every issue we hit while completing the v1 pipeline gets logged here. Periodically, the **(A) architectural/portable** ones are folded into `2026-06-27-implementation-plan-v2.md`; the **(B) Mac/env-only** ones are recorded but must NOT influence v2's design (v2 runs on isolated Linux services).

**Discipline:** in v1, apply the *minimal* workaround to keep moving; the proper fix lives in v2. Do not gold-plate v1.

**Type legend:** **A** = architectural/portable (update v2) · **B** = Mac/environment-only (do not let it shape v2) · **OPS** = tooling/process.

| # | Issue | Where | Root cause | v1 workaround | v2 fix / plan section | Type | Folded into v2? |
|---|---|---|---|---|---|---|---|
| 1 | Installing NeMo downgraded shared deps (`numpy` 2.5→2.4.6, `jiwer` 4.0→3.1.0) and pulled a huge tree | shared venv | One `pip` must satisfy all heavy libs at once | accept the downgrades | Isolate each heavy backend in its own service/image | **A** | ✅ §3, §4.1 |
| 2 | `from tests.conftest import …` broke — a NeMo dep shipped a top-level `tests` package that shadowed ours | pytest collection | Cross-module test import collides with installed `tests` | converted helpers to pytest **fixtures** | Fixtures, never `import tests.*` | **A** | ✅ §4.5 |
| 3 | Parakeet model download **stalled** at 64 MB/2.4 GB (no error) | HF download | HF **xet** transfer layer stalled; lazy download hid it | `HF_HUB_DISABLE_XET=1` + resumable `snapshot_download` | Explicit pre-download step, xet disabled, verify files before "ready" | **A** | ✅ §4.4, §7b predownload |
| 4 | Background launch reported "done" immediately while pip kept running | `nohup … &` inside a backgrounded task | double-backgrounding detaches from completion tracking | run the long cmd directly under one background mechanism | n/a (build-process hygiene) | **OPS** | n/a |
| 5 | Unix-domain-socket IPC unreliable between Docker VM and host on macOS | Mac dev | macOS Docker networking | use **TCP** locally on Mac | UDS is correct on a **native Linux** host; Mac is not the target | **B** | noted (do NOT change v2) |

## Open / expected (to be confirmed as we complete v1)

- **Kokoro TTS:** needs system `espeak-ng` (`brew`/`apt`); confirm exact voice ids (`af_heart`, …) and the streaming API (`KPipeline(lang_code="a")`, per-segment `.audio`). → likely **A** (record real API in v2 §7d).
- **LiveKit Agents:** verify the node base-class APIs (`stt.STT._recognize_impl`, `llm.LLMStream`, `tts.ChunkedStream._run` signature), the Turn Detector v1.0 class path, and roomless `session.start(agent=…)` with `session.input.audio` set. → **A** (pin versions + record verified APIs in v2 §7f).
- **Vexa bridge:** AudioWorklet injection in the Playwright/headless-Chrome context; the Meet/Teams combined-stream tap; echo/mute handshake during barge-in. → mix of **A** (protocol/design) and **B** (Vexa/Chrome specifics).

## Cadence
After each v1 milestone (STT ✓ → TTS → VAD/turn → LiveKit agent → Vexa bridge → full loop), append issues here and fold the **A** items into the v2 plan. Build v2 only once the v1 pipeline runs end-to-end and this log has stabilized.
