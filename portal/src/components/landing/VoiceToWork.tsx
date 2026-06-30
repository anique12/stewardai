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
  0.55, 0.85, 0.4, 0.7, 0.5, 0.9, 0.6, 0.45, 0.8, 0.35, 0.7, 0.5, 0.85, 0.4,
];

type Integration = "calendar" | "gmail" | "notion";

// One integration the agent runs as part of working through a meeting. Each
// row also carries the moment (ms into the work phase) at which it flips from
// "Processing…" to its done state — so the three complete at staggered times.
type IntegrationRow = {
  integration: Integration;
  tool: string; // e.g. "Google Calendar"
  task: string; // label, e.g. "Book follow-up, Friday 3pm"
  result: string; // done line, e.g. "Meeting booked · Fri 3:00 PM"
  doneAt: number; // ms after the work phase begins
};

// A single transcript turn from one of the meeting's speakers.
type Turn = { speaker: string; line: string };

// A meeting scenario: a short multi-speaker transcript snippet → a summary
// header → 3 integrations the agent runs in parallel (staggered completion).
type Snippet = {
  turns: Turn[]; // multi-speaker transcript, streamed in order
  summary: string; // header, e.g. "Sync with Priya — 3 follow-ups"
  rows: [IntegrationRow, IntegrationRow, IntegrationRow];
};

