// Shared, dependency-free helpers for the StewardAI test pages.
//
// Audio contract (matches the Python side): PCM s16le, 16 kHz, mono, 20 ms frames
// (320 samples / 640 bytes). The browser mic runs at the hardware rate (often
// 48 kHz); we downsample to 16 k, repack to int16, and ship 20 ms frames over a
// websocket as binary messages.

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 ms @ 16 kHz

// --- helpers -------------------------------------------------------------

export function $(sel) {
  return document.querySelector(sel);
}

export function wsURL(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

// Linear-resample a Float32 buffer from srcRate to TARGET_RATE.
function downsample(input, srcRate) {
  if (srcRate === TARGET_RATE) return input;
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

// Float32 [-1,1] -> Int16 s16le bytes.
function floatToS16LE(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// The AudioWorklet processor source. Posts raw Float32 mono blocks (at the
// context's native rate) back to the main thread, where we downsample + frame.
const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // copy: the underlying buffer is reused by the engine
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

// --- mic capture ---------------------------------------------------------

// Start streaming 20 ms s16le/16 k frames to `onFrame(ArrayBuffer)`.
// Returns a handle with .stop().
export async function startMic(onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const srcRate = ctx.sampleRate;

  // Accumulate downsampled 16 k samples, emit fixed 320-sample frames.
  let acc = new Float32Array(0);
  const emit = (block) => {
    const ds = downsample(block, srcRate);
    const merged = new Float32Array(acc.length + ds.length);
    merged.set(acc, 0);
    merged.set(ds, acc.length);
    acc = merged;
    while (acc.length >= FRAME_SAMPLES) {
      const frame = acc.subarray(0, FRAME_SAMPLES);
      onFrame(floatToS16LE(frame).buffer);
      acc = acc.subarray(FRAME_SAMPLES);
    }
  };

  let node;
  let usingWorklet = false;
  try {
    const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    node = new AudioWorkletNode(ctx, "capture-processor");
    node.port.onmessage = (e) => emit(e.data);
    source.connect(node);
    // Worklets don't need to reach the destination, but connecting a muted
    // sink keeps the graph pulling on some browsers.
    node.connect(ctx.destination);
    usingWorklet = true;
  } catch (err) {
    // Fallback: ScriptProcessor (deprecated but universally available).
    const bufSize = 2048;
    node = ctx.createScriptProcessor(bufSize, 1, 1);
    node.onaudioprocess = (e) => emit(e.inputBuffer.getChannelData(0));
    source.connect(node);
    node.connect(ctx.destination);
  }

  return {
    usingWorklet,
    sampleRate: srcRate,
    async stop() {
      try {
        if (node) node.disconnect();
        source.disconnect();
      } catch (_) {}
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

// --- PCM playback --------------------------------------------------------

// Queued player for incoming s16le/16 k mono frames. Schedules them gaplessly
// so streamed TTS plays as a continuous sound.
export class PCMPlayer {
  constructor(rate = TARGET_RATE) {
    this.rate = rate;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: rate,
    });
    this.cursor = 0;
    this.sources = new Set(); // live buffer-source nodes, for flush()
  }

  // Accepts an ArrayBuffer of s16le bytes.
  push(arrayBuffer) {
    const i16 = new Int16Array(arrayBuffer);
    if (i16.length === 0) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
    const buf = this.ctx.createBuffer(1, f32.length, this.rate);
    buf.getChannelData(0).set(f32);
    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const start = Math.max(now, this.cursor);
    node.start(start);
    this.cursor = start + buf.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
  }

  // Stop everything queued/playing immediately (barge-in: the agent was cut off).
  flush() {
    for (const node of this.sources) {
      try {
        node.stop();
      } catch (_) {}
    }
    this.sources.clear();
    this.cursor = this.ctx.currentTime;
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  close() {
    this.ctx.close();
  }
}

// --- UI helpers ----------------------------------------------------------

export function setStatus(el, text, live = false) {
  el.innerHTML = `<span class="dot ${live ? "live" : ""}"></span>${text}`;
}

export function renderTiming(el, summary) {
  const keys = [
    ["t_stt", "STT (ms)"],
    ["t_llm_ttft", "LLM TTFT (ms)"],
    ["t_tts", "TTS (ms)"],
    ["t_tts_ttfa", "TTS TTFA (ms)"],
    ["t_total", "Total (ms)"],
  ];
  el.innerHTML = keys
    .filter(([k]) => summary[k] !== undefined)
    .map(
      ([k, label]) =>
        `<div class="metric"><div class="k">${label}</div><div class="v">${summary[k]}</div></div>`
    )
    .join("");
}

export function logLine(el, msg) {
  const ts = new Date().toLocaleTimeString();
  el.textContent += `[${ts}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
