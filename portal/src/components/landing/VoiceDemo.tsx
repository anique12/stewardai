"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";

type DemoState = "idle" | "requesting" | "connecting" | "live" | "ended" | "error";

const SESSION_LIMIT_MS = 75_000; // 75 seconds
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 ms @ 16 kHz

// AudioWorklet processor source — captures raw Float32 mono blocks at the
// context's native sample rate and posts them back to the main thread.
const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

// Linear-interpolation downsample Float32 from srcRate → 16 kHz.
function downsample(input: Float32Array, srcRate: number): Float32Array {
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

// Float32 [-1, 1] → Int16 s16le ArrayBuffer.
function floatToS16LE(float32: Float32Array): ArrayBuffer {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

// Mic capture handle returned by startMic.
interface MicHandle {
  stop(): Promise<void>;
}

// Start streaming 20 ms s16le/16 kHz frames to onFrame. onLevel (optional)
// receives the RMS level [0,1] of each captured block to drive the visualizer.
async function startMic(
  onFrame: (buf: ArrayBuffer) => void,
  onLevel?: (level: number) => void,
): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const AudioContextClass =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextClass!();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const srcRate = ctx.sampleRate;

  // Accumulate downsampled samples; emit fixed 320-sample frames.
  let acc = new Float32Array(0);
  const emit = (block: Float32Array) => {
    if (onLevel) {
      let s = 0;
      for (let i = 0; i < block.length; i++) s += block[i] * block[i];
      onLevel(Math.sqrt(s / block.length));
    }
    const ds = downsample(block, srcRate);
    const merged = new Float32Array(acc.length + ds.length);
    merged.set(acc, 0);
    merged.set(ds, acc.length);
    acc = merged;
    while (acc.length >= FRAME_SAMPLES) {
      const frame = acc.subarray(0, FRAME_SAMPLES);
      onFrame(floatToS16LE(frame));
      acc = acc.subarray(FRAME_SAMPLES);
    }
  };

  let node: AudioWorkletNode | ScriptProcessorNode;

  try {
    const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const workletNode = new AudioWorkletNode(ctx, "capture-processor");
    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => emit(e.data);
    source.connect(workletNode);
    // Connect to destination to keep the graph pulling on some browsers.
    workletNode.connect(ctx.destination);
    node = workletNode;
  } catch {
    // Fallback: deprecated ScriptProcessor.
    const spNode = ctx.createScriptProcessor(2048, 1, 1);
    spNode.onaudioprocess = (e: AudioProcessingEvent) => emit(e.inputBuffer.getChannelData(0));
    source.connect(spNode);
    spNode.connect(ctx.destination);
    node = spNode;
  }

  return {
    async stop() {
      try {
        node.disconnect();
        source.disconnect();
      } catch {
        // ignore
      }
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
    },
  };
}

// PCM playback: queued s16le/16 kHz mono frames scheduled gaplessly. An
// AnalyserNode taps the playback so the UI can read the agent's output level.
class PCMPlayer {
  private ctx: AudioContext;
  private cursor = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private analyser: AnalyserNode;
  private buf: Uint8Array<ArrayBuffer>;

  constructor(rate = TARGET_RATE) {
    const AudioContextClass =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass!({ sampleRate: rate });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.6;
    this.analyser.connect(this.ctx.destination);
    this.buf = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  push(arrayBuffer: ArrayBuffer) {
    const i16 = new Int16Array(arrayBuffer);
    if (i16.length === 0) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 0x8000;
    const buf = this.ctx.createBuffer(1, f32.length, this.ctx.sampleRate);
    buf.getChannelData(0).set(f32);
    const node = this.ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.analyser);
    const now = this.ctx.currentTime;
    const start = Math.max(now, this.cursor);
    node.start(start);
    this.cursor = start + buf.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
  }

  // RMS-ish level [0,1] of currently-playing audio. ~0 when nothing is queued.
  level(): number {
    if (this.cursor <= this.ctx.currentTime + 0.02) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.buf.length);
  }

  flush() {
    this.sources.forEach((node) => {
      try { node.stop(); } catch { /* ignore */ }
    });
    this.sources.clear();
    this.cursor = this.ctx.currentTime;
  }

  close() {
    this.ctx.close();
  }
}

