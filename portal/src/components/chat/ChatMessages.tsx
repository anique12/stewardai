"use client";

// Renders the message list: user turns as a right-aligned soft-grey bubble,
// assistant turns as a full-width block with quiet/expandable activity lines,
// the streamed answer (with [n] citation chips), a sources strip, and — when
// the run is paused — the permission/connect action card.

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, FileText, Loader2, XCircle } from "lucide-react";
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
function renderInline(
  text: string,
  citationsByN: Map<number, CitationType>,
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
    const ns = m[1]
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && citationsByN.has(n));
    if (ns.length === 0) {
      pushText(m[0]);
    } else {
      nodes.push(
        <span key={`${keyBase}-c${idx++}`} className="inline-flex items-center gap-0.5 align-[2px]">
          {ns.map((n) => (
            <Citation key={n} citation={citationsByN.get(n)!} />
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
  citationsByN,
}: {
  text: string;
  citationsByN: Map<number, CitationType>;
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
          {renderInline(para.join(" "), citationsByN, `p${k}`)}
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
              <span className="min-w-0">{renderInline(it, citationsByN, `u${k}-${i}`)}</span>
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
};

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
  const StatusIcon =
    activity.status === "started" ? Loader2 : activity.status === "error" ? XCircle : CheckCircle2;

  return (
    <div className="flex w-fit max-w-full items-center gap-1.5 px-1.5 py-1 text-[12.5px] text-muted-foreground">
      <StatusIcon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          activity.status === "started" && "animate-spin",
          activity.status === "done" && "text-primary",
          activity.status === "error" && "text-destructive",
        )}
        aria-hidden
      />
      <span className="truncate">{describeActivity(activity)}</span>
    </div>
  );
}

// Render activity lines, grouping into a single collapsible line when there are
// many so a busy turn stays compact.
function ActivityGroup({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null;
  if (activities.length <= 3) {
    return (
      <div className="flex flex-col gap-0.5">
        {activities.map((a, i) => (
          <ActivityLine key={`${a.kind}-${a.name ?? i}`} activity={a} />
        ))}
      </div>
    );
  }
  const allDone = activities.every((a) => a.status !== "started");
  return (
    <details className="group">
      <summary
        className={cn(
          "flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1",
          "text-[12.5px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {allDone ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        )}
        <span>Worked through {activities.length} steps</span>
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {activities.map((a, i) => (
          <ActivityLine key={`${a.kind}-${a.name ?? i}`} activity={a} />
        ))}
      </div>
    </details>
  );
}

function groupCitationsByMeeting(citations: CitationType[]): Array<{ meetingId: string; ns: number[] }> {
  const order: string[] = [];
  const byMeeting = new Map<string, number[]>();
  for (const c of citations) {
    if (!byMeeting.has(c.meeting_id)) {
      order.push(c.meeting_id);
      byMeeting.set(c.meeting_id, []);
    }
    byMeeting.get(c.meeting_id)!.push(c.n);
  }
  return order.map((meetingId) => ({ meetingId, ns: byMeeting.get(meetingId)! }));
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
  const citationsByN = new Map(message.citations.map((c) => [c.n, c]));
  const sources = groupCitationsByMeeting(message.citations);
  // Hide the KB-search read line when a Sources strip is shown (redundant); keep
  // all other activity (calendar reads, writes, sends).
  const activities = message.activities.filter(
    (a) => !(sources.length > 0 && a.kind === "tool" && a.name === "kb_search"),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
          <span className="h-2 w-2 rotate-45 rounded-[2px] bg-primary-foreground" aria-hidden />
        </span>
        <span className="text-[12.5px] font-semibold text-foreground">Steward</span>
      </div>

      <ActivityGroup activities={activities} />



      {message.text.length > 0 && <AnswerContent text={message.text} citationsByN={citationsByN} />}

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
                    {s.ns.join(" · ")}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {streaming && (
        <div className="flex items-center gap-2 pt-1 text-[13px] text-muted-foreground">
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
          </span>
          Steward is thinking…
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
        return message.role === "user" ? (
          <UserTurn key={i} message={message} />
        ) : (
          <AssistantTurn
            key={i}
            message={message}
            streaming={streaming && isLast}
            titles={titles}
            onDecide={onDecide}
            onConnect={onConnect}
            onSkip={onSkip}
          />
        );
      })}
    </div>
  );
}
