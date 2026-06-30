"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Plus } from "lucide-react";
import {
  GmailIcon,
  GoogleCalendarIcon,
  NotionIcon,
  SlackIcon,
} from "./integration-icons";

// Per-bar peak heights for the voice waveform — reuses the `waveform-bar`
// rippling animation defined in globals.css (same visual as the hero panel).
const BARS = [
  0.45, 0.7, 0.55, 0.9, 0.4, 0.65, 1, 0.5, 0.8, 0.35, 0.6, 0.95, 0.45, 0.75,
  0.55, 0.85, 0.4, 0.7, 0.5, 0.9, 0.6, 0.45, 0.8, 0.35,
];

// Two kinds of Stage-C outcome cycle through the loop:
//  - "summary": a spoken line distilled into a summary + two auto-ticking
//    action items (the original behaviour).
//  - "action": a voice *command* the agent carries out in an integration —
//    tool icon + intent → "Processing…" → a green "done" result line.
type SummarySnippet = {
  kind: "summary";
  speaker: string;
  line: string;
  summaryLabel: string;
  summary: string;
  actions: [string, string];
};

type Integration = "calendar" | "gmail" | "notion";

type ActionSnippet = {
  kind: "action";
  speaker: string;
  line: string;
  integration: Integration;
  tool: string; // e.g. "Google Calendar"
  intent: string; // e.g. "New event"
  result: string; // e.g. "Meeting booked · Fri 3:00 PM"
};

type Snippet = SummarySnippet | ActionSnippet;

const SNIPPETS: Snippet[] = [
  {
    kind: "summary",
    speaker: "Anique",
    line: "…let's ship Friday and circle back next week.",
    summaryLabel: "Ship date",
    summary: "Friday",
    actions: ["Send recap to the team", "Book follow-up for next week"],
  },
  {
    kind: "action",
    speaker: "Anique",
    line: "Book a follow-up with Priya, Friday at 3.",
    integration: "calendar",
    tool: "Google Calendar",
    intent: "New event",
    result: "Meeting booked · Fri 3:00 PM",
  },
  {
    kind: "action",
    speaker: "Anique",
    line: "Send the recap to the team.",
    integration: "gmail",
    tool: "Gmail",
    intent: "New email",
    result: "Email sent to 4 people",
  },
  {
    kind: "summary",
    speaker: "Dev",
    line: "Push the launch a week — design needs more time.",
    summaryLabel: "Decision",
    summary: "Launch moved +1 week",
    actions: ["Update the roadmap", "Notify the design team"],
  },
  {
    kind: "action",
    speaker: "Anique",
    line: "Save these notes to the project doc.",
    integration: "notion",
    tool: "Notion",
    intent: "Append to page",
    result: "Saved to Notion · Project Atlas",
  },
];

const INTEGRATION_META: Record<
  Integration,
  { Icon: (p: { className?: string }) => JSX.Element; tint: string }
> = {
  // tint = brand color, used sparingly on the icon tile against the dark theme.
  calendar: { Icon: GoogleCalendarIcon, tint: "#4285F4" },
  gmail: { Icon: GmailIcon, tint: "#EA4335" },
  notion: { Icon: NotionIcon, tint: "#E9E9E7" },
};

// Animation phases for a single snippet, in order. Each phase has a duration;
// the reducer advances through them and then loops to the next snippet.
// Summary snippets use tick1/tick2; action snippets reuse the same two beats
// as "processing" (tick1) → "done" (tick2).
type Phase =
  | "voice" // Stage A active — waveform pulsing
  | "typing" // Stage B — transcript streams in
  | "settled" // transcript complete, work begins (card appears)
  | "tick1" // summary: first item ticks / action: Processing…
  | "tick2" // summary: second item ticks / action: Done
  | "hold"; // brief hold on the completed card, then loop

const PHASE_ORDER: Phase[] = ["voice", "typing", "settled", "tick1", "tick2", "hold"];

const PHASE_MS: Record<Phase, number> = {
  voice: 1400,
  typing: 1800,
  settled: 700,
  tick1: 900, // doubles as the "Processing…" dwell for action cards
  tick2: 900,
  hold: 1700,
};

type State = { snippet: number; phaseIdx: number };

