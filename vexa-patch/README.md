# Vexa → StewardAI audio bridge patch

This directory documents a **thin, additive** patch to the Vexa meeting bot
(`services/vexa-bot/core`) that taps the live meeting audio for all three
platforms (Google Meet, Microsoft Teams, Zoom Web) and forwards it as
length-prefixed PCM frames over a socket to the StewardAI voice agent's bridge
(`src/stewardai/bridge/transport.py`).

Nothing here rewrites Vexa. Every change is **additive**: a new module
(`forwarder.ts`), a new browser worklet (`audioworklet/pcm-worklet.js`), and a
handful of *insertion points* where you `emit` / `postMessage` a copy of audio
that Vexa already has in hand. Vexa's existing recording/upload pipeline is
untouched — we only fan a second copy of the same audio out to StewardAI.

---

## 1. Architecture

```
            ┌──────────────────────── Vexa bot (Chromium + Node) ────────────────────────┐
            │                                                                             │
 Meet/Teams │   ┌──────────────────┐   Float32 PCM @16k    ┌──────────────────────────┐  │
  (browser) │   │ AudioWorklet      │ ───postMessage()────▶ │ browser→Node bridge       │  │
            │   │ pcm-worklet.js    │   20ms s16le frames   │ window.__vexaStewardFrame │  │
            │   └──────────────────┘                        └────────────┬─────────────┘  │
            │                                                            │ (exposeFunction)│
            │   Zoom Web (Node)                                          ▼                 │
            │   ┌──────────────────┐   raw s16le @16k       ┌──────────────────────────┐  │
            │   │ parecord stdout   │ ──── Buffer chunks ──▶ │ forwarder.ts              │  │
            │   │ (PulseAudioCapture)│   (pre-WAV-wrapping)  │  - ensure s16le/16k/mono  │  │
            │   └──────────────────┘                        │  - reslice to 20ms (640B) │  │
            │                                                │  - length-prefix + send   │  │
            │                                                └────────────┬─────────────┘  │
            └─────────────────────────────────────────────────────────────┼───────────────┘
                                                                          │
                                       [4-byte BE uint32 N][N bytes s16le PCM]   (N = 640)
                                                                          │
                                                                          ▼
                                          ┌──────────────────────────────────────────┐
                                          │ StewardAI agent — bridge/transport.py      │
                                          │  TcpFrameServer / UnixFrameServer          │
                                          │  → SocketAudioBridge → LiveKit AgentSession │
                                          └──────────────────────────────────────────┘
```

Key idea: **Vexa already has the audio in the right shape.** Both capture paths
already run at 16 kHz mono:

- **Zoom Web** — `parecord` is spawned with `--format=s16le --rate=16000
  --channels=1` and its stdout is raw s16le PCM *before* Vexa wraps it into 15 s
  WAV chunks. We tap that stdout (see `zoom_tap.md`).
- **Meet / Teams** — the per-speaker capture builds `AudioContext({ sampleRate:
  16000 })` and reads mono `Float32Array`s. For StewardAI we want the *combined*
  meeting mix, not per-speaker streams, so we attach one extra worklet to the
  combined stream (see `audioworklet/pcm-worklet.js`). The worklet downsamples
  to 16 kHz mono and posts 20 ms s16le frames.

`forwarder.ts` is the single normalizer/sender. It accepts frames from either
source, guarantees s16le / 16 kHz / mono / 20 ms (640-byte) framing, and writes
length-prefixed frames to the socket. The wire format matches
`transport.py` byte-for-byte (see §4).

---

## 2. Insertion points (verified against `/Users/aniquesabir/vexa`)

> Line numbers verified on the working tree at `/Users/aniquesabir/vexa` on
> 2026-06-27. They are stable anchors (`spawn("parecord"`, `connectElement`,
> `processor.onaudioprocess`, etc.) — re-grep for the anchor text if the repo
> has moved since.

### 2a. Add the forwarder module (new file — no Vexa edit)

Copy `forwarder.ts` to:

```
services/vexa-bot/core/src/services/steward-forwarder.ts
```

