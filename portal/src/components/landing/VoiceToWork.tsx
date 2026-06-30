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

type Integration = "calendar" | "gmail" | "notion";

// One integration the agent runs as part of working through a meeting.
type IntegrationRow = {
  integration: Integration;
  tool: string; // e.g. "Google Calendar"
  task: string; // collapsed label, e.g. "Book follow-up, Friday 3pm"
  result: string; // done line, e.g. "Meeting booked · Fri 3:00 PM"
};

// A meeting scenario: a spoken line → a summary header → 3 integrations the
// agent works through one at a time.
type Snippet = {
  speaker: string;
  line: string;
  summary: string; // header, e.g. "Sync with Priya — 3 follow-ups"
  rows: [IntegrationRow, IntegrationRow, IntegrationRow];
};

const SNIPPETS: Snippet[] = [
  {
    speaker: "Anique",
    line: "Sync with Priya — book a follow-up Friday, recap the team, save the notes.",
    summary: "Sync with Priya — 3 follow-ups",
    rows: [
      {
        integration: "calendar",
        tool: "Google Calendar",
        task: "Book follow-up, Friday 3pm",
        result: "Meeting booked · Fri 3:00 PM",
      },
      {
        integration: "gmail",
        tool: "Gmail",
        task: "Send recap to the team",
        result: "Email sent to 4 people",
      },
      {
        integration: "notion",
        tool: "Notion",
        task: "Save notes to Project Atlas",
        result: "Saved to Notion",
      },
    ],
  },
  {
    speaker: "Dev",
    line: "Launch slips a week — update the roadmap, email design, and log it.",
    summary: "Launch review — 3 actions",
    rows: [
      {
        integration: "notion",
        tool: "Notion",
        task: "Update roadmap — launch +1 week",
        result: "Roadmap updated",
      },
      {
        integration: "gmail",
        tool: "Gmail",
        task: "Notify the design team",
        result: "Email sent to design",
      },
      {
        integration: "calendar",
        tool: "Google Calendar",
        task: "Move launch date to next Fri",
        result: "Event moved · next Fri",
      },
    ],
  },
];

const INTEGRATION_META: Record<
  Integration,
  { Icon: (p: { className?: string }) => JSX.Element }
> = {
  calendar: { Icon: GoogleCalendarIcon },
  gmail: { Icon: GmailIcon },
  notion: { Icon: NotionIcon },
};

// ---------------------------------------------------------------------------
// Timeline state machine
//
// Each snippet plays: voice → typing → settled, then the sequential RUNNER
// works the 3 rows one at a time:
//   for each row i: expand(i) → processing(i) → done(i) → collapse(i)
// then a brief hold with all three "done", then advance to the next snippet.
//
// The runner is modelled as discrete steps so timing is a simple per-step
// duration table and the reducer just walks the list and loops.
// ---------------------------------------------------------------------------

type Step =
  | { kind: "voice" }
  | { kind: "typing" }
  | { kind: "settled" } // card + collapsed rows appear
  | { kind: "expand"; row: number } // row i expands open
  | { kind: "processing"; row: number } // spinner + "Processing…"
  | { kind: "result"; row: number } // green check + result line (expanded)
  | { kind: "collapse"; row: number } // row i collapses to compact done
  | { kind: "hold" }; // all three done, brief pause, then loop

// Per-row sub-state derived from the active step.
type RowState = "pending" | "expanded" | "processing" | "result" | "done";

const STEP_MS = {
  voice: 1400,
  typing: 1800,
  settled: 550,
  expand: 320,
  processing: 950,
  result: 600,
  collapse: 320,
  hold: 1500,
} as const;

function buildTimeline(): Step[] {
  const steps: Step[] = [{ kind: "voice" }, { kind: "typing" }, { kind: "settled" }];
  for (let row = 0; row < 3; row += 1) {
    steps.push({ kind: "expand", row });
    steps.push({ kind: "processing", row });
    steps.push({ kind: "result", row });
    steps.push({ kind: "collapse", row });
  }
  steps.push({ kind: "hold" });
  return steps;
}

const TIMELINE = buildTimeline();

function stepMs(step: Step): number {
  return STEP_MS[step.kind];
}

type State = { snippet: number; stepIdx: number };

function reducer(state: State): State {
  const next = state.stepIdx + 1;
  if (next >= TIMELINE.length) {
    return { snippet: (state.snippet + 1) % SNIPPETS.length, stepIdx: 0 };
  }
  return { ...state, stepIdx: next };
}

// Resolve each row's sub-state for the current step. Rows before the active
// one are "done", the active row tracks the step, later rows are "pending".
function rowStatesFor(step: Step): [RowState, RowState, RowState] {
  const out: RowState[] = ["pending", "pending", "pending"];
  if (
    step.kind === "expand" ||
    step.kind === "processing" ||
    step.kind === "result" ||
    step.kind === "collapse"
  ) {
    for (let i = 0; i < step.row; i += 1) out[i] = "done";
    out[step.row] =
      step.kind === "expand"
        ? "expanded"
        : step.kind === "processing"
          ? "processing"
          : step.kind === "result"
            ? "result"
            : "done"; // collapse → settles into compact done
  } else if (step.kind === "hold") {
    out[0] = out[1] = out[2] = "done";
  }
  return out as [RowState, RowState, RowState];
}

