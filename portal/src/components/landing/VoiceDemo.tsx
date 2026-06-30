"use client";

import { useEffect, useRef, useState } from "react";

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

// Start streaming 20 ms s16le/16 kHz frames to onFrame.
async function startMic(onFrame: (buf: ArrayBuffer) => void): Promise<MicHandle> {
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

// PCM playback: queued s16le/16 kHz mono frames scheduled gaplessly.
class PCMPlayer {
  private ctx: AudioContext;
  private cursor = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(rate = TARGET_RATE) {
    const AudioContextClass =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass!({ sampleRate: rate });
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
    node.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    const start = Math.max(now, this.cursor);
    node.start(start);
    this.cursor = start + buf.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
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

export function VoiceDemo() {
  const [state, setState] = useState<DemoState>("idle");
  const [timeLeft, setTimeLeft] = useState(SESSION_LIMIT_MS / 1000);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionActiveRef = useRef(false);

  function cleanup() {
    sessionActiveRef.current = false;
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
          const mic = await startMic((buf) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(buf);
          });
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
          playerRef.current?.flush();
        } else if (msg.type === "reply") {
          setReply(msg.text ?? "");
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
    return (
      <div className="space-y-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
          <span className="font-medium text-foreground">Live &mdash; {timeLeft}s remaining</span>
        </div>
        {transcript && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">You:</span> {transcript}
          </p>
        )}
        {reply && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">StewardAI:</span> {reply}
          </p>
        )}
        <button
          onClick={endDemo}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
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
