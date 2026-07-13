"use client";

import Link from "next/link";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { createBrowserClient } from "@/lib/supabase/client";
import type { HomeActionRow } from "@/lib/home";

function dueLabel(due: string | null): string | null {
  if (!due) return null;
  return new Date(due).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function NeedsAction({ actions }: { actions: HomeActionRow[] }) {
  const [items, setItems] = useState(actions);

  async function onToggle(id: string, done: boolean) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    const supabase = createBrowserClient();
    await supabase.from("action_items").update({ done }).eq("id", id);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sh-1">
      <div className="flex items-center gap-[9px] border-b border-line px-4 py-[14px]">
        <span className="h-2 w-2 rounded-pill bg-attention" />
        <span className="font-display text-[13px] font-bold">Needs your action</span>
        <span className="flex-1" />
        <Link href="/app/actions" className="text-xs font-semibold text-brand hover:underline">
          All →
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-3">Nothing open — nice.</p>
      ) : (
        items.map((a) => (
          <div key={a.id} className="flex items-start gap-[11px] border-b border-line px-4 py-3 last:border-0">
            <Checkbox
              className="mt-0.5"
              checked={a.done}
              onCheckedChange={(v) => onToggle(a.id, Boolean(v))}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-snug">{a.task}</div>
              <Link href={`/app/meetings/${a.meeting_id}`} className="mt-[3px] block text-[11px] text-ink-3 hover:underline">
                {a.meeting_title}
                {a.space_name ? ` · ${a.space_name}` : ""}
              </Link>
            </div>
            {a.due ? (
              <span className="shrink-0 font-mono text-[10px] font-semibold text-ink-4">{dueLabel(a.due)}</span>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
