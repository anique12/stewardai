"use client";

import Link from "next/link";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { createBrowserClient } from "@/lib/supabase/client";
import { groupActionItems, type ActionRow } from "@/lib/meetings/actions";

function hasOwner(owner: string): boolean {
  const o = owner?.trim().toLowerCase();
  return !!o && o !== "unassigned";
}

function Item({ r, onToggle }: { r: ActionRow; onToggle: (id: string, done: boolean) => void }) {
  return (
    <li className="flex items-start gap-3 border-b border-border/60 py-3 last:border-0">
      <Checkbox className="mt-0.5" checked={r.done} onCheckedChange={(v) => onToggle(r.id, Boolean(v))} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-relaxed ${r.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
          {hasOwner(r.owner) && <span className="font-medium text-primary">@{r.owner.trim()} — </span>}
          {r.task}
          {r.due ? <span className="text-muted-foreground"> (due {r.due})</span> : null}
        </p>
        <Link href={`/app/meetings/${r.meeting_id}`} className="text-xs text-muted-foreground hover:text-foreground">
          {r.meeting_title}
        </Link>
      </div>
    </li>
  );
}

export function ActionItemsList({ rows }: { rows: ActionRow[] }) {
  const [items, setItems] = useState(rows);

  async function onToggle(id: string, done: boolean) {
    const supabase = createBrowserClient();
    await supabase.from("action_items").update({ done }).eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done } : i)));
  }

  const { open, done } = groupActionItems(items);

  if (!items.length) return <p className="text-sm text-muted-foreground">No action items yet.</p>;

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open ({open.length})</h2>
        {open.length ? <ul>{open.map((r) => <Item key={r.id} r={r} onToggle={onToggle} />)}</ul>
          : <p className="text-sm text-muted-foreground">Nothing open — nice.</p>}
      </section>
      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Done ({done.length})</h2>
          <ul>{done.map((r) => <Item key={r.id} r={r} onToggle={onToggle} />)}</ul>
        </section>
      )}
    </div>
  );
}
