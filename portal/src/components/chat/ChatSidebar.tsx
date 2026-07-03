"use client";

// Left rail for the chat surface: brand mark, "New chat", and a thread list.
// Thread history is a v1 nice-to-have — `/api/chat/threads` may not exist yet,
// so a failed/404 fetch just renders an empty state instead of blocking or
// crashing the page.

import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";

type Thread = {
  id: string;
  title?: string | null;
  updated_at?: string | null;
};

function isThreadArray(value: unknown): value is Thread[] {
  return Array.isArray(value) && value.every((t) => t && typeof t === "object" && "id" in t);
}

export function ChatSidebar({ onNewChat }: { onNewChat: () => void }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/chat/threads")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list = isThreadArray(data) ? data : isThreadArray(data?.threads) ? data.threads : [];
        setThreads(list);
      })
      .catch(() => {
        if (!cancelled) setThreads([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2.5 px-1">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
          <span className="h-2 w-2 rotate-45 rounded-[2px] bg-primary-foreground" aria-hidden />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-foreground">Steward</span>
      </div>

      <button
        type="button"
        onClick={onNewChat}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground",
          "transition-colors hover:border-primary/40 hover:bg-secondary/60",
        )}
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden />
        New chat
      </button>

      <div className="flex-1 overflow-y-auto">
        <div className="mb-2 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">Recent</div>
        {loading ? (
          <p className="px-1 text-xs text-muted-foreground">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No conversations yet</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  {t.title || "Untitled chat"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