// Audio-reactive waveform: a row of thin vertical bars whose heights track the
// live audio level (agent playback when speaking, mic otherwise). Driven by
// requestAnimationFrame off the AnalyserNode / mic RMS so it reacts in real
// time. Respects prefers-reduced-motion by rendering a calm static baseline.
const BAR_COUNT = 28;

function LiveWaveform({
  micLevelRef,
  playerRef,
  mode,
}: {
  micLevelRef: MutableRefObject<number>;
  playerRef: RefObject<PCMPlayer | null>;
  mode: "listening" | "speaking";
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const teal = "rgba(20, 184, 166, 0.85)";
    const tealDim = "rgba(20, 184, 166, 0.30)";
    let raf = 0;
    let smooth = 0;
    // Per-bar phase so the spectrum looks lively rather than a flat block.
    const phase = Array.from({ length: BAR_COUNT }, (_, i) => i * 0.55);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const agent = playerRef.current?.level() ?? 0;
      const mic = micLevelRef.current ?? 0;
      // Decay the captured mic peak so quiet settles smoothly.
      micLevelRef.current = mic * 0.86;
      const raw = modeRef.current === "speaking" ? Math.max(agent, mic * 0.5) : mic;
      // Normalise: RMS is small, so amplify and clamp.
      const target = Math.min(1, raw * 4.5);
      smooth += (target - smooth) * 0.2;

      t += 0.08;
      const gap = 3;
      const barW = Math.max(2, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
      const radius = barW / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        // Bell-ish envelope: center bars taller, plus per-bar shimmer.
        const center = 1 - Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2);
        const env = 0.45 + 0.55 * center;
        const shimmer = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t + phase[i]);
        const idle = 0.08 + 0.05 * shimmer;
        const active = smooth * env * (0.55 + 0.45 * shimmer);
        const level = reduced ? Math.max(idle, smooth * env * 0.5) : Math.max(idle, active);

        const barH = Math.max(barW, level * h);
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        ctx.fillStyle = level > 0.14 ? teal : tealDim;
        if (typeof ctx.roundRect === "function") {
          ctx.beginPath();
          ctx.roundRect(x, y, barW, barH, radius);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, barW, barH);
        }
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [micLevelRef, playerRef]);

  return (
    <canvas
      ref={canvasRef}
      className="h-12 w-full"
      aria-hidden
    />
  );
}