const SNIPPETS: Snippet[] = [
  {
    turns: [
      { speaker: "Anique", line: "Good sync — let's lock the next steps." },
      { speaker: "Priya", line: "Sounds good. Friday afternoon works for me." },
      { speaker: "Anique", line: "Book the follow-up for Friday at 3." },
      { speaker: "Priya", line: "And loop in the team with a quick recap?" },
      { speaker: "Anique", line: "Yep — recap the team and save the notes to Atlas." },
    ],
    summary: "Sync with Priya — 3 follow-ups",
    rows: [
      {
        integration: "calendar",
        tool: "Google Calendar",
        task: "Book follow-up, Friday 3pm",
        result: "Meeting booked · Fri 3:00 PM",
        doneAt: 1000,
      },
      {
        integration: "gmail",
        tool: "Gmail",
        task: "Send recap to the team",
        result: "Email sent to 4 people",
        doneAt: 1900,
      },
      {
        integration: "notion",
        tool: "Notion",
        task: "Save notes to Project Atlas",
        result: "Saved to Notion",
        doneAt: 2800,
      },
    ],
  },
  {
    turns: [
      { speaker: "Dev", line: "Heads up — the launch is slipping a week." },
      { speaker: "Maya", line: "Okay. Design needs to know before they ship copy." },
      { speaker: "Dev", line: "Push the roadmap date out one week." },
      { speaker: "Maya", line: "I'll re-time the assets once it's moved." },
      { speaker: "Dev", line: "Email design the change and log it on the calendar." },
    ],
    summary: "Launch review — 3 actions",
    rows: [
      {
        integration: "notion",
        tool: "Notion",
        task: "Update roadmap — launch +1 week",
        result: "Roadmap updated",
        doneAt: 850,
      },
      {
        integration: "gmail",
        tool: "Gmail",
        task: "Notify the design team",
        result: "Email sent to design",
        doneAt: 2000,
      },
      {
        integration: "calendar",
        tool: "Google Calendar",
        task: "Move launch date to next Fri",
        result: "Event moved · next Fri",
        doneAt: 2950,
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

// Per-speaker accent palette. Speakers are differentiated by ORDER of first
// appearance: the first speaker gets the brand accent, the second the sky tone.
// The Voice panel and the Transcript both resolve color through this so they
// always agree visually.
type SpeakerStyle = { text: string; ring: string; chipBg: string; bar: string };
const SPEAKER_STYLES: SpeakerStyle[] = [
  {
    text: "text-primary",
    ring: "ring-primary",
    chipBg: "bg-primary/15 text-primary",
    bar: "bg-primary/70",
  },
  {
    text: "text-sky-400",
    ring: "ring-sky-400",
    chipBg: "bg-sky-400/15 text-sky-400",
    bar: "bg-sky-400/70",
  },
];

// The ordered, de-duplicated list of speakers in a snippet (first-appearance
// order), each paired with its style. Two per scenario in practice.
function speakersOf(snippet: Snippet): { name: string; style: SpeakerStyle }[] {
  const seen: string[] = [];
  for (const t of snippet.turns) if (!seen.includes(t.speaker)) seen.push(t.speaker);
  return seen.map((name, i) => ({
    name,
    style: SPEAKER_STYLES[i % SPEAKER_STYLES.length],
  }));
}

// ---------------------------------------------------------------------------
// Timeline state machine
//
// Each snippet plays four coarse phases:
//   voice  → live capture; waveform active, transcript hidden
//   typing → multi-speaker transcript streams in, turn by turn
//   work   → all 3 integration rows enter "Processing…" together, then each
//            flips to its done state at its own `doneAt` offset (staggered,
//            in parallel — no expand/collapse, no per-row sequencing)
//   hold   → all three done, brief pause, then advance to the next snippet
//
// Rows never change height: the status area swaps IN PLACE from spinner to
// check + result with a fade. The reducer just walks the phases and loops.
// ---------------------------------------------------------------------------

type Phase = "voice" | "typing" | "work" | "hold";

// Longest row completion drives how long the work phase must run.
const MAX_DONE_AT = Math.max(
  ...SNIPPETS.flatMap((s) => s.rows.map((r) => r.doneAt)),
);

const PHASE_MS: Record<Phase, number> = {
  voice: 1400,
  typing: 2600, // streams ~5 turns
  work: MAX_DONE_AT + 700, // last row done + a beat
  hold: 1400,
};

const PHASE_ORDER: Phase[] = ["voice", "typing", "work", "hold"];

type State = { snippet: number; phaseIdx: number };

function reducer(state: State): State {
  const next = state.phaseIdx + 1;
  if (next >= PHASE_ORDER.length) {
    return { snippet: (state.snippet + 1) % SNIPPETS.length, phaseIdx: 0 };
  }
  return { ...state, phaseIdx: next };
}

export function VoiceToWork() {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    // Static end-state: all three integration rows DONE, full transcript
    // shown, voice panel resting. No timers, no loop.
    return (
      <>
        <Stage snippet={SNIPPETS[0]} phase="hold" reduced />
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

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(() => {
    const id = setTimeout(() => dispatchRef.current(), PHASE_MS[phase]);
    return () => clearTimeout(id);
  }, [phase, state.snippet]);

  return <Stage snippet={SNIPPETS[state.snippet]} phase={phase} />;
}

// Streams the multi-speaker transcript turn-by-turn during the "typing" phase
// and freezes fully revealed afterwards. Returns how many turns are visible
// and, for the in-flight turn, a typewriter slice of its text.
function useStreamedTurns(
  turns: Turn[],
  active: boolean,
  full: boolean,
): { visible: number; partial: string } {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (full || !active) {
      setTick(0);
      return;
    }
    setTick(0);
    let n = 0;
    const total = turns.reduce((a, t) => a + t.line.length, 0);
    const stepMs = Math.max(14, Math.floor(PHASE_MS.typing / (total + turns.length * 2)));
    const id = setInterval(() => {
      n += 1;
      setTick(n);
    }, stepMs);
    return () => clearInterval(id);
  }, [turns, active, full]);

  if (full) return { visible: turns.length, partial: "" };

  // Walk the running character budget across turns to find the in-flight one.
  let budget = tick;
  for (let i = 0; i < turns.length; i += 1) {
    const len = turns[i].line.length;
    if (budget < len) {
      return { visible: i, partial: turns[i].line.slice(0, budget) };
    }
    budget -= len + 2; // small inter-turn pause
  }
  return { visible: turns.length, partial: "" };
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
  // Stay in "listening" mode through BOTH the voice capture and the transcript
  // streaming ("typing") — the mic is still live while we transcribe. The
  // waveform only calms once we move to the work stage.
  const capturing = phase === "voice" || phase === "typing";
  const transcriptShown = reduced || phase !== "voice";
  const workShown = reduced || phase === "work" || phase === "hold";
  const transcriptFull = reduced || phase === "work" || phase === "hold";

  // Single source of truth for turn streaming. Both the Voice panel (active
  // speaker / highlight) and the Transcript panel read from this, so the
  // highlighted speaker can never desync from the streaming transcript line.
  const stream = useStreamedTurns(
    snippet.turns,
    phase === "typing",
    transcriptFull,
  );

  // The turn currently being spoken/streamed. During "typing" it's the
  // in-flight turn; once full (work/hold/reduced) it rests on the LAST turn,
  // matching the transcript's resting state. Before any turn is shown (the
  // brief "voice" warm-up) it's the first turn — the conversation's opener.
  const activeTurnIdx = transcriptFull
    ? snippet.turns.length - 1
    : stream.partial.length > 0
      ? stream.visible
      : Math.max(0, stream.visible - 1);
  const activeSpeaker = snippet.turns[activeTurnIdx]?.speaker;

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
          A faint connecting arrow flows speech → text → work. `items-stretch`
          forces all three columns to share the tallest column's height. */}
      <div className="relative grid items-stretch gap-px bg-border sm:grid-cols-[0.95fr_1.1fr_1.2fr]">
        {/* Stage A — Voice */}
        <StageCell label="Voice" active={capturing || reduced}>
          <VoicePanel
            snippet={snippet}
            active={capturing}
            reduced={reduced}
            activeSpeaker={activeSpeaker}
          />
          <Flow />
        </StageCell>

        {/* Stage B — Transcript */}
        <StageCell label="Transcript" active={transcriptShown}>
          <TranscriptPanel
            snippet={snippet}
            shown={transcriptShown}
            stream={stream}
            full={transcriptFull}
          />
          <Flow />
        </StageCell>

        {/* Stage C — Work (parallel integration runner) */}
        <StageCell label="Work" active={workShown}>
          <div
            className={`flex h-full flex-col transition-all duration-500 ${
              workShown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            <RunnerCard
              snippet={snippet}
              working={phase === "work"}
              done={reduced || phase === "hold"}
            />
          </div>
        </StageCell>
      </div>
    </div>
  );
}

// Live capture panel: a fuller animated waveform, a "● Listening" pulse, a
// ticking elapsed timer, and a multi-speaker participants list whose highlight
// tracks WHO is currently speaking. `activeSpeaker` is derived from the same
// streamed-turn state that drives the transcript, so the two never desync.
function VoicePanel({
  snippet,
  active,
  reduced,
  activeSpeaker,
}: {
  snippet: Snippet;
  active: boolean;
  reduced: boolean;
  activeSpeaker?: string;
}) {
  const live = active || reduced;
  const elapsed = useElapsed(active, reduced);
  const speakers = speakersOf(snippet);
  const current =
    speakers.find((s) => s.name === activeSpeaker) ?? speakers[0];
  const currentStyle = current?.style ?? SPEAKER_STYLES[0];

  return (
    <div className="flex h-full flex-col">
      {/* Status row: listening pulse + elapsed timer. */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span
            className={`h-1.5 w-1.5 rounded-full bg-destructive ${
              live && !reduced ? "animate-pulse" : live ? "" : "opacity-50"
            }`}
            aria-hidden
          />
          <span className={live ? "text-foreground" : "text-muted-foreground"}>
            {live ? "Listening" : "Captured"}
          </span>
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {elapsed}
        </span>
      </div>

      {/* Tall, full-width waveform fills the column body — tinted to whoever is
          currently speaking so it reads as that speaker's voice. */}
      <div className="flex flex-1 items-center" aria-hidden>
        <div className="flex h-20 w-full items-center justify-between gap-[2px]">
          {BARS.map((h, i) => (
            <span
              key={i}
              className={`waveform-bar w-[2px] flex-1 rounded-full transition-colors duration-300 ${currentStyle.bar}`}
              style={{
                ["--peak" as string]: h,
                animationDelay: `${(i % 8) * 0.09}s`,
                // Idle between speaking phases so the active pulse reads as
                // live speech rather than a constant loop; fully static under
                // reduced motion.
                animationPlayState: live && !reduced ? "running" : "paused",
                opacity: live ? 1 : 0.35,
              }}
            />
          ))}
        </div>
      </div>

      {/* Participants: the two speakers in this scenario. The one currently
          speaking gets an accent ring + a small pulse and brighter label; the
          other is dimmed. The highlight moves as the active turn changes.
          Fixed footprint (reserves room for both rows) so column height holds. */}
      <ul className="flex flex-col gap-1.5">
        {speakers.map(({ name, style }) => {
          const isActive = name === current?.name;
          return (
            <li key={name} className="flex min-w-0 items-center gap-2">
              <span
                className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold transition-all duration-300 ${
                  style.chipBg
                } ${isActive ? `ring-2 ${style.ring}` : "opacity-50"}`}
              >
                {name.slice(0, 1)}
                {isActive && live && !reduced && (
                  <span
                    className={`absolute inset-0 animate-ping rounded-full ring-2 ${style.ring} opacity-40`}
                    aria-hidden
                  />
                )}
              </span>
              <span
                className={`min-w-0 truncate text-xs transition-colors duration-300 ${
                  isActive ? "text-foreground" : "text-muted-foreground/60"
                }`}
              >
                <span className={isActive ? style.text : ""}>{name}</span>
                {isActive && (
                  <span className="text-muted-foreground"> speaking</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Multi-speaker transcript: short streamed turns from two speakers, labeled and
// weight/color-differentiated, that fill the column body.
function TranscriptPanel({
  snippet,
  shown,
  stream,
  full,
}: {
  snippet: Snippet;
  shown: boolean;
  stream: { visible: number; partial: string };
  full: boolean;
}) {
  const { visible, partial } = stream;
  // Resolve each speaker's accent the same way the Voice panel does, so the
  // two columns agree on which color belongs to which speaker.
  const colorOf = (name: string): string =>
    speakersOf(snippet).find((s) => s.name === name)?.style.text ??
    SPEAKER_STYLES[0].text;

  return (
    <div
      className={`flex h-full flex-col gap-2.5 transition-opacity duration-500 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {snippet.turns.map((turn, i) => {
        const isVisible = full || i < visible || (i === visible && partial.length > 0);
        const isPartial = !full && i === visible;
        const text = isPartial ? partial : turn.line;
        return (
          <p
            key={i}
            className={`min-w-0 text-[13px] leading-snug transition-opacity duration-300 ${
              isVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className={`mr-1.5 font-medium ${colorOf(turn.speaker)}`}>
              {turn.speaker}
            </span>
            <span className="text-foreground/90">
              {text}
              {isPartial && (
                <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-primary align-middle" />
              )}
            </span>
          </p>
        );
      })}
    </div>
  );
}

// Parallel integration runner: a summary header + 3 fixed-height integration
// rows. All three enter "Processing…" together when `working`, then each flips
// to done at its own `doneAt` offset. Rows never change height — the status
// area swaps in place with a fade, so the card never reflows.
function RunnerCard({
  snippet,
  working,
  done,
}: {
  snippet: Snippet;
  working: boolean;
  done: boolean;
}) {
  // Elapsed-ms clock that starts when the work phase begins; drives the
  // staggered per-row completion. Frozen (all done) during the hold phase.
  const elapsed = useWorkClock(working);
  const doneCount = snippet.rows.filter(
    (r) => done || (working && elapsed >= r.doneAt),
  ).length;

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {snippet.summary}
        </p>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {doneCount}/3
        </span>
      </div>
      <ul className="flex flex-1 flex-col gap-2">
        {snippet.rows.map((row, i) => {
          const rowDone = done || (working && elapsed >= row.doneAt);
          // Show the work state (spinner/check) once working starts or done.
          const activated = working || done;
          return (
            <RunnerRow
              key={`${snippet.summary}-${i}`}
              row={row}
              activated={activated}
              done={rowDone}
            />
          );
        })}
      </ul>
    </div>
  );
}

// A single fixed-height integration row: brand tile + task label, with the
// status line below swapping IN PLACE from "spinner + Processing…" to "check +
// result" via a cross-fade. Height is fixed so neighbours never shift.
function RunnerRow({
  row,
  activated,
  done,
}: {
  row: IntegrationRow;
  activated: boolean;
  done: boolean;
}) {
  const { Icon } = INTEGRATION_META[row.integration];

  return (
    <li
      className={`flex min-h-[3.75rem] flex-col justify-center gap-2 rounded-lg border bg-background/40 px-2.5 py-2.5 transition-colors duration-300 ${
        done ? "border-primary/40" : activated ? "border-primary/25" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2.5">
        {/* Brand tile — neutral/white so multi-color marks read on dark. */}
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white shadow-sm shadow-black/20">
          <Icon className="h-4 w-4" />
        </span>
        <p
          className={`min-w-0 flex-1 truncate text-[13px] transition-colors duration-300 ${
            activated ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {row.task}
        </p>
      </div>

      {/* Fixed-height status line: cross-fades spinner ↔ check + result in
          place — no height change. */}
      <div className="relative h-4 pl-[2.375rem] text-[12px]">
        {/* Processing… */}
        <span
          className={`absolute inset-0 flex items-center gap-1.5 text-muted-foreground transition-opacity duration-300 ${
            activated && !done ? "opacity-100" : "opacity-0"
          }`}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
          Processing…
        </span>
        {/* Done · result */}
        <span
          className={`absolute inset-0 flex items-center gap-1.5 transition-opacity duration-300 ${
            done ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
          <span className="min-w-0 truncate text-foreground">{row.result}</span>
        </span>
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
    <div className="relative flex flex-col bg-card p-5 sm:p-6">
      <p
        className={`font-mono text-[11px] uppercase tracking-wider transition-colors duration-300 ${
          active ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {label}
      </p>
      {/* Fixed min-height reserves room for the tallest column (Work: header +
          3 fixed rows). With `items-stretch` on the grid, all three columns
          match this height, so the card never reflows across phases. */}
      <div className="mt-4 min-h-[15.5rem] flex-1">{children}</div>
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

// Elapsed-ms clock that resets and starts ticking when `working` becomes true,
// driving staggered per-row completion. Returns 0 (and stops) when idle.
function useWorkClock(working: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!working) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - start), 60);
    return () => clearInterval(id);
  }, [working]);
  return elapsed;
}

// Ticking mm:ss elapsed timer for the voice panel. Runs while `active`; shows a
// settled value at rest / under reduced motion.
function useElapsed(active: boolean, reduced: boolean): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (reduced) {
      setSecs(42);
      return;
    }
    if (!active) return; // freeze last value between phases
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active, reduced]);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
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
