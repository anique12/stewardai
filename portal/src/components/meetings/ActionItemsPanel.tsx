"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { createBrowserClient } from "@/lib/supabase/client";
import { useState } from "react";

type ActionItem = { id: string; owner: string; task: string; due: string | null; done: boolean };

function hasOwner(owner: string): boolean {
  const o = owner?.trim().toLowerCase();
  return !!o && o !== "unassigned";
}

export function ActionItemsPanel({ items: initial }: { items: ActionItem[] }) {
  const [items, setItems] = useState(initial);

  async function toggleDone(id: string, done: boolean) {
    const supabase = createBrowserClient();
    await supabase.from("action_items").update({ done }).eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done } : i)));
  }

  if (!items.length) return <p className="text-sm text-muted-foreground">No action items.</p>;

  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2.5">
          <Checkbox
            className="mt-0.5"
            checked={item.done}
            onCheckedChange={(v) => toggleDone(item.id, Boolean(v))}
          />
          <p className={`text-sm leading-relaxed ${item.done ? "text-muted-foreground line-through" : "text-foreground/90"}`}>
            {hasOwner(item.owner) && (
              <>
                <span className="font-medium text-primary">@{item.owner.trim()}</span>
                {" — "}
              </>
            )}
            {item.task}
            {item.due ? <span className="text-muted-foreground"> (due {item.due})</span> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