It is self-contained (uses only Node's `net`, `events`, `child_process` — all
already available; `net` is already imported in `index.ts:23`). No new npm
dependency.

### 2b. Zoom Web — tap `parecord` stdout before WAV wrapping

**File:** `services/vexa-bot/core/src/services/audio-pipeline.ts`
**Class:** `PulseAudioCapture` (declared at **line 357**).

| What | Anchor | Verified line |
|------|--------|---------------|
| `parecord` spawn (`--format=s16le --rate=16000 --channels=1`) | `this.process = spawn("parecord", [` | **384** |
| stdout handler — first place raw PCM is in hand | `this.process.stdout.on("data", (buf: Buffer) => {` | **398** |
| the `emit("started")` on first byte | `this.emit("started");` | **407** |
| existing WAV slicing (the thing we tap *before*) | `this._appendAndSlice(buf);` | **410** |

Insert one line **inside the stdout `data` handler, before
`this._appendAndSlice(buf)` (line 410)** to feed the forwarder the raw PCM
buffer. Full snippet in `zoom_tap.md`.

### 2c. Meet / Teams — combined-stream worklet tap

**File:** `services/vexa-bot/core/src/index.ts`
**Function:** `startPerSpeakerAudioCapture(page)` (declared at **line 1880**);
the browser-side `page.evaluate(...)` block begins at **line 1923**.

| What | Anchor | Verified line |
|------|--------|---------------|
| target sample rate constant (already 16 kHz) | `const TARGET_SAMPLE_RATE = 16000;` | **1924** |
| per-speaker `connectElement()` | `function connectElement(el: HTMLMediaElement, index: number): boolean {` | **1954** |
| per-speaker `AudioContext` | `const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });` | **1961** |
| existing per-speaker `ScriptProcessor` (proves the pattern) | `processor.onaudioprocess = (e: AudioProcessingEvent) => {` | **1968** |
| existing Float32 → Node bridge (the model we mirror) | `(window as any).__vexaPerSpeakerAudioData(index, Array.from(data));` | **1975** |

The per-speaker block at 1954–1996 already proves the exact mechanism we need
(create an `AudioContext` at 16 kHz, read mono `Float32` audio, ship it to
Node). For StewardAI we add **one** combined-mix `AudioContext` driving the
AudioWorklet from `audioworklet/pcm-worklet.js` and forward its 20 ms s16le
frames through a Node-exposed callback. The browser→Node callback is exposed
exactly like `__vexaPerSpeakerAudioData` (registered at **index.ts:1914** via
`pageToCaptureFrom.exposeFunction(...)`). See `audioworklet/pcm-worklet.js` for
the worklet and the integration notes block for the wiring (where to call
`exposeFunction('__vexaStewardFrame', ...)` and `audioWorklet.addModule(...)`).

> Why a separate combined tap instead of reusing the per-speaker callback: the
> per-speaker path emits *one stream per participant* (and gates on
> `maxVal > 0.005`, dropping silence — **index.ts:1973**). StewardAI's STT/VAD
> want the *single combined meeting mix* with silence preserved for endpointing.
> Tapping the combined element keeps the agent's turn detection correct and
> leaves Vexa's per-speaker diarization completely untouched.

### 2d. Construct + wire the forwarder (where the bot starts a meeting)

**File:** `services/vexa-bot/core/src/index.ts`

Construct a single module-level `StewardForwarder` once the platform is known
(`currentPlatform` is set in the same file — declared at **line 43**, assigned
in the platform-dispatch around **line 667**). Recommended: construct it right
after the recording pipeline starts, and:

- Zoom: pass its `feedPcm(buf)` into the `parecord` tap (2b).
- Meet/Teams: register `page.exposeFunction('__vexaStewardFrame', (frame) =>
  forwarder.feedPcm(Buffer.from(frame)))` next to the existing
  `exposeFunction('__vexaPerSpeakerAudioData', ...)` call at **index.ts:1914**.

Call `forwarder.close()` from the bot's shutdown/leave path (same place the
recording pipeline's `stop()` is awaited). The forwarder auto-reconnects, so
ordering relative to bot startup is not critical.

---

## 3. Build & run the patched bot image

