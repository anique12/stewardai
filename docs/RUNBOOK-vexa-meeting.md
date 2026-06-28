# Runbook — talk to your StewardAI agent in a Vexa meeting (v1)

This is the end-to-end path to **join a meeting and talk to the agent**. The code is
complete, compiles, and is unit-tested; the **live meeting is the one thing only you
can run** (it needs your meeting URL + the bot's sign-in). Read the "Caveats" section
— a first run is likely to need a little iteration on wiring, not code.

## The shape (what talks to what)

```
You + humans in the meeting
        │ (everyone's audio)
        ▼
Vexa bot (Chromium, patched)  ──teemeeting PCM (16 kHz)──▶  StewardAI agent (run_meeting)
        ▲   plays agent PCM      ◀──agent TTS PCM (same socket)──   STT → gated LLM → TTS
        │   into the meeting                                         (speaks only when addressed)
        └── mic_on / mic_off / speak_stop  ◀── Redis (bot_commands:meeting:<id>)
```

- **Agent** = a process you start (`scripts/run_meeting.sh`). It LISTENS on `BRIDGE_TCP_PORT` (8765).
- **Bot** = the patched Vexa bot. Its forwarder DIALS the agent, tees meeting audio in,
  and plays the agent's TTS back. Control (mic/stop) crosses over Redis.

## Prerequisites

1. **Agent box** with the `[cuda]` (or `[cpu]`) extra installed and a `GEMINI_API_KEY` in `.env`.
   (You've been running this as the GPU box / `run_gpu.sh`.)
2. **Vexa deployment** running (your `~/vexa/deploy/compose` stack: redis, runtime-api,
   transcription-service, tts-service, etc.).
3. **The patched bot image**, built from the vexa branch this work created:
   `feat/steward-fullduplex` in `/Users/aniquesabir/vexa` (commit `08999eaf`).

## Step 1 — Build the patched bot image

```bash
cd ~/vexa
git checkout feat/steward-fullduplex     # the StewardAI full-duplex bridge patch
cd services/vexa-bot/core && npm install && npm run build   # type-checks clean (net 0 new errors)
cd ~/vexa && docker compose build vexa-bot                  # or your bot service name
```
> The patch is **additive and gated**: with `STEWARD_BRIDGE_ENABLED` unset/false the bot
> behaves exactly as stock Vexa. Everything below only activates when you set it `true`.

## Step 2 — Configure `.env` on the agent box

```bash
# Backends (real models for a meeting)
DEVICE=cuda
STT_BACKEND=whisper           # or parakeet (needs the parakeet extra)
TTS_BACKEND=kokoro            # or chatterbox (needs the chatterbox extra)
GEMINI_API_KEY=...            # already set

# Vexa wiring
VEXA_MEETING_ID=<the meeting's Vexa internal id>   # MUST match the bot's command channel — see Step 4
REDIS_URL=redis://<vexa-redis-host>:6379           # the same redis the bot subscribes on
BRIDGE_TCP_HOST=0.0.0.0       # agent listens on all interfaces so the bot can reach it
BRIDGE_TCP_PORT=8765
```

## Step 3 — Start the agent (it waits for the bot)

```bash
bash scripts/run_meeting.sh
```
You'll see `meeting_agent_boot` then `meeting_agent_started`. It now listens on 8765 and
blocks until the bot connects. (First start loads the STT/TTS models — give it a moment.)

## Step 4 — Launch a bot into your meeting, pointed at the agent

Use your normal Vexa "create bot" call (runtime-api `POST /bots` or the Vexa CLI), with
the bot configured so its forwarder reaches the agent. The bot needs these env/config:

```
STEWARD_BRIDGE_ENABLED=true
BRIDGE_TRANSPORT=tcp
BRIDGE_TCP_HOST=<how the bot container reaches the agent>   # see network note
BRIDGE_TCP_PORT=8765
```

**Network note (the trickiest bit):** the bot runs in a container; it must reach the
agent process:
- **Agent on the same host as Docker (Linux):** set `BRIDGE_TCP_HOST` to the host's
  docker-bridge gateway (often `172.17.0.1`), or run the bot with `--network host`, or
  attach the agent to the `<project>_vexa` network and use its container hostname.
- **Mac/Windows Docker Desktop:** `BRIDGE_TCP_HOST=host.docker.internal`.

**`VEXA_MEETING_ID` note (must match):** the agent publishes mic/stop on
`bot_commands:meeting:<VEXA_MEETING_ID>`; the bot subscribes on
`bot_commands:meeting:<its meeting id>`. Set the agent's `VEXA_MEETING_ID` to the **same
internal meeting id Vexa assigns the bot** (you'll see it in the bot's startup logs / the
`POST /bots` response). If they differ, audio will flow but the agent can't toggle the mic.

## Step 5 — Talk to it

Once the bot has joined and connected (agent log shows `client_connected`), speak in the
meeting and address it by name/wake word:

> "Hey StewardAI, can you summarize what we've discussed?"

It stays silent during normal chatter and answers when addressed (it's been listening the
whole time, so it has the meeting context). Interrupt it by speaking — it stops (~0.5–1 s,
see caveats).

## Sanity checks you CAN run without a meeting

```bash
.venv/bin/python -m pytest -m "not heavy" -q          # 58 pass: bridge/decide/runner wiring
.venv/bin/python -m pytest tests/agent -m heavy -q     # gated node + fake-bot e2e (silent→0 bytes, speak→PCM)
# the decide smoke (stay-silent on chatter, speak when named) — see scripts / scratchpad smoke_decide.py
```

## Caveats — what is NOT yet verified, and known limits

- **No live meeting has been run.** Agent + bot are compile-clean and unit-tested; runtime
  behavior in a real meeting is unverified. Expect to iterate on Step 4 wiring first.
- **Start with Google Meet, not Teams.** The Teams inbound audio tap is the highest-risk
  part of the bot patch (its DOM audio routing differs); Meet/Zoom are the safer first test.
- **Barge-in stops in ~0.5–1 s, not instantly** — audio already in WebRTC/jitter buffers
  can't be pulled back. Keep the agent's replies short. (Mute-first trims this toward ~150–300 ms.)
- **Forwarder reconnect is NOT handled (single connection per meeting).** If the bot drops
  and reconnects, the agent ignores the new connection — restart the agent + relaunch the
  bot if a meeting's audio goes dead. (Documented fast-follow; see the design spec.)
- **Vexa's own Whisper still runs** (we didn't disable `transcribeEnabled`) — harmless
  duplicate STT CPU; set `transcribeEnabled=false` in the bot config to save it.
- **Mic onset:** `mic_on` is sent just before the first audio frame, so the first few tens
  of ms of a reply can clip — inaudible in practice, noted for tuning.

## If something's off
- Agent log `client_connected` never appears → the bot can't reach `BRIDGE_TCP_HOST:PORT` (network note).
- Agent speaks but the meeting can't hear it → `VEXA_MEETING_ID` mismatch (mic never unmuted) or the bot's pactl/`tts_sink` setup.
- Agent never speaks → check `GEMINI_API_KEY`, and that you addressed it by the wake word; watch for `llm_decide speak=...` log lines.
```
