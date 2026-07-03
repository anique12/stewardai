"use client";

// Renders the message list: user turns as a right-aligned soft-grey bubble,
// assistant turns as a full-width block with quiet/expandable activity lines,
// the streamed answer (with [n] citation chips), a sources strip, and a
// pending permission/connect placeholder (Task 3 replaces the placeholder
// with the real action cards). Mirrors the approved mockup's hierarchy:
// the answer is loud, activity is quiet.

import { Fragment } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { Activity, Citation as CitationType, Message } from "@/lib/chat/types";
import { Citation } from "./Citation";
import { cn } from "@/lib/utils";

type AnswerPart = { type: "text"; value: string } | { type: "cite"; n: number };

function parseAnswer(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "cite", n: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
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

function AssistantTurn({ message, streaming }: { message: Message; streaming: boolean }) {
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
          {parts.map((part, i) =>
            part.type === "text" ? (
              <Fragment key={i}>{part.value}</Fragment>
            ) : citationsByN.has(part.n) ? (
              <Citation key={i} citation={citationsByN.get(part.n)!} />
            ) : (
              <Fragment key={i}>[{part.n}]</Fragment>
            ),
          )}
        </div>
      )}

      {message.pending === "permission" && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-foreground">
          Awaiting approval…
        </div>
      )}
      {message.pending === "connect" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
          Connect required
        </div>
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
            {sources.map((s) => (
              <Link
                key={s.meetingId}
                href={`/app/meetings/${s.meetingId}`}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:border-primary/40"
              >
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-primary">
                  {s.ns.join("·")}
                </span>
                <span className="font-medium text-foreground">Meeting {s.meetingId.slice(0, 8)}</span>
              </Link>
            ))}
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

export function ChatMessages({ messages, streaming }: { messages: Message[]; streaming: boolean }) {
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
          <AssistantTurn key={i} message={message} streaming={streaming && isLast} />
        );
      })}
    </div>
  );
}