The patch adds source files only — the existing build (`npm run build`,
`tsc + build-browser-utils.js` per `package.json`) and Docker build are
unchanged.

```bash
# 1. Drop the new files into the vexa-bot core source tree:
cp forwarder.ts            $VEXA/services/vexa-bot/core/src/services/steward-forwarder.ts
cp audioworklet/pcm-worklet.js  $VEXA/services/vexa-bot/core/src/browser/steward-pcm-worklet.js
#    (any path served to the browser is fine; see worklet notes for addModule URL)

# 2. Apply the 2b / 2c / 2d insertions by hand (each is 1–6 additive lines).

# 3. Build the bot (from services/vexa-bot/core):
cd $VEXA/services/vexa-bot/core
npm install        # no new deps required
npm run build      # tsc + browser util bundling (unchanged)

# 4. Build the bot image the usual Vexa way (compose / Dockerfile in the repo):
cd $VEXA
docker compose build vexa-bot     # or the bot service name in your compose file
```

### Reaching the StewardAI socket from the bot

- **TCP (dev / cross-host / Mac agent):** point the bot at the agent host:port.
  If the agent runs on the Docker host, use `host.docker.internal:8765`
  (Mac/Windows) or the host's LAN IP / `--network host` (Linux).
- **Unix socket (Linux, co-located):** bind-mount the socket dir into the bot
  container so both processes see the same `/tmp/stewardai.sock`:
  ```yaml
  # docker-compose (bot service)
  environment:
    BRIDGE_TRANSPORT: unix
    BRIDGE_SOCKET_PATH: /run/steward/stewardai.sock
  volumes:
    - steward-sock:/run/steward          # shared with the agent container
  ```

---

## 4. Wire framing & env mapping (must match `transport.py`)

The forwarder emits exactly what `bridge/transport.py` decodes:

```
frame  =  [4-byte big-endian uint32 N]  ++  [N bytes s16le PCM]
N      =  640   (20 ms @ 16 kHz mono s16le = 320 samples × 2 bytes)
```

`transport.py` (`_read_frames_into`) `readexactly(4)`, unpacks `>I`, then
`readexactly(N)`. It tolerates any `N` and partial reads, ignores `N == 0`, and
guards against `N > 1 MiB`. The forwarder always sends `N = 640`.

The forwarder reads the **same env var names** the StewardAI bridge uses, so a
single `.env` configures both ends:

| Env var | StewardAI (`config.py` / `.env.example`) | Forwarder (`forwarder.ts`) |
|---------|------------------------------------------|----------------------------|
| `BRIDGE_TRANSPORT` | `tcp` \| `unix` (default `tcp`) | selects TCP vs Unix client |
| `BRIDGE_TCP_HOST` | `127.0.0.1` | TCP connect host |
| `BRIDGE_TCP_PORT` | `8765` | TCP connect port |
| `BRIDGE_SOCKET_PATH` | `/tmp/stewardai.sock` | Unix socket path |

The agent's `transport.py` is the **server** (it `start_server` /
`start_unix_server` and accepts the first client as the audio source). The
forwarder is the **client** (it connects/reconnects). So the agent must be
listening first, but the forwarder retries until the agent is up — start order
doesn't matter.

---

## 4b. Output + control (full-duplex)

The forwarder is now **full-duplex**: it both SENDS inbound meeting PCM and
READS the agent's TTS audio back over the **same socket**, same framing
(`[4-byte BE N][N bytes s16le PCM]`), at **16 kHz** s16le mono. The agent side
(`bridge/transport.py` `FrameServer.send`) writes TTS frames to the same
`_source_writer` the inbound client connected on, so one TCP/Unix connection
carries audio both ways. The agent additionally sends **control** over the
Redis command channel the bot already subscribes to.

### Output: agent TTS → meeting

`forwarder.ts` (`steward-forwarder.ts`) now attaches a `data` handler, buffers
bytes across reads, decodes the same length-prefixed frames, and emits each
decoded payload as an **`"agentPcm"`** event (a Node `Buffer`). It tolerates
partial reads, skips `N == 0`, and resets its read buffer on `N > 1 MiB`
(desync guard, matching `transport.py`). It never throws into Vexa.

