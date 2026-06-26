# Zoom Web tap — `parecord` stdout → StewardAI forwarder

Zoom Web audio is captured by `PulseAudioCapture` (in
`services/vexa-bot/core/src/services/audio-pipeline.ts`), which spawns
`parecord` and reads its stdout as **raw s16le PCM at 16 kHz mono**. Vexa then
buffers that PCM and slices it into self-contained **15-second WAV chunks**
(`_appendAndSlice` → `_wrapWav`) for upload.

For StewardAI we want the PCM **before** the 15 s WAV wrapping — raw, low
latency, re-sliced to 20 ms frames. That's a single additive line in the
existing stdout handler.

## Verified facts (from `/Users/aniquesabir/vexa`, 2026-06-27)

`PulseAudioCapture` spawns parecord already in the format StewardAI needs
(`audio-pipeline.ts:384`):

```ts
this.process = spawn("parecord", [
  "--raw",
  "--format=s16le",
  `--rate=${this.sampleRate}`,   // sampleRate defaults to 16000  (line 372)
  `--channels=${this.channels}`, // channels  defaults to 1       (line 373)
  `--device=${this.device}.monitor`,
]);
```

So stdout is **s16le / 16 kHz / mono** — exactly StewardAI's wire format, just
not yet sliced to 20 ms. No resampling needed; only re-framing (done by the
forwarder).

## Insertion point

**File:** `services/vexa-bot/core/src/services/audio-pipeline.ts`
**Method:** `PulseAudioCapture.start()` → the `this.process.stdout.on("data", ...)`
handler.

Verified anchors:

- `this.process.stdout.on("data", (buf: Buffer) => {`  → **line 398**
- `this.emit("started");`                              → **line 407**
- `this._appendAndSlice(buf);`                          → **line 410** (tap here)

Add the StewardAI feed **immediately before `this._appendAndSlice(buf)`** so
the same raw buffer Vexa is about to WAV-wrap is also forwarded. This does not
touch the WAV/upload path at all.

## Minimal additive snippet

### Step 1 — give `PulseAudioCapture` an optional PCM sink

At the top of the class (additive field + setter; the class starts at
`audio-pipeline.ts:357`):

```ts
import type { StewardForwarder } from "./steward-forwarder"; // additive import

export class PulseAudioCapture extends EventEmitter implements AudioCaptureSource {
  // ... existing fields (process, device, sampleRate, channels, buffer, seq) ...

  // ── StewardAI tap (additive) ──────────────────────────────────────────
  private stewardForwarder: StewardForwarder | null = null;
  /** Attach a StewardAI forwarder. parecord stdout is already s16le/16k/mono. */
  setStewardForwarder(fwd: StewardForwarder | null): void {
    this.stewardForwarder = fwd;
  }
  // ──────────────────────────────────────────────────────────────────────
```

### Step 2 — feed the raw buffer inside the stdout handler

In `start()`, the existing handler (line 398) ends with `this._appendAndSlice(buf)`
at line 410. Insert one block right before it:

```ts
      this.process.stdout.on("data", (buf: Buffer) => {
        if (!started) {
          log(`[PulseAudioCapture] receiving audio from ${this.device}.monitor`);
          started = true;
          this.emit("started");            // existing — line 407
          resolve();
        }

        // ── StewardAI tap (additive) ──────────────────────────────────
        // buf is raw s16le @ 16 kHz mono — exactly StewardAI's format.
        // The forwarder reslices to 20 ms (640-byte) frames internally.
        // Wrapped in try/catch so a forwarder hiccup can NEVER affect the
        // recording/upload path (Vexa rule: no silent fallbacks, but the
        // tap is strictly best-effort and must not break recording).
        if (this.stewardForwarder) {
          try {
            this.stewardForwarder.feedPcm(buf);
          } catch (err: any) {
            log(`[PulseAudioCapture] steward tap error: ${err?.message || err}`);
          }
        }
        // ──────────────────────────────────────────────────────────────

        this._appendAndSlice(buf);          // existing — line 410 (UNCHANGED)
      });
```

### Step 3 — wire it where the Zoom recording pipeline is built

Wherever `PulseAudioCapture` is instantiated for Zoom Web (the
`UnifiedRecordingPipeline` source for `platform: "zoom-web"`), call the setter
after constructing the module-level `StewardForwarder` (see README §2d):

```ts
const source = new PulseAudioCapture({ /* existing opts */ });
source.setStewardForwarder(stewardForwarder); // additive — null is fine if disabled
```

## Notes

- **Byte alignment:** `parecord` stdout chunks are arbitrary sizes and not
  guaranteed to be a multiple of 640 bytes. The forwarder buffers and reslices
  to exact 640-byte frames and carries the remainder to the next call — do
  **not** attempt to slice here.
- **Endianness / format:** s16le matches `transport.py`'s `s16le PCM` contract
  directly; no byte-swap, no float conversion on the Zoom path.
- **`PULSE_SINK`:** device defaults to `zoom_sink` (env `PULSE_SINK`,
  `audio-pipeline.ts:371`); the tap is agnostic to which sink monitor is used.
- **No timing dependency:** the tap is best-effort and reconnecting; if the
  StewardAI agent isn't up yet, frames are dropped until the socket connects.
