"use client";

// Renders the message list: user turns as a right-aligned soft bubble,
// assistant turns as a full-width block with quiet/expandable activity lines,
// the streamed answer (with [n] citation chips), a sources strip, and — when
// the run is paused — the permission/connect action card.

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  Blocks,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Mail,
  Paperclip,
  Plug,
  Search,
  Send,
  Sparkles,
  Square,
  Tag,
  User,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Activity, Citation as CitationType, Message } from "@/lib/chat/types";
import type { PermissionDecision } from "@/hooks/useChat";
import { useMeetingTitles, type MeetingInfo } from "@/hooks/useMeetingTitles";
import { Citation } from "./Citation";
import { ConnectCard } from "./ConnectCard";
import { PermissionCard } from "./PermissionCard";
import { cn } from "@/lib/utils";

// The Steward brand mark — two arcs + a dot, reused from the empty states
// elsewhere in the app (dashboard/meetings) so the assistant's identity reads
// consistently across the product.
function StewardMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" fill="var(--on-brand)" />
      <path
        d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11"
        stroke="var(--on-brand)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Lightweight markdown → React for the streamed answer: paragraphs, bullet lists,
// **bold**, and inline [n]/[1, 6] citation chips. (Full markdown lib is overkill
// for what the model emits here.)
// Resolver from a raw per-chunk citation number to its meeting's single display
// number + a representative citation. Lets many chunks of one meeting collapse
// to a single inline marker (and one Sources entry) — see AssistantTurn.
type CiteResolver = Map<number, { num: number; citation: CitationType }>;

function renderInline(
  text: string,
  cite: CiteResolver,
  keyBase: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let idx = 0;
  const pushText = (s: string) => {
    for (const seg of s.split(/(\*\*[^*]+\*\*)/g)) {
      if (!seg) continue;
      if (seg.startsWith("**") && seg.endsWith("**")) {
        nodes.push(
          <strong key={`${keyBase}-b${idx++}`} className="font-semibold text-ink">
            {seg.slice(2, -2)}
          </strong>,
        );
      } else {
        nodes.push(<Fragment key={`${keyBase}-t${idx++}`}>{seg}</Fragment>);
      }
    }
  };
  const re = /\[([\d\s,]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index));
    const entries = m[1]
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && cite.has(n))
      .map((n) => cite.get(n)!);
    // Collapse to one chip per distinct meeting (many chunks → one marker).
    const seen = new Set<number>();
    const distinct: Array<{ num: number; citation: CitationType }> = [];
    for (const e of entries) {
      if (!seen.has(e.num)) {
        seen.add(e.num);
        distinct.push(e);
      }
    }
    if (distinct.length === 0) {
      pushText(m[0]);
    } else {
      nodes.push(
        <span key={`${keyBase}-c${idx++}`} className="inline-flex items-center gap-0.5 align-[2px]">
          {distinct.map((e) => (
            <Citation key={e.num} citation={e.citation} label={e.num} />
          ))}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) pushText(text.slice(last));
  return nodes;
}