export function VoiceToWork() {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    // Static end-state: all three integration rows in their collapsed DONE
    // state. No timers, no loop.
    return (
      <>
        <Stage
          snippet={SNIPPETS[0]}
          step={{ kind: "hold" }}
          rowStates={["done", "done", "done"]}
          transcriptFull
          reduced
        />
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
  const [state, dispatch] = useReducer(reducer, { snippet: 0, stepIdx: 0 });
  const step = TIMELINE[state.stepIdx];

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const id = setTimeout(() => dispatchRef.current(), stepMs(step));
    return () => clearTimeout(id);
  }, [step, state.snippet]);

  return (
    <Stage
      snippet={SNIPPETS[state.snippet]}
      step={step}
      rowStates={rowStatesFor(step)}
    />
  );
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
    }, Math.max(18, Math.floor(STEP_MS.typing / text.length)));
    return () => clearInterval(id);
  }, [text, active, full]);

  return text.slice(0, count);
}

function Stage({
  snippet,
  step,
  rowStates,
  transcriptFull = false,
  reduced = false,
}: {
  snippet: Snippet;
  step: Step;
  rowStates: [RowState, RowState, RowState];
  transcriptFull?: boolean;
  reduced?: boolean;
}) {
  const voiceActive = step.kind === "voice";
  const typing = step.kind === "typing";

  // Stage progression: transcript shows from "typing" on; work shows once the
  // timeline reaches "settled" (i.e. anything past voice/typing).
  const pastTyping =
    transcriptFull || (step.kind !== "voice" && step.kind !== "typing");
  const transcriptShown = transcriptFull || step.kind !== "voice";
  const workShown = pastTyping;

  const typed = useTypewriter(snippet.line, typing, transcriptFull || pastTyping);

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
      <div className="relative grid items-stretch gap-px bg-border sm:grid-cols-[0.9fr_1.1fr_1.2fr]">
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
                {(transcriptFull || pastTyping) && "”"}
              </span>
            </p>
          </div>
          <Flow />
        </StageCell>

        {/* Stage C — Work (sequential integration runner) */}
        <StageCell label="Work" active={workShown}>
          <div
            className={`flex h-full flex-col transition-all duration-500 ${
              workShown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            <RunnerCard snippet={snippet} rowStates={rowStates} />
          </div>
        </StageCell>
      </div>
    </div>
  );
}

// Sequential integration runner: a summary header + 3 integration rows that
// run one at a time (expand → processing → done → collapse). FIXED height so
// the hero never reflows as rows expand and collapse.
function RunnerCard({
  snippet,
  rowStates,
}: {
  snippet: Snippet;
  rowStates: [RowState, RowState, RowState];
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {snippet.summary}
        </p>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {rowStates.filter((s) => s === "done").length}/3
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {snippet.rows.map((row, i) => (
          <RunnerRow key={`${snippet.summary}-${i}`} row={row} state={rowStates[i]} />
        ))}
      </ul>
    </div>
  );
}

// A single integration row. Collapsed (pending/done) it's a compact tile+label
// line; active it expands to reveal a processing/result status block. The
// expandable block uses a grid-rows trick for a smooth height transition; the
// outer row is a fixed-height container so neighbours never shift.
function RunnerRow({ row, state }: { row: IntegrationRow; state: RowState }) {
  const { Icon } = INTEGRATION_META[row.integration];
  const expanded = state === "expanded" || state === "processing" || state === "result";
  const done = state === "done";

  return (
    <li
      className={`rounded-lg border bg-background/40 transition-colors duration-300 ${
        expanded ? "border-primary/40" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        {/* Brand tile — neutral/white so multi-color marks read on dark. */}
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white shadow-sm shadow-black/20">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[13px] transition-colors duration-300 ${
              expanded || done ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {row.task}
          </p>
        </div>
        {/* Compact done check on collapsed rows. */}
        <span
          className={`grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-all duration-300 ${
            done ? "scale-100 opacity-100" : "scale-75 opacity-0"
          }`}
          aria-hidden
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </div>

      {/* Expandable status region: grid-template-rows 0fr → 1fr animates height. */}
      <div
        className={`grid transition-all duration-300 ease-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mx-2.5 mb-2 border-t border-border/60 pt-2 text-[13px]">
            {state === "result" ? (
              <span className="flex items-center gap-2 text-foreground">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="truncate">{row.result}</span>
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                Processing…
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
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
      {/* Fixed min-height reserves room for the header + 3 rows (one expanded)
          so the hero never reflows as rows open and close. */}
      <div className="mt-4 min-h-[12.5rem]">{children}</div>
    </div>
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

// Low-emphasis "Works with" row signalling integration breadth — official
// multi-color marks on small white tiles; wraps rather than overflowing.
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
            className="grid h-7 w-7 place-items-center rounded-lg bg-white shadow-sm shadow-black/20"
          >
            <Icon className="h-4 w-4" />
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
