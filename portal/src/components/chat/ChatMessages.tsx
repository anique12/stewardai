"use client";

// Renders the message list: user turns as a right-aligned soft-grey bubble,
// assistant turns as a full-width block with quiet/expandable activity lines,
// the streamed answer (with [n] citation chips), a sources strip, and — when
// the run is paused — the permission/connect action card.

import { Fragment } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, Loader2, XCircle } from "lucide-react";
import type { Activity, Citation as CitationType, Message } from "@/lib/chat/types";
import type { PermissionDecision } from "@/hooks/useChat";
import { useMeetingTitles, type MeetingInfo } from "@/hooks/useMeetingTitles";
import { Citation } from "./Citation";
import { ConnectCard } from "./ConnectCard";
import { PermissionCard } from "./PermissionCard";
import { cn } from "@/lib/utils";

// A run of plain text, or a bracket of one-or-more citation numbers ([1] or [1, 6]).
type AnswerPart = { type: "text"; value: string } | { type: "cites"; ns: number[]; raw: string };

function parseAnswer(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  // Match single OR grouped markers: [1], [1, 6], [1, 2, 3].
  const re = /\[([\d\s,]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    const ns = m[1]
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n));
    parts.push({ type: "cites", ns, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function describeActivity(activity: Activity): string {
  if (activity.kind === "reasoning") return "Reasoned";
  const name = activity.name ?? "a tool";
  if (name === "kb_search") return "Searched knowledge base";
  return `Used ${name}`;
}

function ActivityLine({ activity }: { activity: Activity }) {
  const StatusIcon =
    activity.status === "started" ? Loader2 : activity.status === "error" ? XCircle : CheckCircle2;

  return (
    <details className="group">
      <summary
        className={cn(
          "flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px]",
          "text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <StatusIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            activity.status === "started" && "animate-spin text-muted-foreground",
            activity.status === "done" && "text-primary",
            activity.status === "error" && "text-destructive",
          )}
          aria-hidden
        />
        <span className="truncate">{describeActivity(activity)}</span>
      </summary>
      <div className="ml-4 mt-1 border-l border-border py-1 pl-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {activity.kind === "tool" ? (
          <>
            <span className="font-mono text-[11.5px] text-foreground/80">{activity.name ?? "unknown"}</span>{" "}
            &middot; {activity.status}
          </>
        ) : (
          `Reasoning ${activity.status}`
        )}
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
  onDecide: (decision: PermissionDecision) => void;
  onConnect: () => void;
  onSkip: () => void;
}) {
  const citationsByN = new Map(message.citations.map((c) => [c.n, c]));
  const parts = parseAnswer(message.text);
  const sources = groupCitationsByMeeting(message.citations);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
          <span className="h-2 w-2 rotate-45 rounded-[2px] bg-primary-foreground" aria-hidden />
        </span>
        <span className="text-[12.5px] font-semibold text-foreground">Steward</span>
      </div>

      {message.activities.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {message.activities.map((activity, i) => (
            <ActivityLine key={`${activity.kind}-${activity.name ?? i}`} activity={activity} />
          ))}
        </div>
      )}

      {message.text.length > 0 && (
        <div className="max-w-none whitespace-pre-wrap text-[15px] leading-[1.68] text-foreground/90">
          {parts.map((part, i) => {
            if (part.type === "text") return <Fragment key={i}>{part.value}</Fragment>;
            const known = part.ns.filter((n) => citationsByN.has(n));
            // No matching citation → show the model's literal marker rather than dropping it.
            if (known.length === 0) return <Fragment key={i}>{part.raw}</Fragment>;
            return (
              <span key={i} className="inline-flex items-center gap-0.5 align-[2px]">
                {known.map((n) => (
                  <Citation key={n} citation={citationsByN.get(n)!} />
                ))}
              </span>
            );
          })}
        </div>
      )}

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
  onDecide: (decision: PermissionDecision) => void;
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
