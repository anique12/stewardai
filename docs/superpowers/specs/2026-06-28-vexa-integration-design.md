# Vexa Integration Design — StewardAI meeting voice agent

**Status:** Design (approved direction, pending spec review)
**Date:** 2026-06-28
**Depends on:** the existing StewardAI voice core (LiveKit `AgentSession`, STT/LLM/TTS backends, `SocketAudioBridge`, paced-output bridge) and a self-hosted Vexa deployment.

## Goal

Make a StewardAI voice agent participate in a real meeting through Vexa: it
**always listens** to the whole meeting (transcribing every speaker into LLM
context) and **speaks only when the LLM decides to** (it was addressed / a
response is useful). Our own STT, LLM, and TTS run the show; Vexa's bot is the
transport that carries raw audio into and out of the meeting.

This is the "v1 spike": one meeting, one bot, one agent, started manually.
Multi-meeting orchestration and hardening are explicitly out of scope (below).

## Background — what Vexa is and what it actually exposes

Vexa's bot is a headless Chromium/Playwright container (TypeScript,
`services/vexa-bot/core/`) that joins a Google Meet / Teams / Zoom meeting. Two
independent reviews of the Vexa codebase established the following load-bearing
facts (these shaped the design and corrected our initial assumptions):

1. **There is no single "combined meeting PCM" available to tap** for Google
   Meet / Teams. The combined stream is mixed *in the browser* and immediately
   encoded to webm/opus; only the recording-upload path sees it. What *is*
   available as clean raw PCM in Node is the **per-speaker** stream: the browser
   sends each speaker's audio, already resampled to **16 kHz mono Float32**, to
   `handlePerSpeakerAudioData()` (`index.ts:~1556`). (Zoom Web additionally has a
   combined raw PCM via a `parecord` subprocess, but per-speaker is the portable
   path.)
2. **The bot can already play externally-supplied raw PCM into the meeting**,
   bypassing its own TTS service: `tts-playback.ts` has `playPCM()` and
   `startPCMStream()` that pipe raw PCM straight to a PulseAudio `tts_sink`
   (→ `virtual_mic` → Chromium mic). Header comment confirms intent: *"Raw PCM
   playback (from external agents with their own TTS)."*
3. **Mic control is decoupled** from TTS. `MicrophoneService`
   (`microphone.ts`) exposes `unmute()` / `mute()` / `scheduleAutoMute()` with
   the per-platform mic-button choreography; it is not wired into the TTS path
   except at the call site (`index.ts:~1013-1031`).
4. **Bots run on a shared Docker bridge network** (`<project>_vexa`), are spawned
   per-meeting by `runtime-api` (container name embeds the meeting id), and are
   controlled over **Redis pub/sub** (`bot_commands:meeting:{id}`; events on
   `va:meeting:{id}:events`).
5. **The bot runs its own Whisper** per-speaker pipeline, gated by
   `transcribeEnabled`. We can avoid duplicate STT cost, but the per-speaker
   *capture* must stay on because that is our audio tap (see Decisions).

**Implication:** the natural Vexa integration is **per-speaker raw audio in over
a socket, raw PCM out over a socket, and mic on/off + stop over Redis** — all
additive patches to the bot. Vexa keeps owning meeting join/admission, WebRTC,
and the per-platform mic-button clicking.

## Chosen architecture — "full pipeline, separate service" (a.k.a. 3b-full / topology A)

Two processes on the **same GPU VM**, on Vexa's **shared Docker network**:

```
┌─────────────────────────── Vexa bot container (patched, additive) ───────────────────────────┐
│  Chromium ⇄ meeting (WebRTC)                                                                   │
│   • per-speaker capture (16k mono f32) ──tee──▶ [TCP audio-out socket] ─┐                      │
│   • tts_sink ◀── startPCMStream ◀── [TCP audio-in socket] ◀────────────┐│                     │
│   • MicrophoneService.unmute/mute ◀── Redis bot_commands ◀───────────┐ ││                     │
└──────────────────────────────────────────────────────────────────────┼─┼┼─────────────────────┘
                                                                         │ ││
┌──────────────────────── StewardAI agent service (our stack) ──────────┼─┼┼─────────────────────┐
│  audio-out socket ▶ PushAudioInput ▶ AgentSession                      │ ││                     │
│     STT(per speaker) ▶ running transcript (LLM context)                │ ││                     │
│     turn detector ── per-utterance "decide" trigger ─▶ LLM (tools) ────┘ ││                     │
│     LLM tool: stay_silent | speak(text)                                  ││                     │
│         speak ▶ TTS ▶ paced-output bridge ▶ [TCP audio-in sender] ───────┘│                     │
│         barge-in / clear ▶ Redis speak_stop (control channel) ────────────┘                     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Ownership split.** Vexa owns: join/admission, WebRTC, per-platform mic-button
clicking, PulseAudio routing. **We own:** STT, the running transcript/context,
the respond-or-not decision, the LLM, TTS, and output pacing.

**Transport.** Audio crosses as length-prefixed PCM frames over **TCP on the
shared Docker network** (the two containers reach each other by container
hostname; not a Unix socket — that would require an invasive bind-mount through
Vexa's bot-launch path). Control (`speak_stop`, `mic_on`,
`mic_off`) crosses over **Redis**, the channel Vexa already uses — and crucially
**separate from the PCM stream**, so a barge-in stop never queues behind audio
backlog. Same-VM/same-network transit is sub-millisecond and is not a meaningful
latency contributor.

## Interaction model — always-listening context, LLM-gated output

The agent is **always listening** and **silent until the LLM chooses to speak**:

- **Input is never gated.** Every speaker is transcribed continuously and appended
  to a running, speaker-labelled transcript that forms the LLM's context. The
  agent always "knows" what has been said.
- **The respond-or-not decision lives in the LLM, via tool calling.** The wake
  word and the "only answer when addressed" rule are **prompt instructions**, not
  hard-coded matching. The LLM is given two tools:
  - `stay_silent()` — the default; it was not addressed, or nothing needs saying.
  - `speak(text)` — it was addressed / a response is useful; `text` is spoken.
  This same tool-calling seam later carries real tools (schedule, summarize, …).
- **The turn detector is the *trigger*, not the responder.** We invoke the LLM
  "decide" call at each **finished utterance** (per-speaker end-of-speech from the
  turn detector). The turn detector's only job is "someone just finished a
  sentence — ask the LLM whether to respond." It is *not* used to arbitrate
  whose turn it is to speak.

This model deliberately sidesteps the two hardest problems the reviews surfaced:
multi-speaker turn-taking (we never try to grab a turn; we act only when the LLM
decides) and barge-in (the agent rarely talks, so talk-over is rare).

## Components

### 1. Vexa bot patches (additive only)

| Patch | What | Where (reference) |
|---|---|---|
| **Audio tee-out** | Forward each per-speaker 16 kHz Float32 buffer to a TCP audio-out socket | inside `handlePerSpeakerAudioData`, `index.ts:~1556` (already 16k mono f32, per speaker, pre-consumer) |
| **PCM sink-in** | New `speak_pcm` command: open `startPCMStream(rate,1,'s16le')` and pump bytes from the TCP audio-in socket to `tts_sink` | reuse `tts-playback.ts:startPCMStream` (~111); add action in dispatch `index.ts:~564`; `speak_stop`→`interrupt()` already wired (`~574-580`) |
| **Mic signals** | New `mic_on`/`mic_off` commands driving `MicrophoneService` | `microphone.ts` `unmute()`/`mute()`/`scheduleAutoMute()`; reference choreography `index.ts:~1013-1031` |
| **Disable duplicate STT (optional)** | Keep per-speaker *capture* on (it's our tap) but stop submitting to Vexa's Whisper to save CPU | `transcribeEnabled` gate `index.ts:~2605` — note: fully off makes `handlePerSpeakerAudioData` early-return, so disable only the Whisper *submission*, not the capture |

These patches are maintained as a small Vexa fork; the bot Docker image is rebuilt.

### 2. StewardAI agent service (our existing stack, adapted)

- **Audio in:** `SocketAudioBridge` frame **server** receives per-speaker PCM and
  feeds `PushAudioInput` → `AgentSession`. (Mostly unchanged; it already is a
  socket-fed server.)
- **STT → transcript context:** our STT (Whisper large-v3 / Parakeet v3) transcribes
  per speaker; results accumulate into a speaker-labelled running transcript held
  as the LLM's context.
- **Decide loop:** on each per-speaker end-of-utterance, call the LLM with the
  context and the `stay_silent` / `speak` tools. Use a **cheap, fast model**
  (e.g. `gemini-2.5-flash-lite`) for this high-frequency decision. Tiered routing
  (cheap decide → stronger model for hard answers) is a documented future upgrade,
  not v1.
- **Speak path:** on `speak(text)` → TTS (Kokoro/Chatterbox) → **paced-output
  bridge** → TCP audio-in **sender** → bot `startPCMStream`. Before the first
  frame, emit `mic_on`; after playout, emit `mic_off` (on a short delay — see
  Limitations).
- **Barge-in / clear:** if the agent is speaking and the addressed speaker resumes,
  `clear_buffer` drops our server-side backlog **and** emits `speak_stop` over the
  Redis control channel; the bot `interrupt()`s playback.

### 3. New plumbing this requires (gaps the reviews found)

- **Outbound frame sender** in `bridge/transport.py` — today it has frame *servers*
  (inbound) only. We need the symmetric length-prefixed PCM **client/sender** that
  connects to the bot and streams paced frames.
- **Drive the meeting output off `paced_frames()`**, not the unpaced `_drain` path.
  Today `assembly.run_agent` (`~191-245`) wires meeting output to a **local**
  `SinkPlayer` (unpaced, in-container `paplay`). For topology A the output must be
  the paced bridge writing to the TCP sender. `SinkPlayer` stays only as the
  in-container/dev fallback.
- **`clear_buffer` → `speak_stop`** over Redis (the bot already handles
  `speak_stop`), on the control channel, never behind PCM frames.

## Sample-rate contract (must be explicit — silent mismatch = chipmunk audio)

- **Capture (Vexa → us):** already **16 kHz** mono Float32 — matches our canonical
  `SAMPLE_RATE`; no resample needed inbound.
- **Playback (us → Vexa):** our TTS (Kokoro/Chatterbox) is natively **24 kHz**, and
  the bot's `paplay` PCM paths default to **24 kHz**. So lock the playback path to
  **24 kHz end-to-end**: the paced bridge's frame `sample_rate`, the TCP sender's
  declared rate, and the bot's `startPCMStream` rate must all be **24 kHz** and
  equal. (`paced_frames` derives timing from the frame's `sample_rate`; a mismatch
  drifts both pitch and the playback-finished accounting.)
- **Do not** use `common/audio.py:resample_linear` ("adequate for stubs/tests") on
  the production playback path; use a proper resampler if any resample is needed.

## Known limitations / realism (set expectations now)

- **Barge-in is ~0.5–1 s, not instant.** Through `paplay` → PulseAudio sink →
  remap → Chromium → WebRTC encode → far-end jitter buffer, ~250–600 ms of audio is
  already in-flight and unrecoverable when we stop, plus the control round-trip.
  This is inherent to *any* bot speaking in a meeting, not a flaw in our approach.
  Mitigations: keep replies short, lower `paplay`/Pulse target latency, put
  `speak_stop` on its own low-latency channel. The paced bridge matters **less**
  here than in the browser (Vexa owns most of the downstream buffering) — its real
  remaining value is keeping backlog server-side so we don't flood the socket.
- **LLM-gated output is non-deterministic.** It will occasionally answer when not
  addressed or miss a cue; tuned via prompt, iterated post-v1.
- **Decide-call cost.** One LLM call per utterance in a busy meeting; mitigated by a
  cheap model and (later) tiering.
- **Mic gating tail-clip.** Muting the mic immediately when `paplay` exits clips the
  last word (pipeline still draining). Mute on a **~+300 ms delay** after playout,
  or feed digital silence between utterances. Keep any platform mic-button *click* a
  **one-time session action**, not per-utterance.
- **Echo / self-trigger.** While speaking, the mic is open and the agent's own voice
  is in the meeting; if AEC is imperfect the agent could transcribe itself. Because
  output is LLM-gated (rare) and we can suppress the addressed-speaker's own-audio
  window, this is low-risk for v1 but noted.

## Error handling

- **Audio socket drop / bot restart:** the agent treats a closed audio socket as
  end-of-session for that meeting; it tears down the `AgentSession` cleanly and is
  ready to re-attach when a bot reconnects (pairing by meeting id).
- **Agent crash:** the bot keeps running (it's just a transport + Vexa's own
  features); no agent → no speech, meeting unaffected.
- **LLM timeout / error on a decide call:** default to `stay_silent` (fail safe to
  silence; never emit a half-formed reply). Existing `llm_timeout_s` backstop
  applies.
- **`speak_stop` lost:** the bot's `scheduleAutoMute` + end-of-stream still mute the
  mic; worst case the agent finishes its current short reply.

## Testing strategy

- **Unit:** the new frame sender (round-trips length-prefixed PCM to a fake
  receiver); the decide-loop tool parsing (LLM returns `stay_silent` vs
  `speak(text)`); rate-contract assertions (frame rate == sender rate).
- **Integration (no Vexa):** a **fake bot** — a local TCP server that accepts the
  audio-in sender and a local source that replays a recorded multi-speaker WAV into
  the audio-out socket — exercises the full agent loop (listen → transcript →
  decide → speak) without Chromium. Assert: silence with no wake word; a spoken
  reply after the wake phrase; backlog dropped + `speak_stop` emitted on barge-in.
- **End-to-end:** patched bot in a real (test) meeting; manual: confirm it stays
  silent during chatter, answers on wake word with correct meeting context, and
  stops within ~1 s when interrupted.

## v1 scope

**In scope:** single meeting, one bot + one agent, started manually; per-speaker
audio tee; PCM-in playback; mic on/off + stop over Redis; always-listening
transcript context; LLM-gated `stay_silent`/`speak` via tool calling; our STT +
TTS; addressed-only behavior via prompt; 24 kHz playback contract; the three
plumbing additions; the fake-bot integration test.

**Explicitly deferred:** multi-meeting orchestration / auto-spawn pairing; a
dedicated acoustic wake-word model (v1 lets the LLM recognize the wake word from
the transcript); tiered model routing; speaker-identity-aware addressing beyond
what the transcript labels give; AEC hardening; production resilience/scaling;
the in-container (topology B) deployment.

## Key decisions & rationale (summary)

- **Per-speaker audio, not a mixed stream** — it's the only clean raw-PCM tap *and*
  it preserves the single-speaker assumption our turn detector needs.
- **LLM decides (tool calling), not hard-coded wake matching** — more natural
  (semantic address, follow-ups), and the same seam carries future tools.
- **Turn detector demoted to a trigger** — narrow job it's good at; no multi-speaker
  turn arbitration.
- **TCP on the shared Docker network, not Unix socket** — avoids an invasive
  bind-mount; latency identical (sub-ms, same host).
- **Control over Redis, separate from PCM** — Vexa's existing channel; keeps
  `speak_stop` off the audio backlog.
- **24 kHz playback end-to-end** — matches both our TTS and the bot's `paplay`.
- **Cheap model for the decide loop** — it runs per-utterance; tiering deferred.