export function VoiceDemo() {
  const [state, setState] = useState<DemoState>("idle");
  const [timeLeft, setTimeLeft] = useState(SESSION_LIMIT_MS / 1000);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  // "speaking" = agent is talking, "listening" = waiting on / hearing the user.
  const [mode, setMode] = useState<"listening" | "speaking">("listening");

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionActiveRef = useRef(false);
  const micLevelRef = useRef(0);

  function cleanup() {
    sessionActiveRef.current = false;
    micLevelRef.current = 0;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    wsRef.current?.close();
    wsRef.current = null;
    micRef.current?.stop().catch(() => { /* ignore */ });
    micRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
  }

  useEffect(() => () => cleanup(), []);

  async function startDemo() {
    if (sessionActiveRef.current) return;
    setState("requesting");
    try {
      // Fetch demo token
      const res = await fetch("/api/demo-token");
      if (!res.ok) { setState("error"); return; }
      const { token } = await res.json() as { token: string };

      // Set up PCM player before connecting so it's ready for early audio.
      const player = new PCMPlayer(TARGET_RATE);
      await player.resume();
      playerRef.current = player;

      setState("connecting");
      const wsUrl = `${process.env.NEXT_PUBLIC_DEMO_WS_URL ?? ""}?token=${token}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = async () => {
        // Mic capture — start after WS is open so no frames are lost.
        try {
          const mic = await startMic(
            (buf) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(buf);
            },
            (level) => {
              // Keep the peak; the render loop decays it smoothly.
              micLevelRef.current = Math.max(micLevelRef.current, level);
            },
          );
          micRef.current = mic;
        } catch {
          setState("error");
          cleanup();
        }
      };

      ws.onmessage = (e) => {
        if (typeof e.data !== "string") {
          // Binary: PCM s16le 16 kHz from TTS.
          const data = e.data as ArrayBuffer;
          playerRef.current?.push(data);
          return;
        }
        const msg = JSON.parse(e.data) as { type: string; text?: string };
        if (msg.type === "ready") {
          sessionActiveRef.current = true;
          setState("live");
          setMode("listening");
          setTimeLeft(SESSION_LIMIT_MS / 1000);
          setTranscript("");
          setReply("");
          timerRef.current = setInterval(() => {
            setTimeLeft((t) => {
              if (t <= 1) { endDemo(); return 0; }
              return t - 1;
            });
          }, 1000);
        } else if (msg.type === "transcript") {
          setTranscript(msg.text ?? "");
          setReply("");
          setMode("listening");
          playerRef.current?.flush();
        } else if (msg.type === "reply") {
          setReply(msg.text ?? "");
          setMode("speaking");
        } else if (msg.type === "clear") {
          playerRef.current?.flush();
        } else if (msg.type === "error") {
          setState("error");
          cleanup();
        }
      };

      ws.onclose = () => {
        setState((prev) => (prev !== "ended" ? "ended" : prev));
        cleanup();
      };

      ws.onerror = () => { setState("error"); cleanup(); };
    } catch {
      setState("error");
      cleanup();
    }
  }

  function endDemo() {
    setState("ended");
    cleanup();
  }

  if (state === "idle") {
    return (
      <button
        onClick={startDemo}
        className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90"
      >
        Talk to StewardAI
      </button>
    );
  }

  if (state === "requesting" || state === "connecting") {
    return <p className="text-muted-foreground animate-pulse">Connecting&hellip;</p>;
  }

  if (state === "live") {
    const speaking = mode === "speaking";
    return (
      <div className="space-y-4 text-center">
        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              speaking
                ? "bg-primary/15 text-primary"
                : "bg-secondary/60 text-muted-foreground"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                speaking ? "bg-primary" : "animate-pulse bg-primary"
              }`}
              aria-hidden
            />
            {speaking ? "Steward speaking" : "Listening"}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{timeLeft}s</span>
        </div>

        {/* Live audio-reactive waveform */}
        <LiveWaveform micLevelRef={micLevelRef} playerRef={playerRef} mode={mode} />

        <div className="min-h-[3.5rem] space-y-2 text-left">
          {transcript && (
            <p className="text-sm leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">You:</span> {transcript}
            </p>
          )}
          {reply && (
            <p className="text-sm leading-snug text-foreground">
              <span className="font-medium text-primary">Steward:</span> {reply}
            </p>
          )}
          {!transcript && !reply && (
            <p className="text-sm text-muted-foreground">Say hello to get started&hellip;</p>
          )}
        </div>

        <button
          onClick={endDemo}
          className="w-full rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          End session
        </button>
      </div>
    );
  }

  if (state === "ended") {
    return (
      <div className="space-y-3 text-center">
        <p className="text-foreground font-medium">Session ended.</p>
        <p className="text-muted-foreground">Ready to use StewardAI in your own meetings?</p>
        <a
          href="/auth/login"
          className="inline-block rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Get started free
        </a>
      </div>
    );
  }

  // error
  return (
    <div className="space-y-2 text-center">
      <p className="text-muted-foreground">Demo unavailable right now &mdash; try again shortly.</p>
      <button onClick={() => setState("idle")} className="text-sm text-primary hover:underline">
        Retry
      </button>
    </div>
  );
}