function reducer(state: State): State {
  const nextPhase = state.phaseIdx + 1;
  if (nextPhase >= PHASE_ORDER.length) {
    return { snippet: (state.snippet + 1) % SNIPPETS.length, phaseIdx: 0 };
  }
  return { ...state, phaseIdx: nextPhase };
}

// How far the transcript has progressed, by phase.
function phaseRank(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

export function VoiceToWork() {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    // Static end-state: waveform + a finished command transcript + ONE
    // completed action card (calendar "Meeting booked"). No timers, no loop.
    return (
      <>
        <Stage snippet={SNIPPETS[1]} phase="hold" reduced />
        <WorksWith />
      </>
    );
  }

  return (
    <>
      <AnimatedStage />
      <WorksWith />
    </>
  );
}

function AnimatedStage() {
  const [state, dispatch] = useReducer(reducer, { snippet: 0, phaseIdx: 0 });
  const phase = PHASE_ORDER[state.phaseIdx];

  // Schedule the next phase transition off the current phase's duration.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const id = setTimeout(() => dispatchRef.current(), PHASE_MS[phase]);
    return () => clearTimeout(id);
  }, [phase, state.snippet]);

  return <Stage snippet={SNIPPETS[state.snippet]} phase={phase} />;
}

// Typewriter reveal for the transcript line. Resets whenever the line changes
// or the typing phase (re)starts; freezes fully revealed once past "typing".
function useTypewriter(text: string, active: boolean, full: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (full) {
      setCount(text.length);
      return;
    }
    if (!active) {
      setCount(0);
      return;
    }
    setCount(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) clearInterval(id);
    }, Math.max(18, Math.floor(PHASE_MS.typing / text.length)));
    return () => clearInterval(id);
  }, [text, active, full]);

  return text.slice(0, count);
}

