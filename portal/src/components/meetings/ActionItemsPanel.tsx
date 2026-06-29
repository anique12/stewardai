"use client";
import { Checkbox } from "@/components/ui/checkbox";
import { createBrowserClient } from "@/lib/supabase/client";
import { useState } from "react";

type ActionItem = { id: string; owner: string; task: string; due: string | null; done: boolean };

export function ActionItemsPanel({ items: initial }: { items: ActionItem[] }) {
  const [items, setItems] = useState(initial);

  async function toggleDone(id: string, done: boolean) {
    const supabase = createBrowserClient();
    await supabase.from("action_items").update({ done }).eq("id", id);
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, done } : i));
  }

  if (!items.length) return <p className="text-muted-foreground">No action items yet.</p>;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-3 rounded border border-border bg-card p-3">
          <Checkbox checked={item.done} onCheckedChange={(v) => toggleDone(item.id, Boolean(v))} />
          <div className="flex-1">
            <p className={`font-medium ${item.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {item.task}
            </p>
            <p className="text-sm text-muted-foreground">
              {item.owner}{item.due ? ` · Due ${item.due}` : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
