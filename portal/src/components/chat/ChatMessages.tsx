"use client";

// Renders the message list: user turns as a right-aligned soft-grey bubble,
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
          <strong key={`${keyBase}-b${idx++}`} className="font-semibold text-foreground">
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
        <ul key={`u${k}`} className="mb-3 flex list-none flex-col gap-1.5 last:mb-0">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
              <span className="min-w-0">{renderInline(it, cite, `u${k}-${i}`)}</span>
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
  return <div className="text-[15px] leading-[1.68] text-foreground/90">{blocks}</div>;
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

function ActivityLine({ activity }: { activity: Activity }) {
  // Spinner while running, red on error, otherwise the action's own icon.
  const Icon =
    activity.status === "started"
      ? Loader2
      : activity.status === "error"
        ? XCircle
        : activity.kind === "reasoning"
          ? Sparkles
          : toolIcon(activity.name);

  return (
    <div className="flex w-fit max-w-full items-center gap-1.5 px-1.5 py-1 text-[12.5px] text-muted-foreground">
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          activity.status === "started" && "animate-spin",
          activity.status === "error" && "text-destructive",
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
          "text-[12.5px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground",
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
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {label}
        </span>
      }
    >
      <div className="ml-2 mt-0.5 whitespace-pre-wrap border-l border-border py-1 pl-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {thinking}
      </div>
    </Collapsible>
  );
}

// Collapse all of a turn's actions into one "Worked through N actions" line
// (Claude-chat style) that expands to reveal every tool call.
function ActivityGroup({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null;
  const running = activities.some((a) => a.status === "started");
  const n = activities.length;
  return (
    <Collapsible
      summary={
        <span className="flex items-center gap-1.5">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          )}
          {running ? "Working…" : `Ran ${n} action${n === 1 ? "" : "s"}`}
        </span>
      }
    >
      <div className="mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
        {activities.map((a, i) => (
          <ActivityLine key={`${a.kind}-${a.name ?? i}`} activity={a} />
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
      <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border bg-secondary/50 px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
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
            "grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground",
            streaming && "animate-pulse",
          )}
        >
          <span className="h-2 w-2 rotate-45 rounded-[2px] bg-primary-foreground" aria-hidden />
        </span>
        <span className="text-[12.5px] font-semibold text-foreground">Steward</span>
      </div>

      <ThinkingBlock
        thinking={message.thinking}
        streaming={streaming}
        seconds={message.thinkingSeconds}
      />
      <ActivityGroup activities={activities} />



      {message.text.length > 0 && <AnswerContent text={message.text} cite={cite} />}

      {message.pending === "permission" && message.permission && (
        <PermissionCard permission={message.permission} onDecide={onDecide} />
      )}
      {message.pending === "connect" && message.connect && (
        <ConnectCard connect={message.connect} onConnect={onConnect} onSkip={onSkip} />
      )}

      {message.error && (
        <p role="alert" className="text-sm text-destructive">
          {message.error}
        </p>
      )}

      {sources.length > 0 && (
        <div className="mt-1 border-t border-dashed border-border pt-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Sources</div>
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => {
              const info = titles[s.meetingId];
              const date = formatDate(info?.date ?? null);
              return (
                <Link
                  key={s.meetingId}
                  href={`/app/meetings/${s.meetingId}`}
                  className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm transition-colors hover:border-primary/40 hover:bg-secondary/40"
                >
                  <FileText
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-foreground">
                      {info?.title ?? `Meeting ${s.meetingId.slice(0, 8)}`}
                    </span>
                    {date && <span className="text-[11px] text-muted-foreground">{date}</span>}
                  </span>
                  <span className="ml-1 shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-primary">
                    {s.num}
                  </span>
                </Link>
              );
            })}
          </div>
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
          <div className="flex items-center gap-1 pt-1" role="status" aria-label="Steward is responding">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
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
}: {
  messages: Message[];
  streaming: boolean;
  onDecide: (decision: PermissionDecision, args?: Record<string, unknown>) => void;
  onConnect: () => void;
  onSkip: () => void;
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
        <p className="text-lg font-medium text-foreground">Ask Steward anything</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Or tell it to do something — draft an email, file a meeting, log a recap. It cites its sources and
          asks before anything leaves your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 py-4">
      {messages.map((message, i) => {
        const isLast = i === messages.length - 1;
        return (
          <div key={i} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
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
