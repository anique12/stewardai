/**
 * pcm-worklet.js — StewardAI combined-meeting-audio tap (Google Meet / Teams).
 *
 * Runs in the browser AudioWorklet (audio render thread) inside Vexa's
 * Chromium tab. It receives the combined meeting mix (whatever stream graph
 * the page routes into it), downsamples to 16 kHz MONO, packs s16le PCM into
 * 20 ms frames (320 samples = 640 bytes), and posts each frame to the main
 * thread via `this.port.postMessage(arrayBuffer, [arrayBuffer])`.
 *
 * The main thread forwards each frame to Node (see the integration notes at
 * the bottom of this file), where forwarder.ts length-prefixes it and writes
 * it to the StewardAI bridge socket.
 *
 * Output contract (matches src/stewardai/bridge/transport.py):
 *   - sample format : s16le (signed 16-bit little-endian)
 *   - sample rate   : 16000 Hz
 *   - channels      : 1 (mono; multi-channel input is averaged)
 *   - frame size    : 320 samples / 640 bytes  (20 ms)
 *
 * Why a worklet (not ScriptProcessor): ScriptProcessor is deprecated and runs
 * on the main thread (glitchy under Chromium load). AudioWorklet runs on the
 * audio thread and is the supported path. Vexa's per-speaker capture still
 * uses ScriptProcessor (index.ts:1963) — we deliberately do NOT touch that;
 * this is a separate, additive tap on the COMBINED mix with silence preserved
 * (the per-speaker path gates on amplitude > 0.005, which would break STT
 * endpointing).
 *
 * Resampling: linear interpolation from the AudioContext's native sample rate
 * (usually 48000) down to 16000. Linear is intentional — it is cheap, runs on
 * the audio thread without allocations in the hot path, and is more than
 * adequate for 16 kHz speech STT. The fractional read position is carried
 * across render quanta so there is no per-block drift.
 */

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 ms @ 16 kHz
const FRAME_BYTES = FRAME_SAMPLES * 2; // 640 bytes, s16le

class StewardPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a global available inside AudioWorkletGlobalScope and
    // equals the owning AudioContext's rate (e.g. 48000).
    this._inRate = sampleRate;
    this._ratio = this._inRate / TARGET_RATE; // input samples per output sample

    // Fractional read cursor into the *virtual* concatenated input stream.
    // Carried across process() calls so resampling never restarts/drifts.
    this._readPos = 0;

    // Holds the tail of the previous input quantum so interpolation can read
    // across the block boundary. Index 0 of `_inBuf` corresponds to absolute
    // input-sample index `_inBufBase`.
    this._inBuf = new Float32Array(0);
    this._inBufBase = 0;

    // Accumulates resampled 16 kHz samples until we have a full 320-sample
    // frame, then flushes one s16le frame.
    this._acc = new Float32Array(FRAME_SAMPLES);
    this._accLen = 0;

    this._enabled = true;
    this.port.onmessage = (e) => {
      // Allow the main thread to pause/resume forwarding (e.g. while the bot
      // itself is speaking, to suppress self-capture). Optional.
      if (e.data && typeof e.data.enabled === "boolean") {
        this._enabled = e.data.enabled;
      }
    };
  }

  /** Downmix all input channels of one render quantum to mono Float32. */
  _toMono(input) {
    // input: Float32Array[] (one per channel), each length 128 (quantum).
    const chCount = input.length;
    if (chCount === 0) return new Float32Array(0);
    const n = input[0].length;
    if (chCount === 1) return input[0];
    const mono = new Float32Array(n);
    for (let c = 0; c < chCount; c++) {
      const ch = input[c];
      for (let i = 0; i < n; i++) mono[i] += ch[i];
    }
    const inv = 1 / chCount;
    for (let i = 0; i < n; i++) mono[i] *= inv;
    return mono;
  }

  _flushFrame() {
    // Convert the 320 accumulated float samples to s16le and post a 640-byte
    // ArrayBuffer (transferred, zero-copy).
    const out = new ArrayBuffer(FRAME_BYTES);
    const view = new DataView(out);
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      let s = this._acc[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      // Symmetric scaling; round toward nearest.
      const v = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      view.setInt16(i * 2, v, /* littleEndian */ true);
    }
    this._accLen = 0;
    this.port.postMessage(out, [out]);
  }

  _pushResampled(sample) {
    this._acc[this._accLen++] = sample;
    if (this._accLen === FRAME_SAMPLES) this._flushFrame();
  }

  process(inputs) {
    const input = inputs[0];
    // No input connected this quantum → keep the node alive.
    if (!input || input.length === 0) return true;

    const mono = this._toMono(input);
    if (mono.length === 0) return true;

    if (!this._enabled) {
      // Suppressed (e.g. while the bot itself is speaking). Drop audio and
      // reset the resampler state so we re-sync cleanly on resume — there is
      // no value in maintaining sample-accurate continuity across a mute gap.
      this._inBuf = new Float32Array(0);
      this._inBufBase = 0;
      this._readPos = 0;
      this._accLen = 0;
      return true;
    }

    // Concatenate the carried tail (last sample of previous block, for
    // interpolation across the boundary) with the new quantum.
    let buf;
    let base;
    if (this._inBuf.length > 0) {
      buf = new Float32Array(this._inBuf.length + mono.length);
      buf.set(this._inBuf, 0);
      buf.set(mono, this._inBuf.length);
      base = this._inBufBase;
    } else {
      buf = mono;
      base = this._inBufBase;
    }

    // Resample: produce output samples while the interpolation window
    // [floor(readPos), floor(readPos)+1] is fully inside `buf`.
    const bufStart = base; // absolute index of buf[0]
    const bufEnd = base + buf.length - 1; // absolute index of last sample

    // Don't read before what we have buffered.
    if (this._readPos < bufStart) this._readPos = bufStart;

    while (this._readPos < bufEnd) {
      const idx = Math.floor(this._readPos);
      const frac = this._readPos - idx;
      const local = idx - bufStart;
      const a = buf[local];
      const b = buf[local + 1];
      this._pushResampled(a + (b - a) * frac);
      this._readPos += this._ratio;
    }

    // Carry the final sample as the tail so the next block can interpolate
    // across the boundary; advance the absolute base accordingly.
    const keepFrom = buf.length - 1;
    this._inBuf = buf.subarray(keepFrom);
    this._inBufBase = base + keepFrom;

    return true; // keep processor alive
  }
}

