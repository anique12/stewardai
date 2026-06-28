# Turn-taking & barge-in — complete architecture

## The mental model

Natural conversation needs the agent to know two things **accurately and in real time**:

1. **Is the user speaking / done?** (INPUT side)
2. **Is the agent's audio actually playing / finished?** (OUTPUT side)

LiveKit's `AgentSession` is built to handle (1) and all the *decision* logic. The
catch: it can only know (2) if **it controls playback** — i.e. a LiveKit WebRTC
room where the client SDK reports real playback. We run **roomless** (browser
WebSocket now, Vexa meeting later), so LiveKit cannot measure our playback. That
gap is the source of every barge-in bug we've hit.

## What LiveKit owns — we only CONFIGURE, never reimplement

| Concern | Owned by LiveKit | We set |
|---|---|---|
| Speech vs silence | Silero VAD | `vad_activation_threshold`, `min_speech_duration` |
| End-of-utterance / turn | Turn detector + endpointing | `turn_min_delay`, `turn_max_delay` |
| Interruption **detection** | VAD / adaptive detector | `interruption.mode`, `min_words`, `min_duration` |
| Cancel LLM+TTS on barge-in | AgentSession | — (it just works; `llm_cancelled` proves it) |
| Resume vs commit a barge-in | false-interruption logic | `resume_false_interruption` |
| Backchannel handling | adaptive detector | `backchannel_boundary` |
| Conversation history | ChatContext | — |

We have spent effort here that should NOT be custom code — it's all `turn_handling`
config. Rule: **if it's a decision about *when* to listen/stop/respond, it's LiveKit's.**

## What ONLY we can do (because our transport is custom, not a LiveKit room)

1. **Feed input audio** — `PushAudioInput` (browser/Vexa PCM → session input).
2. **Pace agent audio out at real time** ⚠️ — LiveKit pushes TTS frames to the
   output *faster than real time*; a WebRTC track would emit them at 1×. Our
   `QueueAudioOutput` + `_pump_output` **don't** — they dump the whole reply to the
   client at synthesis speed.
3. **Report true playback position** back to the session — so "is the agent
   speaking?" and "is it done?" are correct. LiveKit can't see remote playback.
4. **Stop the real player on interruption** — forward `clear_buffer()` to the client
   (browser flush / Vexa stop) and drop the un-played backlog.
5. **Echo handling** — AEC (a LiveKit client gives this free; raw WS doesn't) or, for
   Vexa, input-gating while the agent speaks.

## THE bug we kept hitting

`_pump_output` = `async for frame in audio_out: ws.send_bytes(frame)` — **no pacing.**
TTS synthesizes a long reply in ~seconds; all of it is shoved to the browser at once.
Consequences, all of which we misdiagnosed as separate problems:
- Browser buffers the *entire* reply → barge-in "doesn't stop" (everything's already sent).
- Playback timing is wrong → the gapless-cursor estimate fights reality.
- A long reply floods the socket → `keepalive ping failed` → disconnect ("stops listening").

`max_tokens` only shrank the flood. The real fix is to **pace the output and keep the
backlog server-side.**

## Solution — a correct paced output bridge

Treat the output queue as the **real-time playout buffer**, and make the *sender* the
single source of truth for playback (mirrors LiveKit's own avatar `QueueAudioOutput`,
where the external player reports playback):

- `capture_frame(frame)` → enqueue (no timing).
- `flush()` → enqueue a **segment-end marker**.
- **Paced sender** (the drain loop): send a frame, then pace to ~real time, keeping
  only a small look-ahead (e.g. 200–300 ms) buffered on the client. When it passes a
  segment-end marker, call `on_playback_finished(...)` — accurate, because send rate ≈
  play rate.
- `clear_buffer()` (barge-in) → **drop the un-sent queue** (most of a long reply is
  still server-side, never sent), report the pending segment interrupted, and signal
  the client to flush its small look-ahead. → Instant, clean stop **for any reply
  length**, and the socket never floods.

With this, **reply length is irrelevant** — a 2-minute answer streams at 1× and a
barge-in at second 3 stops it instantly. No `max_tokens`, no monologue special-casing.

## Every scenario, and who handles it

| # | Scenario | Handler | Our job |
|---|---|---|---|
| 1 | User talks → stops → agent replies | LiveKit (VAD+EOU) | feed input; report playback so it knows the agent is idle |
| 2 | Barge-in on a short reply | LiveKit cancels | paced send + clear → stop |
| 3 | Barge-in on a LONG reply | LiveKit cancels | **paced send keeps backlog server-side → drop it = instant stop** |
| 4 | Brief noise / backchannel | LiveKit (resume / min_words) | config only |
| 5 | Agent finishes → next turn | LiveKit | accurate playback-finished from the paced sender |
| 6 | User talks while agent is *thinking* (pre-TTS) | LiveKit cancels LLM | nothing |
| 7 | Rapid back-to-back turns | LiveKit | paced send + clear per turn |
| 8 | Agent hears itself (echo) | — | AEC (LiveKit client) / input-gating (Vexa) / headphones (test) |
| 9 | Transport degrades | (room: LiveKit) | backpressure (paced send) + reconnect on our WS |
| 10| Long reply, no barge-in | LiveKit (TTS) | paced send so it streams 1× without flooding |

## The one architectural fork

- **Browser voice UI:** could use a **LiveKit room + `livekit-client`** → LiveKit owns
  pacing, playback truth, AEC, backpressure. Zero custom audio code. Needs a LiveKit
  server (self-host OSS or Cloud).
- **Vexa meeting (the actual product):** the transport **is** Vexa, not a room — so we
  own the paced output bridge regardless. Therefore: **build the paced bridge correctly
  once** (it's small), reuse it for both browser and Vexa, and treat a LiveKit room as
  an optional later upgrade for the standalone browser UI only.

## Concrete remaining work (in priority order)

1. ~~Paced output sender~~ — **DONE** (`QueueAudioOutput.paced_frames`): sends at ~1×
   real time, keeps the backlog server-side, reports `playback_finished` per segment as
   it's sent, drops the backlog on `clear_buffer`. Verified: 1s of audio drains in ~0.9s
   (not instantly), 1 playback_finished per segment, clear reports interrupted + flushes.
2. **Client flush on `clear_buffer`** — already wired; keep.
3. **Reply length** — leave UNbounded; pacing makes it a non-issue. (No `max_tokens`.)
4. **Echo** — test path: headphones; Vexa path: input-gating while speaking.
5. **WS resilience** — reconnect handling on the browser client.

Everything else stays LiveKit's. Builds on [[project_stewardai_pipeline]].