In `index.ts`, on each `"agentPcm"` frame the bot plays it to the PulseAudio
`tts_sink` via the existing `TTSPlaybackService.startPCMStream(16000, 1, 's16le')`
(returns `{ write, end, onDone }`). The paplay stream is opened **lazily on the
first frame** (and `unmuteTtsAudio()` is called then — `startPCMStream` does NOT
unmute on its own, unlike `playPCM`). On `speak_stop` the bot calls
`ttsPlaybackService.interrupt()` (SIGKILLs paplay) and resets the stream handle
so the next frame opens a fresh stream.

| What | File:anchor | Verified line (2026-06-29) |
|------|-------------|----------------------------|
| forwarder construct + `agentPcm` wiring (opt-in `STEWARD_BRIDGE_ENABLED=true`) | after per-speaker pipeline init, before platform dispatch | `index.ts` ~2690 |
| `playStewardAgentFrame()` / `resetStewardTtsStream()` + `stewardForwarder` module var + `getStewardForwarder()` | next to the voice-agent service vars | `index.ts` ~153–195 |
| `import { StewardForwarder, createStewardForwarder }` + meet-tap import | service-import block | `index.ts` 15–18 |
| `unmuteTtsAudio` / `muteTtsAudio` made `export`ed (no behavior change) | `tts-playback.ts` | lines 11, 25 |
| forwarder `close()` + `stopStewardMeetTap()` in graceful-leave cleanup | voice-agent cleanup block | `index.ts` ~784 |

### Control: Redis actions on `bot_commands:meeting:{meetingId}`

The agent sends JSON `{"action": "..."}` on the channel the bot already
subscribes to (subscription `index.ts` ~2278; dispatch `else if` chain
`index.ts` ~564). Added cases:

| Action | Behavior (in `handleRedisMessage`) |
|--------|------------------------------------|
| `mic_on`  | `unmuteTtsAudio()` (lift PulseAudio `tts_sink`/`virtual_mic` mute) **and** `microphoneService.unmute()` (lift the meeting-UI mic button). Both are required for TTS to reach the meeting. |
| `mic_off` | `muteTtsAudio()` + `ttsPlaybackService.interrupt()` + reset steward stream + `microphoneService.mute()`. |
| `speak_stop` | (existing case, extended) `ttsPlaybackService.interrupt()` **and** `resetStewardTtsStream()` so the next `agentPcm` reopens a fresh stream. |

### Meet/Teams combined-mix tap (new module)

`steward-meet-tap.ts` holds the AudioWorklet source (== `audioworklet/pcm-worklet.js`)
and `startStewardMeetTap(page, forwarder)` / `stopStewardMeetTap(page)`. The
worklet is loaded via a **Blob URL** built in the page (no static asset server),
exposes `__vexaStewardFrame` → `forwarder.feedPcm(...)`, connects all
`audio`/`video` MediaStream elements into one `GainNode` mix → worklet, and
re-scans every 15 s for late joiners. It is started ~8 s after platform dispatch
(so media elements exist) and is independent of Vexa's per-speaker capture.

### Wire/format notes

- Agent TTS is **16 kHz** s16le mono (NOT 24 kHz). The bot opens paplay at 16000.
- The forwarder always SENDS `N = 640` (20 ms). It READS any `N`.
- Everything is gated behind `STEWARD_BRIDGE_ENABLED=true`; when unset the
  forwarder is never constructed and all taps are no-ops (`getStewardForwarder()`
  returns `null`, which `PulseAudioCapture.setStewardForwarder(null)` accepts).

## 5. Files in this directory

| File | Purpose |
|------|---------|
| `README.md` | this overview, architecture, verified insertion points, build/run, env mapping |
| `zoom_tap.md` | exact `parecord`-stdout tap (insertion point + minimal TS snippet) |
| `audioworklet/pcm-worklet.js` | AudioWorklet: combined Meet/Teams mix → 16 kHz mono → 20 ms s16le frames via `postMessage` |
| `forwarder.ts` | Node module: receive frames → normalize → length-prefixed frames over Unix/TCP with reconnect |