registerProcessor("steward-pcm-worklet", StewardPcmProcessor);

/* ─────────────────────────────────────────────────────────────────────────
 * INTEGRATION NOTES (Meet / Teams) — runs on the MAIN thread (page context),
 * additive to Vexa. Do NOT put this part in the worklet file that gets passed
 * to addModule(); it is documentation for the page.evaluate() wiring.
 *
 * Insertion point: services/vexa-bot/core/src/index.ts, function
 * startPerSpeakerAudioCapture(page) — declared at line 1880. The existing
 * per-speaker browser-side setup runs in a page.evaluate(...) block starting
 * at line 1923 and already exposes a Node callback at line 1914:
 *     await pageToCaptureFrom.exposeFunction('__vexaPerSpeakerAudioData', ...)
 *
 * Add, right next to it (additive):
 *
 *   // Node side (index.ts) — expose a sink for StewardAI 20 ms frames.
 *   await pageToCaptureFrom.exposeFunction(
 *     '__vexaStewardFrame',
 *     (frame) => {
 *       // `frame` arrives as a number[] (Playwright serializes ArrayBuffer).
 *       // forwarder.feedPcm accepts Buffer; build it from the byte array.
 *       try { stewardForwarder?.feedPcm(Buffer.from(Uint8Array.from(frame))); }
 *       catch (e) { /* best-effort tap, never break recording * / }
 *     },
 *   );
 *
 * Then inside a page.evaluate(...) (can be the same block at line 1923, or a
 * sibling call), build ONE combined-mix AudioContext + worklet:
 *
 *   await page.evaluate(async (workletUrl) => {
 *     // Build (or reuse) the combined meeting mix. The simplest robust source
 *     // is the same media elements the per-speaker code finds (index.ts:1930):
 *     const els = Array.from(document.querySelectorAll('audio, video')).filter(
 *       (el) => !el.paused && el.srcObject instanceof MediaStream &&
 *               el.srcObject.getAudioTracks().length > 0);
 *     if (els.length === 0) return 0;
 *
 *     const ctx = new AudioContext();            // native rate (usually 48k)
 *     await ctx.audioWorklet.addModule(workletUrl);
 *     const node = new AudioWorkletNode(ctx, 'steward-pcm-worklet');
 *     const mix = ctx.createGain();              // combined bus
 *     for (const el of els) {
 *       try { ctx.createMediaStreamSource(el.srcObject).connect(mix); }
 *       catch (e) { /* element may be re-bound elsewhere; skip * / }
 *     }
 *     mix.connect(node);
 *     // Do NOT connect node to ctx.destination — we don't want to play audio
 *     // back into the meeting. A muted sink keeps the graph pulling:
 *     const mute = ctx.createGain(); mute.gain.value = 0;
 *     node.connect(mute).connect(ctx.destination);
 *
 *     node.port.onmessage = (e) => {
 *       // e.data is a 640-byte ArrayBuffer (s16le, 16 kHz, mono, 20 ms).
 *       window.__vexaStewardFrame(Array.from(new Uint8Array(e.data)));
 *     };
 *     window.__vexaStewardCtx = ctx;             // keep a handle for teardown
 *     return els.length;
 *   }, workletUrl);
 *
 * workletUrl: the URL the page can fetch this file from. Options:
 *   (a) Serve it as a static asset and pass an http(s) URL, OR
 *   (b) Inline it as a Blob URL the page builds from the worklet source string
 *       (robust inside the bot's sandbox):
 *         const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
 *         const workletUrl = URL.createObjectURL(blob);
 *
 * Teams: same pattern. Teams routes a single combined stream (see
 * index.ts:1803 handleTeamsAudioData / the recording.ts page.evaluate routing);
 * connect that stream's MediaStreamSource into `mix` instead of iterating media
 * elements.
 *
 * Re-scan: the per-speaker code re-scans every 15 s (index.ts:2005) for late
 * joiners. For the combined tap, re-connect newly-found media elements into the
 * same `mix` GainNode on the same interval so late joiners are included.
 *
 * Teardown: on bot leave, call window.__vexaStewardCtx?.close() in a
 * page.evaluate, alongside the existing __vexaPerSpeakerIntervals cleanup
 * (index.ts:2040).
 * ───────────────────────────────────────────────────────────────────────── */
