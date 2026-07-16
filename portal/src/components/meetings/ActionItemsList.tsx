"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/common/EmptyState";
import { cn } from "@/lib/utils";
import { createBrowserClient } from "@/lib/supabase/client";
import { bucketActions, type ActionRow } from "@/lib/meetings/actions";

type Tab = "open" | "completed" | "all";

function hasOwner(owner: string): boolean {
  const o = owner?.trim().toLowerCase();
  return !!o && o !== "unassigned";
}

function ownerInitials(owner: string): string {
  if (!hasOwner(owner)) return "?";
  return (
    owner
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function OwnerAvatar({ owner }: { owner: string }) {
  const assigned = hasOwner(owner);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-pill text-[10px] font-semibold",
          assigned ? "bg-brand-weak text-brand" : "bg-surface-2 text-ink-4"
        )}
      >
        {ownerInitials(owner)}
      </span>
      <span className="min-w-[34px] text-[11.5px] text-ink-3">
        {assigned ? owner.trim() : "Unassigned"}
      </span>
    </div>
  );
}

// Same lightweight relative-time formatting pattern used by ChatSidebar's
// formatThreadTime, kept local here so this file stays dependency-free.
function formatClosedTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ClosedByLine({ r }: { r: ActionRow }) {
  if (!r.done || !r.closed_by) return null;
  const time = formatClosedTime(r.closed_at);
  return (
    <p className="mt-1 text-[11px] text-ink-4">
      Closed by {r.closed_by}
      {time ? ` · ${time}` : ""}
    </p>
  );
}

