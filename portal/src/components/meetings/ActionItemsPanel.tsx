"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { createBrowserClient } from "@/lib/supabase/client";
import { useState } from "react";

type ActionItem = {
  id: string;
  owner: string;
  task: string;
  due: string | null;
  done: boolean;
  closed_by?: string | null;
  closed_at?: string | null;
};

function hasOwner(owner: string): boolean {
  const o = owner?.trim().toLowerCase();
  return !!o && o !== "unassigned";
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

// Same lightweight relative-time formatting pattern used by ChatSidebar's
// formatThreadTime, kept local here so this file stays dependency-free.
function formatClosedTime(iso?: string | null): string {
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

export function ActionItemsPanel({ items: initial }: { items: ActionItem[] }) {
  const [items, setItems] = useState(initial);

  async function toggleDone(id: string, done: boolean) {
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

  if (!items.length) return <p className="text-sm text-ink-3">No action items.</p>;

  return (
    <ul className="flex flex-col gap-[13px]">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-[10px]">
          <Checkbox
            className="mt-[3px]"
            checked={item.done}
            onCheckedChange={(v) => toggleDone(item.id, Boolean(v))}
          />
          <div className="min-w-0 flex-1">
            <div className={`text-[12.5px] leading-[1.5] ${item.done ? "text-ink-3 line-through" : "text-ink"}`}>
              {item.task}
            </div>
            {item.done && item.closed_by ? (
              <p className="mt-[3px] text-[10.5px] text-ink-4">
                Closed by {item.closed_by}
                {formatClosedTime(item.closed_at) ? ` · ${formatClosedTime(item.closed_at)}` : ""}
              </p>
            ) : null}
            <div className="mt-[6px] flex flex-wrap items-center gap-[7px]">
              {hasOwner(item.owner) && (
                <span className="inline-flex h-[18px] items-center rounded-pill bg-brand-weak px-[7px] font-mono text-[9.5px] font-semibold text-brand-ink">
                  {initials(item.owner)}
                </span>
              )}
              {hasOwner(item.owner) && (
                <span className="text-[11px] text-ink-3">{item.owner.trim()}</span>
              )}
              {item.due ? (
                <span className="rounded-pill border border-line-2 bg-surface-2 px-[7px] py-[1px] font-mono text-[10px] text-ink-3">
                  due {item.due}
                </span>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