function Stage({
  snippet,
  phase,
  reduced = false,
}: {
  snippet: Snippet;
  phase: Phase;
  reduced?: boolean;
}) {
  const rank = phaseRank(phase);
  const voiceActive = phase === "voice";
  const typing = phase === "typing";
  const transcriptShown = rank >= phaseRank("typing");
  const workShown = rank >= phaseRank("settled");
  const tick1 = reduced || rank >= phaseRank("tick1");
  const tick2 = reduced || rank >= phaseRank("tick2");

  const typed = useTypewriter(snippet.line, typing, reduced || rank > phaseRank("typing"));

  return (
    <div className="card-ring overflow-hidden rounded-2xl shadow-2xl shadow-black/40">
      {/* Window chrome — matches the live-session panel elsewhere on the page. */}
      <div className="flex items-center gap-2 border-b border-border bg-background/60 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-primary/70" aria-hidden />
        <span className="ml-2 font-mono text-xs text-muted-foreground">
          steward · voice → work
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-primary">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
          live
        </span>
      </div>

      {/* Three stages: side-by-side on sm+, stacked top-to-bottom on mobile.
          A faint connecting arrow flows speech → text → work. */}
      <div className="relative grid items-stretch gap-px bg-border sm:grid-cols-[0.9fr_1.2fr_1fr]">
        {/* Stage A — Voice */}
        <StageCell label="Voice" active={voiceActive || reduced}>
          <div className="flex h-full flex-col justify-center">
            <div
              className="flex h-12 items-center justify-between gap-[2px]"
              aria-hidden
            >
              {BARS.map((h, i) => (
                <span
                  key={i}
                  className="waveform-bar w-[2px] flex-1 rounded-full bg-primary/70"
                  style={{
                    ["--peak" as string]: h,
                    animationDelay: `${(i % 8) * 0.09}s`,
                    // Idle the waveform between speaking phases so the "active"
                    // pulse reads as live speech rather than a constant loop.
                    animationPlayState: reduced || voiceActive ? "running" : "paused",
                    opacity: reduced || voiceActive ? 1 : 0.4,
                  }}
                />
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {voiceActive || reduced ? "Listening…" : "Captured"}
            </p>
          </div>
          <Flow />
        </StageCell>

        {/* Stage B — Transcript */}
        <StageCell label="Transcript" active={transcriptShown}>
          <div
            className={`flex h-full flex-col justify-center transition-opacity duration-500 ${
              transcriptShown ? "opacity-100" : "opacity-0"
            }`}
          >
            <p className="text-sm">
              <span className="font-medium text-primary">{snippet.speaker}</span>
              <br />
              <span className="text-foreground">
                &ldquo;{typed}
                {typing && (
                  <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-primary align-middle" />
                )}
                {(reduced || phaseRank(phase) > phaseRank("typing")) && "”"}
              </span>
            </p>
          </div>
          <Flow />
        </StageCell>

        {/* Stage C — Work (summary card or integration-action card) */}
        <StageCell label="Work" active={workShown}>
          <div
            className={`flex h-full flex-col justify-center gap-3 transition-all duration-500 ${
              workShown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            {snippet.kind === "summary" ? (
              <SummaryCard snippet={snippet} tick1={tick1} tick2={tick2} />
            ) : (
              <ActionCard
                snippet={snippet}
                processing={tick1 && !tick2}
                done={tick2}
              />
            )}
          </div>
        </StageCell>
      </div>
    </div>
  );
}

function SummaryCard({
  snippet,
  tick1,
  tick2,
}: {
  snippet: SummarySnippet;
  tick1: boolean;
  tick2: boolean;
}) {
  return (
    <>
      <div className="rounded-lg border border-border bg-background/40 p-3">
        <p className="text-[11px] font-medium text-muted-foreground">
          {snippet.summaryLabel}
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">
          {snippet.summary}
        </p>
      </div>
      <ul className="space-y-2 text-sm">
        <ActionItem label={snippet.actions[0]} done={tick1} />
        <ActionItem label={snippet.actions[1]} done={tick2} />
      </ul>
    </>
  );
}

// Integration-action card: brand tile + intent, then a status row that
// transitions from "Processing…" (spinner) to a green "done" result line.
function ActionCard({
  snippet,
  processing,
  done,
}: {
  snippet: ActionSnippet;
  processing: boolean;
  done: boolean;
}) {
  const { Icon, tint } = INTEGRATION_META[snippet.integration];
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-background/60"
          style={{ color: tint }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {snippet.tool}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {snippet.intent}
          </p>
        </div>
      </div>

      <div className="mt-3 min-h-[1.25rem] border-t border-border/60 pt-2.5 text-sm">
        {done ? (
          <span className="flex items-center gap-2 text-foreground">
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="truncate">{snippet.result}</span>
          </span>
        ) : processing ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
            Processing…
          </span>
        ) : (
          <span className="text-muted-foreground">Ready</span>
        )}
      </div>
    </div>
  );
}

function StageCell({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative bg-card p-5 sm:p-6">
      <p
        className={`font-mono text-[11px] uppercase tracking-wider transition-colors duration-300 ${
          active ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {label}
      </p>
      <div className="mt-4 min-h-[5.5rem]">{children}</div>
    </div>
  );
}

function ActionItem({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-all duration-300 ${
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-transparent text-transparent"
        }`}
        aria-hidden
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span
        className={`transition-colors duration-300 ${
          done ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
    </li>
  );
}

// Faint connecting flow between stages: an arrow on the right edge pointing
// right when laid out side-by-side (sm+), and on the bottom edge pointing down
// when the stages stack vertically on mobile.
function Flow() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 -translate-y-1/2 text-primary/50 sm:left-full sm:top-1/2 sm:-translate-x-1/2"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full border border-border bg-background">
        <ArrowRight className="h-3.5 w-3.5 rotate-90 sm:rotate-0" />
      </span>
    </span>
  );
}

// Low-emphasis "Works with" row signalling integration breadth. Same inline
// SVG marks; muted styling, wraps rather than overflowing on mobile.
function WorksWith() {
  const items: { label: string; Icon: (p: { className?: string }) => JSX.Element }[] = [
    { label: "Google Calendar", Icon: GoogleCalendarIcon },
    { label: "Gmail", Icon: GmailIcon },
    { label: "Notion", Icon: NotionIcon },
    { label: "Slack", Icon: SlackIcon },
  ];
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
        Works with
      </span>
      <div className="flex flex-wrap items-center gap-3">
        {items.map(({ label, Icon }) => (
          <span
            key={label}
            title={label}
            className="grid h-7 w-7 place-items-center rounded-lg border border-border/60 bg-card/60 text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
          <Plus className="h-3 w-3" aria-hidden />
          more
        </span>
      </div>
    </div>
  );
}

// Tracks the user's reduced-motion preference (and reacts to changes).
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
