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

// Audio-reactive voice orb — the proven three-ring visualizer ported verbatim
// from the backend /pipeline page (web/static/pipeline.html `drawOrb`). Three
// undulating closed rings (teal / blue / violet) are stroked with additive
// ("lighter") blending and a soft shadow glow, so the light adds up into a
// hollow, flowing orb; the dark modal background shows through the center.
//
// Each ring's radius at angle `a` is the base radius plus two sine terms at
// wave-counts 3 and 5, animated by a shared clock `animT` at the layer's speed
// and phase offset. Louder audio raises the wobble amplitude `amp`; `active`
// dims the whole orb when idle. The live level (agent playback when speaking,
// mic RMS otherwise) is eased with a 0.06 factor and `animT` advances 0.015/frame
// — exactly matching the source constants. Respects prefers-reduced-motion by
// slowing the clock and damping the audio swell, keeping the same three rings.
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
    const g = canvas.getContext("2d");
    if (!g) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // The three additive rings — ported verbatim from pipeline.html.
    const LAYERS = [
      { color: "#22d3ee", off: 0, speed: 0.8 },
      { color: "#3b82f6", off: 2.1, speed: -1.0 },
      { color: "#a855f7", off: 4.2, speed: 0.6 },
    ] as const;

    let raf = 0;
    let animT = 0; // animation clock (advances 0.015/frame, as in source)
    let smoothLevel = 0; // eased audio level [0,1] (0.06 smoothing, as in source)

    // Drawing dimensions in CSS-pixel space. DPR is applied via ctx transform so
    // `base = min(w,h)*0.26` stays in the source's coordinate space while the
    // backing store is scaled for crisp retina rendering.
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Faithful reproduction of drawOrb(level) — three undulating rings, additive
    // glow. `level` is the smoothed 0..1 audio level. Coordinates are CSS pixels.
    const drawOrb = (level: number) => {
      const cx = w / 2;
      const cy = h / 2;
      const active = activeRef.current;
      const speaking = modeRef.current === "speaking";
      g.clearRect(0, 0, w, h);
      const base = Math.min(w, h) * 0.26;
      const amp = base * 0.09 + level * base * 0.32;
      g.globalCompositeOperation = "lighter";
      for (const L of LAYERS) {
        g.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.02; a += 0.04) {
          const r =
            base +
            Math.sin(a * 3 + animT * L.speed + L.off) * amp +
            Math.sin(a * 5 - animT * L.speed * 0.7 + L.off) * amp * 0.5;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (a === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
        g.strokeStyle = L.color;
        g.lineWidth = 3;
        g.shadowColor = L.color;
        g.shadowBlur = 22;
        // dimmer when idle; a touch brighter when the agent is speaking
        g.globalAlpha = active ? (speaking ? 0.85 : 0.78) : 0.4;
        g.stroke();
      }
      g.globalAlpha = 1;
      g.shadowBlur = 0;
      g.globalCompositeOperation = "source-over";
    };

    const loop = () => {
      // Reduced motion: nearly-freeze the clock and damp the audio contribution,
      // keeping the same three-ring visual.
      animT += reduced ? 0.003 : 0.015;
      const active = activeRef.current;
      const speaking = modeRef.current === "speaking";
      const agent = playerRef.current?.level() ?? 0;
      const mic = micLevelRef.current ?? 0;
      // Decay the captured mic peak so quiet settles smoothly (source: micLevel *= 0.9).
      micLevelRef.current = mic * 0.9;
      const live = speaking ? Math.max(agent, mic) : Math.max(mic, agent);
      let target = active ? live : 0;
      if (reduced) target *= 0.35; // damp swell amplitude under reduced motion
      smoothLevel += (target - smoothLevel) * 0.06;
      drawOrb(smoothLevel);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

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