function formatDue(due: string): string {
  return new Date(`${due}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function DuePill({ r, kind }: { r: ActionRow; kind: "overdue" | "today" | "upcoming" | "noDate" | "done" }) {
  if (kind === "done") {
    return <span className="shrink-0 rounded-md bg-surface-2 px-2 py-[3px] text-[10.5px] font-semibold text-ink-3">Done</span>;
  }
  if (kind === "noDate" || !r.due) return null;
  if (kind === "today") {
    return <span className="shrink-0 rounded-md bg-attention-weak px-2 py-[3px] text-[10.5px] font-semibold text-attention-strong">Today</span>;
  }
  if (kind === "overdue") {
    return <span className="shrink-0 rounded-md bg-danger-weak px-2 py-[3px] text-[10.5px] font-semibold text-danger-strong">{formatDue(r.due)}</span>;
  }
  return <span className="shrink-0 rounded-md bg-surface-2 px-2 py-[3px] text-[10.5px] font-semibold text-ink-3">{formatDue(r.due)}</span>;
}

function Row({
  r,
  kind,
  onToggle,
}: {
  r: ActionRow;
  kind: "overdue" | "today" | "upcoming" | "noDate" | "done";
  onToggle: (id: string, done: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3.5 border-b border-line px-4 py-[13px] last:border-0">
      <Checkbox checked={r.done} onCheckedChange={(v) => onToggle(r.id, Boolean(v))} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-relaxed", r.done ? "text-ink-3 line-through" : "text-ink")}>{r.task}</p>
        <Link
          href={`/app/meetings/${r.meeting_id}`}
          className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-ink-3 hover:text-ink hover:underline"
        >
          {r.meeting_title}
        </Link>
        <ClosedByLine r={r} />
      </div>
      <OwnerAvatar owner={r.owner} />
      <DuePill r={r} kind={kind} />
    </div>
  );
}

function Bucket({
  label,
  dotClassName,
  items,
  kind,
  onToggle,
}: {
  label: string;
  dotClassName: string;
  items: ActionRow[];
  kind: "overdue" | "today" | "upcoming" | "noDate";
  onToggle: (id: string, done: boolean) => void;
}) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-pill", dotClassName)} />
        <span className="text-[13px] font-bold text-ink">{label}</span>
        <span className="rounded-pill bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-ink-3">{items.length}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {items.map((r) => (
          <Row key={r.id} r={r} kind={kind} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}

function StatTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "default" | "danger" | "attention" | "muted";
}) {
  return (
    <div
      className={cn(
        "min-w-[120px] flex-1 rounded-xl border px-[15px] py-3",
        tone === "danger" && "border-danger bg-danger-weak",
        tone === "attention" && "border-attention bg-attention-weak",
        (tone === "default" || tone === "muted") && "border-line bg-surface"
      )}
    >
      <div
        className={cn(
          "font-display text-2xl font-bold",
          tone === "danger" && "text-danger-strong",
          tone === "attention" && "text-attention-strong",
          tone === "muted" && "text-ink-3",
          tone === "default" && "text-ink"
        )}
      >
        {value}
      </div>
      <div
        className={cn(
          "text-[11.5px]",
          tone === "danger" && "text-danger",
          tone === "attention" && "text-attention",
          (tone === "default" || tone === "muted") && "text-ink-3"
        )}
      >
        {label}
      </div>
    </div>
  );
}

export function ActionItemsList({ rows, timeZone }: { rows: ActionRow[]; timeZone?: string }) {
  const [items, setItems] = useState(rows);
  const [tab, setTab] = useState<Tab>("open");

  async function onToggle(id: string, done: boolean) {
    const supabase = createBrowserClient();
    let closed_by: string | null = null;
    let closed_at: string | null = null;
    if (done) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      closed_by = user?.email ?? "You";
      closed_at = new Date().toISOString();
    }
    await supabase.from("action_items").update({ done, closed_by, closed_at }).eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done, closed_by, closed_at } : i)));
  }

  const now = useMemo(() => new Date(), []);
  const { open, done, stats } = useMemo(() => bucketActions(items, now, timeZone), [items, now, timeZone]);

  if (!items.length) {
    return (
      <EmptyState
        icon={
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="4" width="17" height="16" rx="2.5" stroke="var(--on-brand)" strokeWidth="1.6" />
            <path d="M8 12l2.5 2.5L16 9" stroke="var(--on-brand)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
        title="No open commitments"
        body="As MeetBase captures commitments in your meetings, they collect here — with an owner, a due date, and a link to where they were made."
      />
    );
  }

  const showBuckets = tab === "open" || tab === "all";
  const showDone = tab === "completed" || tab === "all";

  return (
    <div>
      <div className="mb-[18px] flex flex-wrap gap-3">
        <StatTile value={stats.open} label="Open" tone="default" />
        <StatTile value={stats.overdue} label="Overdue" tone="danger" />
        <StatTile value={stats.today} label="Due today" tone="attention" />
        <StatTile value={stats.done} label="Completed" tone="muted" />
      </div>

      <div className="mb-[18px] inline-flex rounded-md border border-line bg-surface-2 p-[3px]">
        {(["open", "completed", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 text-[13px] font-semibold capitalize transition-colors",
              tab === t ? "bg-surface text-ink shadow-sh-1" : "text-ink-3 hover:text-ink"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {showBuckets && (
        <div className="flex flex-col gap-[22px]">
          <Bucket label="Overdue" dotClassName="bg-danger" items={open.overdue} kind="overdue" onToggle={onToggle} />
          <Bucket label="Today" dotClassName="bg-attention" items={open.today} kind="today" onToggle={onToggle} />
          <Bucket label="Upcoming" dotClassName="bg-brand" items={open.upcoming} kind="upcoming" onToggle={onToggle} />
          <Bucket label="No date" dotClassName="bg-ink-4" items={open.noDate} kind="noDate" onToggle={onToggle} />
          {tab === "open" && !open.overdue.length && !open.today.length && !open.upcoming.length && !open.noDate.length ? (
            <p className="text-sm text-ink-3">Nothing open — nice.</p>
          ) : null}
        </div>
      )}

      {showDone && (
        <div className={cn(showBuckets && "mt-[22px]")}>
          <div className="mb-2.5 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-brand">
              <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[13px] font-bold text-ink">Completed</span>
            <span className="font-mono text-[10.5px] text-ink-3">{stats.done}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          {done.length ? (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {done.map((r) => (
                <Row key={r.id} r={r} kind="done" onToggle={onToggle} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-3">No completed items yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
