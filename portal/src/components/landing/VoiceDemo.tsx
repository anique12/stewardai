"use client";

import { useEffect, useRef, useState } from "react";

type DemoState = "idle" | "requesting" | "connecting" | "live" | "ended" | "error";

const SESSION_LIMIT_MS = 75_000; // 75 seconds

export function VoiceDemo() {
  const [state, setState] = useState<DemoState>("idle");
  const [timeLeft, setTimeLeft] = useState(SESSION_LIMIT_MS / 1000);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function cleanup() {
    wsRef.current?.close();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
  }

  useEffect(() => () => cleanup(), []);

  async function startDemo() {
    setState("requesting");
    try {
      // Get demo token
      const res = await fetch("/api/demo-token");
      if (!res.ok) {
        setState("error");
        return;
      }
      const { token } = await res.json();

      // Request mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      setState("connecting");
      const wsUrl = `${process.env.NEXT_PUBLIC_DEMO_WS_URL ?? ""}?token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setState("live");
        setTimeLeft(SESSION_LIMIT_MS / 1000);
        // Countdown timer
        timerRef.current = setInterval(() => {
          setTimeLeft((t) => {
            if (t <= 1) { endDemo(); return 0; }
            return t - 1;
          });
        }, 1000);
        // Send audio via MediaRecorder in 100ms chunks
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recorder.ondataavailable = (e) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        recorder.start(100);
      };

      ws.onclose = () => {
        setState((prev) => prev !== "ended" ? "ended" : prev);
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
      <button onClick={startDemo}
        className="rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
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
        <button onClick={endDemo}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
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
        <a href="/auth/login"
          className="inline-block rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Get started free
        </a>
      </div>
    );
  }

  // error
  return (
    <div className="space-y-2 text-center">
      <p className="text-muted-foreground">Demo unavailable right now &mdash; try again shortly.</p>
      <button onClick={() => setState("idle")} className="text-sm text-primary hover:underline">Retry</button>
    </div>
  );
}
