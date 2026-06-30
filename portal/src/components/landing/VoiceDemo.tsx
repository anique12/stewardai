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

// Audio-reactive voice orb, rendered as a glowing, flowing RING (LiveKit-style
// audio visualizer) on a <canvas> off requestAnimationFrame. It is hollow — the
// dark page/modal background shows through the center.
//
// How it's drawn:
//   - The ring's edge is an organic, wavy closed curve: its radius varies
//     around the circumference as the sum of a few low-frequency sine terms at
//     different phases/speeds, so it undulates like liquid rather than a perfect
//     circle. The waviness slowly rotates over time.
//   - Color flows around the band via a createConicGradient centered on the orb
//     (teal -> cyan -> blue -> a touch of violet, teal-forward), and the
//     gradient slowly rotates so the hue sweeps around the ring.
//   - Luminosity comes from layering strokes of the same wavy path: a wide,
//     heavily shadowBlur'd pass for the outer/inner glow plus a narrow, bright
//     core pass, all drawn with globalCompositeOperation = "lighter" so the
//     light adds up.
//
// Audio drives it: louder input -> larger wobble amplitude + slightly larger
// radius + brighter glow + a touch faster rotation. Quiet/idle is a calm, slow
// breathing undulation. The live level (agent playback when speaking, mic RMS
// otherwise) is eased so there's no jitter. `active` dims/calms the whole ring
// for idle/connecting/ended. Speaking nudges the palette warmer/brighter and
// reverses the gradient drift. Respects prefers-reduced-motion.
function VoiceOrb({
  micLevelRef,
  playerRef,
  mode,
  active = true,
}: {
  micLevelRef: MutableRefObject<number>;
  playerRef: RefObject<PCMPlayer | null>;
  mode: "listening" | "speaking";
  active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Conic gradient color stops: teal-forward, shimmering through cyan -> blue
    // with a hint of violet, then back to teal so it wraps seamlessly. `warm`
    // (0..1) nudges the whole sweep brighter/lighter when the agent speaks.
    const gradientStops = (warm: number) => {
      const L = (base: number) => `${Math.round(base + warm * 8)}%`;
      return [
        [0.0, `hsl(168, 80%, ${L(58)})`], // teal
        [0.22, `hsl(184, 85%, ${L(60)})`], // cyan
        [0.46, `hsl(205, 82%, ${L(58)})`], // blue
        [0.64, `hsl(255, 70%, ${L(64)})`], // hint of violet/indigo
        [0.82, `hsl(190, 84%, ${L(60)})`], // back through cyan
        [1.0, `hsl(168, 80%, ${L(58)})`], // teal (seamless wrap)
      ] as const;
    };

    let raf = 0;
    let smooth = 0; // smoothed audio level [0,1]
    let warmMix = 0; // 0 = listening, 1 = speaking (eased)
    let liveMix = active ? 1 : 0; // 0 = calm idle, 1 = engaged (eased)
    let t = 0; // animation clock
    let spin = 0; // accumulated gradient rotation (drifts, audio-reactive)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Build the wavy closed path for the ring's centre-line. The radius at each
    // angle is the base radius plus a few low-frequency sine terms (different
    // wave counts, phases, speeds) scaled by the wobble amplitude.
    const traceRing = (
      cx: number,
      cy: number,
      baseR: number,
      amp: number,
    ) => {
      const STEPS = 120;
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2;
        const wobble =
          Math.sin(a * 3 + t * 0.9) * 0.6 +
          Math.sin(a * 5 - t * 0.6 + 1.7) * 0.3 +
          Math.sin(a * 2 + t * 0.4 + 3.1) * 0.5;
        const r = baseR * (1 + amp * wobble);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      const speaking = modeRef.current === "speaking";
      const isActive = activeRef.current;
      const agent = playerRef.current?.level() ?? 0;
      const mic = micLevelRef.current ?? 0;
      // Decay the captured mic peak so quiet settles smoothly.
      micLevelRef.current = mic * 0.88;
      const raw = isActive ? (speaking ? Math.max(agent, mic * 0.5) : mic) : 0;
      // RMS is small; amplify, clamp, then ease hard so the ring swells gently.
      const target = Math.min(1, raw * 4.2);
      smooth += (target - smooth) * 0.12;
      warmMix += ((speaking ? 1 : 0) - warmMix) * 0.05;
      liveMix += ((isActive ? 1 : 0) - liveMix) * 0.05;

      t += reduced ? 0.004 : 0.012;

      // Energy = a slow breathing floor + the smoothed audio swell, damped down
      // in the calm idle state (and further when reduced-motion is set).
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.8);
      const idleFloor = 0.06 + 0.05 * breathe;
      const swell = (reduced ? smooth * 0.25 : smooth) * (reduced ? 0.5 : 1);
      const energy = (idleFloor + swell) * (0.45 + 0.55 * liveMix);

      // Gradient drift: always rotating slowly; faster with energy. Speaking
      // reverses the direction so listen/speak feel subtly different.
      const dir = warmMix > 0.5 ? -1 : 1;
      spin += dir * (reduced ? 0.001 : 0.0035 + energy * 0.012);

      // Geometry. The ring radius grows a little with energy; wobble amplitude
      // grows more, so loud input makes the edge visibly more liquid. Leave room
      // for the outer glow inside the canvas.
      const maxR = Math.min(w, h) / 2;
      const baseR = maxR * (0.5 + energy * 0.06);
      const amp = (0.04 + energy * 0.13) * (0.4 + 0.6 * liveMix);

      // Flowing conic gradient centered on the orb; rotated by `spin`.
      const grad = ctx.createConicGradient(spin, cx, cy);
      for (const [stop, color] of gradientStops(warmMix)) {
        grad.addColorStop(stop, color);
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const glow = 0.55 + 0.45 * liveMix; // overall luminance, dimmer when idle
      const bandW = maxR * (0.05 + energy * 0.03); // base band thickness

      // 1) Wide, heavily-blurred glow pass — soft light bleeding in/out.
      traceRing(cx, cy, baseR, amp);
      ctx.strokeStyle = grad;
      ctx.shadowColor = `hsla(186, 90%, 62%, ${(0.5 + energy * 0.4) * glow})`;
      ctx.shadowBlur = (22 + energy * 40) * (0.6 + 0.4 * liveMix);
      ctx.globalAlpha = (0.28 + energy * 0.25) * glow;
      ctx.lineWidth = bandW * 2.6;
      ctx.stroke();

      // 2) Mid pass — fills the band with the flowing color, moderate glow.
      traceRing(cx, cy, baseR, amp);
      ctx.strokeStyle = grad;
      ctx.shadowBlur = (10 + energy * 16) * (0.6 + 0.4 * liveMix);
      ctx.globalAlpha = (0.55 + energy * 0.25) * glow;
      ctx.lineWidth = bandW * 1.3;
      ctx.stroke();

      // 3) Narrow bright core — a crisp luminous line along the band.
      traceRing(cx, cy, baseR, amp);
      ctx.strokeStyle = `hsla(190, 100%, ${82 + warmMix * 8}%, ${(0.6 + energy * 0.35) * glow})`;
      ctx.shadowColor = `hsla(186, 100%, 75%, ${0.6 * glow})`;
      ctx.shadowBlur = 6 + energy * 8;
      ctx.globalAlpha = (0.7 + energy * 0.3) * glow;
      ctx.lineWidth = Math.max(1, bandW * 0.4);
      ctx.stroke();

      ctx.restore();

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [micLevelRef, playerRef, active]);

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

  // The orb is the hero in every non-error state. It renders immediately —
  // calm and dimmed when idle/ended, fully engaged when live — so the modal is
  // never an empty box. A fixed-height stage keeps the layout from jumping as
  // the state (and the copy beneath the orb) changes.
  if (state !== "error") {
    const connecting = state === "requesting" || state === "connecting";
    const live = state === "live";
    const speaking = mode === "speaking";
    // One short, muted caption under the orb while live — latest reply if the
    // agent is speaking, otherwise the latest thing we heard. Not a log.
    const caption = speaking ? reply : transcript;

    return (
      <div className="relative flex flex-col items-center">
        {/* Countdown — small, tucked into the corner; only while live. */}
        <span
          className={`absolute right-0 top-0 font-mono text-xs tabular-nums text-muted-foreground/70 transition-opacity duration-300 ${
            live ? "opacity-100" : "opacity-0"
          }`}
        >
          {timeLeft}s
        </span>

        {/* The orb — always present, the centerpiece. Idle/ended render it
            dimmed and slowly breathing; idle doubles the orb as the start
            affordance (tap to talk). */}
        <button
          type="button"
          onClick={state === "idle" ? startDemo : undefined}
          disabled={state !== "idle"}
          aria-label={state === "idle" ? "Tap to talk" : undefined}
          className={`grid place-items-center rounded-full transition-transform duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card ${
            state === "idle" ? "cursor-pointer hover:scale-[1.03]" : "cursor-default"
          }`}
        >
          <VoiceOrb
            micLevelRef={micLevelRef}
            playerRef={playerRef}
            mode={mode}
            active={live}
          />
        </button>

        {/* Status / label line — one line, fixed height so nothing shifts. */}
        <p className="mt-4 h-5 text-sm font-medium text-foreground/80">
          {state === "idle" && "Tap to talk"}
          {connecting && <span className="animate-pulse text-muted-foreground">Connecting…</span>}
          {live && (speaking ? "Steward is speaking" : "Listening…")}
          {state === "ended" && "Session ended"}
        </p>

        {/* Secondary line — muted caption while live, a prompt otherwise.
            Fixed height keeps the modal balanced across states. */}
        <p className="mt-1 h-5 max-w-[18rem] truncate text-center text-xs text-muted-foreground">
          {live && caption}
          {state === "idle" && "A quick 75-second conversation."}
          {state === "ended" && "Ready to use StewardAI in your own meetings?"}
        </p>

        {/* Action row — fixed height; content swaps by state. */}
        <div className="mt-6 flex h-9 items-center justify-center">
          {live && (
            <button
              onClick={endDemo}
              className="text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              End session
            </button>
          )}
          {state === "ended" && (
            <a
              href="/auth/login"
              className="inline-block rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started free
            </a>
          )}
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="flex flex-col items-center space-y-2 py-10 text-center">
      <p className="text-muted-foreground">Demo unavailable right now &mdash; try again shortly.</p>
      <button onClick={() => setState("idle")} className="text-sm text-primary hover:underline">
        Retry
      </button>
    </div>
  );
}