function AnswerContent({
  text,
  cite,
}: {
  text: string;
  cite: CiteResolver;
}) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let key = 0;
  const flushPara = () => {
    if (para.length) {
      const k = key++;
      blocks.push(
        <p key={`p${k}`} className="mb-3 last:mb-0">
          {renderInline(para.join(" "), cite, `p${k}`)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const k = key++;
      const items = [...list];
      blocks.push(
        <ul key={`u${k}`} className="mb-3 flex list-none flex-col gap-2 last:mb-0">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-[8px] h-[5px] w-[5px] shrink-0 rounded-pill bg-brand" aria-hidden />
              <span className="min-w-0 text-[13.5px] leading-[1.55] text-ink">{renderInline(it, cite, `u${k}-${i}`)}</span>
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const bullet = raw.match(/^\s*[*-]\s+(.*)$/);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (raw.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(raw.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="text-[14px] leading-[1.62] text-ink">{blocks}</div>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Human-readable labels for tool activity — non-technical readers shouldn't see
// raw slugs like GOOGLECALENDAR_EVENTS_LIST.
const FRIENDLY_TOOL: Record<string, string> = {
  kb_search: "Searched your knowledge base",
  list_spaces: "Looked through your spaces",
  list_meetings: "Looked through your meetings",
  lookup_entity: "Looked up a contact",
  create_space: "Created a space",
  rename_space: "Renamed a space",
  archive_space: "Archived a space",
  file_meeting: "Filed a meeting",
  add_tag: "Added a tag",
  remove_tag: "Removed a tag",
  complete_action_item: "Completed an action item",
  reopen_action_item: "Reopened an action item",
  GOOGLECALENDAR_EVENTS_LIST: "Checked your calendar",
  GOOGLECALENDAR_CREATE_EVENT: "Created a calendar event",
  GOOGLECALENDAR_UPDATE_EVENT: "Updated a calendar event",
  GOOGLECALENDAR_FIND_FREE_SLOTS: "Found open time slots",
  GMAIL_FETCH_EMAILS: "Read your emails",
  GMAIL_SEND_EMAIL: "Sent an email",
  GMAIL_CREATE_EMAIL_DRAFT: "Drafted an email",
  GMAIL_GET_ATTACHMENT: "Fetched an attachment",
  list_integrations: "Checked connected apps",
  connect_app: "Opened a connect dialog",
  describe_action: "Checked available actions",
  run_integration_action: "Used an integration",
};

// A distinct icon per action so the activity list reads at a glance (instead of
// the same tick on every line).
const TOOL_ICON: Record<string, LucideIcon> = {
  kb_search: Search,
  list_spaces: Folder,
  list_meetings: Calendar,
  lookup_entity: User,
  create_space: FolderPlus,
  rename_space: Folder,
  archive_space: Archive,
  file_meeting: Folder,
  add_tag: Tag,
  remove_tag: Tag,
  complete_action_item: CheckSquare,
  reopen_action_item: Square,
  GOOGLECALENDAR_EVENTS_LIST: Calendar,
  GOOGLECALENDAR_CREATE_EVENT: CalendarPlus,
  GOOGLECALENDAR_UPDATE_EVENT: Calendar,
  GOOGLECALENDAR_FIND_FREE_SLOTS: Calendar,
  GMAIL_FETCH_EMAILS: Mail,
  GMAIL_SEND_EMAIL: Send,
  GMAIL_CREATE_EMAIL_DRAFT: Mail,
  GMAIL_GET_ATTACHMENT: Paperclip,
  list_integrations: Blocks,
  connect_app: Plug,
  describe_action: Search,
  run_integration_action: Wrench,
};

function toolIcon(name?: string): LucideIcon {
  return (name && TOOL_ICON[name]) || Wrench;
}

function friendlyToolLabel(name?: string): string {
  if (!name) return "Worked on it";
  if (FRIENDLY_TOOL[name]) return FRIENDLY_TOOL[name];
  // Composio fallback: APP_VERB_NOUN → "verb noun (App)".
  const [app, ...rest] = name.split("_");
  const appName = app ? app.charAt(0) + app.slice(1).toLowerCase() : "";
  const phrase = rest.join(" ").toLowerCase();
  return phrase ? `${phrase} (${appName})` : name;
}

function describeActivity(activity: Activity): string {
  if (activity.kind === "reasoning") return "Thought about it";
  return friendlyToolLabel(activity.name);
}

function ActivityLine({ activity, paused }: { activity: Activity; paused?: boolean }) {
  // Spinner while running, red on error, otherwise the action's own icon. When
  // the turn is paused on a card, a "started" action isn't really running (it's
  // waiting on the user) — show its icon, not a spinner, so the card is the only
  // live indicator.
  const spinning = activity.status === "started" && !paused;
  const Icon = spinning
    ? Loader2
    : activity.status === "error"
      ? XCircle
      : activity.kind === "reasoning"
        ? Sparkles
        : toolIcon(activity.name);

  return (
    <div className="flex w-fit max-w-full items-center gap-[7px] rounded-pill bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-2">
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          spinning && "animate-spin text-brand",
          activity.status === "error" && "text-danger",
        )}
        aria-hidden
      />
      <span className="truncate">{describeActivity(activity)}</span>
    </div>
  );
}

// A smoothly-animated disclosure (grid-rows 0fr↔1fr transition) — replaces
// native <details>, which toggles instantly.
function Collapsible({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left",
          "text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
        )}
      >
        {summary}
        <ChevronDown
          className={cn("h-3 w-3 shrink-0 transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

// The model's thinking (reasoning models only) as a collapsed Claude-style block.
function ThinkingBlock({
  thinking,
  streaming,
  seconds,
}: {
  thinking: string;
  streaming: boolean;
  seconds?: number | null;
}) {
  if (!thinking) return null;
  const label = streaming
    ? "Thinking…"
    : seconds
      ? `Thought for ${seconds}s`
      : "Thought about it";
  return (
    <Collapsible
      summary={
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
          {label}
        </span>
      }
    >
      <div className="ml-2 mt-0.5 whitespace-pre-wrap border-l-2 border-line-2 py-1 pl-3 text-[12.5px] leading-relaxed text-ink-2">
        {thinking}
      </div>
    </Collapsible>
  );
}

// Collapse all of a turn's actions into one "Worked through N actions" line
// (Claude-chat style) that expands to reveal every tool call.
function ActivityGroup({ activities, paused }: { activities: Activity[]; paused?: boolean }) {
  if (activities.length === 0) return null;
  // When the turn is paused on a card, an in-flight action is waiting on the
  // user, not running — so don't spin "Working…" (the card is the live status).
  const running = !paused && activities.some((a) => a.status === "started");
  const n = activities.length;
  return (
    <Collapsible
      summary={
        <span className="flex items-center gap-1.5">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
          )}
          {running ? "Working…" : `Ran ${n} action${n === 1 ? "" : "s"}`}
        </span>
      }
    >
      <div className="mt-1.5 flex flex-col flex-wrap gap-1.5 border-l-2 border-line-2 pl-2.5">
        {activities.map((a, i) => (
          <ActivityLine key={`${a.kind}-${a.name ?? i}`} activity={a} paused={paused} />
        ))}
      </div>
    </Collapsible>
  );
}

// Collapse citations to ONE number per meeting (Claude/Perplexity-style):
// every chunk of a meeting shares the meeting's display number, so the answer
// reads [1] for that source throughout instead of [1][2][3], and Sources shows
// one entry per meeting. Returns the inline resolver (raw chunk n → {num,
// citation}) and the ordered source list (one per meeting, first-cited first).
function collapseCitations(citations: CitationType[]): {
  cite: CiteResolver;
  sources: Array<{ meetingId: string; num: number }>;
} {
  const meetingNumber = new Map<string, number>();
  const sources: Array<{ meetingId: string; num: number }> = [];
  for (const c of citations) {
    if (!meetingNumber.has(c.meeting_id)) {
      const num = sources.length + 1;
      meetingNumber.set(c.meeting_id, num);
      sources.push({ meetingId: c.meeting_id, num });
    }
  }
  const cite: CiteResolver = new Map();
  for (const c of citations) {
    cite.set(c.n, { num: meetingNumber.get(c.meeting_id)!, citation: c });
  }
  return { cite, sources };
}

function UserTurn({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[78%] whitespace-pre-wrap rounded-xl rounded-br-sm border border-line-2 bg-surface-2 px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {message.text}
      </div>
    </div>
  );
}

function AssistantTurn({
  message,
  streaming,
  titles,
  onDecide,
  onConnect,
  onSkip,
}: {
  message: Message;
  streaming: boolean;
  titles: Record<string, MeetingInfo>;
  onDecide: (decision: PermissionDecision, args?: Record<string, unknown>) => void;
  onConnect: () => void;
  onSkip: () => void;
}) {
  const { cite, sources } = collapseCitations(message.citations);
  // Show EVERY action Steward takes (like the artifact) — including "Searched
  // your knowledge base". We only hide the *inner* detail (query/params), not
  // the action line itself.
  const activities = message.activities;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md bg-brand",
            streaming && "anim-pulse",
          )}
        >
          <StewardMark size={16} />
        </span>
        <span className="text-[12.5px] font-semibold text-ink">Steward</span>
      </div>

      <ThinkingBlock
        thinking={message.thinking}
        streaming={streaming}
        seconds={message.thinkingSeconds}
      />
      <ActivityGroup activities={activities} paused={!!message.pending} />

      {message.text.length > 0 && <AnswerContent text={message.text} cite={cite} />}

      {message.pending === "permission" && message.permission && (
        <PermissionCard permission={message.permission} onDecide={onDecide} />
      )}
      {message.pending === "connect" && message.connect && (
        <ConnectCard connect={message.connect} onConnect={onConnect} onSkip={onSkip} />
      )}

      {message.error && (
        <p role="alert" className="text-sm text-danger">
          {message.error}
        </p>
      )}

      {sources.length > 0 && (
        <div className="mt-1 flex items-center gap-[7px] flex-wrap border-t border-dashed border-line pt-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-4">
            Sources
          </span>
          {sources.map((s) => {
            const info = titles[s.meetingId];
            const date = formatDate(info?.date ?? null);
            return (
              <Link
                key={s.meetingId}
                href={`/app/meetings/${s.meetingId}`}
                className="group inline-flex items-center gap-[5px] rounded-md border border-brand-weak-2 bg-brand-weak px-2 py-1 font-mono text-[10px] font-semibold text-brand transition-colors hover:bg-brand-weak-2"
              >
                <FileText className="h-[11px] w-[11px] shrink-0" aria-hidden />
                <span className="max-w-[160px] truncate">{info?.title ?? `Meeting ${s.meetingId.slice(0, 8)}`}</span>
                {date && <span className="text-ink-3">· {date}</span>}
              </Link>
            );
          })}
        </div>
      )}

      {/* Pure "responding" indicator: dots only, shown while waiting for the
          first output and nothing else already signals activity (no reasoning
          block, no tool line, no answer text yet). No "thinking" wording —
          this is just latency-to-first-token, not the model reasoning. */}
      {streaming &&
        message.text.length === 0 &&
        !message.thinking &&
        activities.length === 0 &&
        !message.pending && (
          <div
            className="flex w-fit items-center gap-[9px] rounded-pill border border-line bg-surface-2 px-3 py-[7px]"
            role="status"
            aria-label="Steward is responding"
          >
            <span className="flex gap-1">
              <span className="anim-pulse h-[6px] w-[6px] rounded-pill bg-brand" />
              <span className="anim-pulse h-[6px] w-[6px] rounded-pill bg-brand [animation-delay:.2s]" />
              <span className="anim-pulse h-[6px] w-[6px] rounded-pill bg-brand [animation-delay:.4s]" />
            </span>
            <span className="text-[12px] text-ink-2">Thinking…</span>
          </div>
        )}
    </div>
  );
}

export function ChatMessages({
  messages,
  streaming,
  onDecide,
  onConnect,
  onSkip,
  onSuggest,
}: {
  messages: Message[];
  streaming: boolean;
  onDecide: (decision: PermissionDecision, args?: Record<string, unknown>) => void;
  onConnect: () => void;
  onSkip: () => void;
  onSuggest?: (text: string) => void;
}) {
  // Fetch titles/dates for every cited meeting across the thread (RLS-scoped).
  // Called unconditionally (before any early return) to keep hook order stable.
  const citedMeetingIds = messages.flatMap((m) =>
    m.role === "assistant" ? m.citations.map((c) => c.meeting_id) : [],
  );
  const titles = useMeetingTitles(citedMeetingIds);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
        <div className="mb-1 grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl bg-brand shadow-sh-2">
          <StewardMark size={28} />
        </div>
        <p className="font-display text-2xl font-bold tracking-tight text-ink">Ask Steward anything</p>
        <p className="max-w-md text-sm leading-relaxed text-ink-2">
          Steward reads across every meeting you&apos;ve had, cites its sources, and can act on your behalf — with
          your approval on anything that leaves your workspace.
        </p>
        <div className="mt-4 flex w-full max-w-md flex-col gap-2">
          {[
            "What did we commit to in the last renewal call?",
            "Draft a follow-up to everyone from Tuesday's kickoff",
            "What's still open from last week's meetings?",
            "Summarize everything we know about Acme Corp",
          ].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggest?.(suggestion)}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 text-left text-[13px] text-ink shadow-sh-1 transition-colors hover:border-brand-weak-2 hover:bg-surface-2"
            >
              <Sparkles className="h-[15px] w-[15px] shrink-0 text-brand" aria-hidden />
              <span className="flex-1">{suggestion}</span>
              <ChevronDown className="h-[15px] w-[15px] shrink-0 -rotate-90 text-ink-4" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 py-4">
      {messages.map((message, i) => {
        const isLast = i === messages.length - 1;
        return (
          <div key={i} className="anim-fadeup">
            {message.role === "user" ? (
              <UserTurn message={message} />
            ) : (
              <AssistantTurn
                message={message}
                streaming={streaming && isLast}
                titles={titles}
                onDecide={onDecide}
                onConnect={onConnect}
                onSkip={onSkip}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
