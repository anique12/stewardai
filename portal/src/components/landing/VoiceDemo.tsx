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

// Audio-reactive orb: a glowing teal sphere whose scale, glow and surface
// shimmer are driven in real time by the live audio level (agent playback when
// speaking, mic RMS otherwise). Rendered to a <canvas> via layered radial
// gradients off requestAnimationFrame. Listening vs speaking shifts the hue a
// touch. Respects prefers-reduced-motion with a calm, near-static breathe.
function VoiceOrb({
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

    // Brand teal, plus a brighter cyan-ish highlight for "speaking".
    const listen = { h: 173, s: 80 }; // teal
    const speak = { h: 187, s: 85 }; // shifts toward cyan when the agent talks

    let raf = 0;
    let smooth = 0; // smoothed audio level [0,1]
    let hueMix = 0; // 0 = listening, 1 = speaking (eased)
    let t = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      const speaking = modeRef.current === "speaking";
      const agent = playerRef.current?.level() ?? 0;
      const mic = micLevelRef.current ?? 0;
      // Decay the captured mic peak so quiet settles smoothly.
      micLevelRef.current = mic * 0.86;
      const raw = speaking ? Math.max(agent, mic * 0.5) : mic;
      // Normalise: RMS is small, so amplify and clamp.
      const target = Math.min(1, raw * 4.5);
      smooth += (target - smooth) * 0.18;
      hueMix += ((speaking ? 1 : 0) - hueMix) * 0.06;

      t += reduced ? 0.012 : 0.03;

      // Calm breathing baseline + audio-driven swell.
      const breathe = reduced ? 0.5 + 0.5 * Math.sin(t) : 0.5 + 0.5 * Math.sin(t);
      const idle = 0.06 + 0.04 * breathe;
      const energy = reduced ? idle * 0.6 + smooth * 0.15 : Math.max(idle, smooth);

      const hue = listen.h + (speak.h - listen.h) * hueMix;
      const sat = listen.s + (speak.s - listen.s) * hueMix;

      // Geometry: base radius fills most of the canvas; swells with energy.
      const maxR = Math.min(w, h) / 2;
      const baseR = maxR * 0.42;
      const coreR = baseR * (1 + energy * 0.28);
      const auraR = Math.min(maxR, coreR * (1.75 + energy * 0.6));

      // 1) Outer aura — soft glowing halo that brightens with energy.
      const auraAlpha = 0.10 + energy * 0.45;
      const aura = ctx.createRadialGradient(cx, cy, coreR * 0.6, cx, cy, auraR);
      aura.addColorStop(0, `hsla(${hue}, ${sat}%, 60%, ${auraAlpha})`);
      aura.addColorStop(0.5, `hsla(${hue}, ${sat}%, 55%, ${auraAlpha * 0.45})`);
      aura.addColorStop(1, `hsla(${hue}, ${sat}%, 50%, 0)`);
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, w, h);

      // 2) Core sphere — radial gradient with an off-centre highlight so it
      // reads as a lit 3D ball rather than a flat disc.
      const lx = cx - coreR * 0.32;
      const ly = cy - coreR * 0.34;
      const sphere = ctx.createRadialGradient(lx, ly, coreR * 0.1, cx, cy, coreR);
      sphere.addColorStop(0, `hsla(${hue}, ${sat}%, ${78 + energy * 8}%, 0.98)`);
      sphere.addColorStop(0.45, `hsla(${hue}, ${sat}%, 58%, 0.96)`);
      sphere.addColorStop(0.85, `hsla(${hue + 6}, ${sat}%, 38%, 0.95)`);
      sphere.addColorStop(1, `hsla(${hue + 10}, ${sat}%, 26%, 0.9)`);
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = sphere;
      ctx.fill();

      // 3) Specular highlight — a small bright bloom for liveliness.
      const spec = ctx.createRadialGradient(lx, ly, 0, lx, ly, coreR * 0.7);
      spec.addColorStop(0, `hsla(${hue}, 100%, 92%, ${0.35 + energy * 0.35})`);
      spec.addColorStop(1, `hsla(${hue}, 100%, 92%, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = spec;
      ctx.fill();

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [micLevelRef, playerRef]);

  return <canvas ref={canvasRef} className="h-56 w-56" aria-hidden />;
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
    // One short, muted caption under the orb — latest reply if the agent is
    // speaking, otherwise the latest thing we heard. Not a transcript log.
    const caption = speaking ? reply : transcript;
    return (
      <div className="relative flex flex-col items-center">
        {/* Countdown — small, tucked into the corner. */}
        <span className="absolute right-0 top-0 font-mono text-xs tabular-nums text-muted-foreground/70">
          {timeLeft}s
        </span>

        {/* The orb is the focus. */}
        <div className="mt-2 grid place-items-center">
          <VoiceOrb micLevelRef={micLevelRef} playerRef={playerRef} mode={mode} />
        </div>

        {/* De-emphasised state label. */}
        <p className="mt-5 text-sm font-medium text-foreground/80">
          {speaking ? "Steward is speaking" : "Listening…"}
        </p>

        {/* One subtle caption — short, muted, single line. */}
        <p className="mt-1 h-5 max-w-[18rem] truncate text-center text-xs text-muted-foreground">
          {caption}
        </p>

        {/* Quiet end-session affordance. */}
        <button
          onClick={endDemo}
          className="mt-6 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
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
