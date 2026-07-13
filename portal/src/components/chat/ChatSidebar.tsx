"use client";

// Left rail for the chat surface: "New chat" + a thread history list, each row
// showing the thread's scope (a Space, or "All work") and a relative time.
// Thread history is a v1 nice-to-have — `/api/chat/threads` may not exist yet,
// so a failed/404 fetch just renders an empty state instead of blocking or
// crashing the page.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";

type Thread = {
  id: string;
  title?: string | null;
  updated_at?: string | null;
  space_id?: string | null;
  spaces?: { name: string } | { name: string }[] | null;
};

function isThreadArray(value: unknown): value is Thread[] {
  return Array.isArray(value) && value.every((t) => t && typeof t === "object" && "id" in t);
}

function threadScopeLabel(t: Thread): string {
  const rel = t.spaces;
  const name = Array.isArray(rel) ? rel[0]?.name : rel?.name;
  return name || "All work";
}

// Short relative time ("2h", "3d") falling back to a short date past a week —
// no date-fns dependency exists in this app, so this stays a tiny local helper.
function formatThreadTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const minutes = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatSidebar({
  activeThreadId,
  onNewChat,
}: {
  activeThreadId?: string | null;
  onNewChat: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["chat-threads"],
    queryFn: async (): Promise<Thread[]> => {
      const res = await fetch("/api/chat/threads");
      const data = res.ok ? await res.json().catch(() => null) : null;
      return isThreadArray(data) ? data : isThreadArray(data?.threads) ? data.threads : [];
    },
  });
  const threads = data ?? [];
  const loading = isLoading;

  return (
    <div className="flex h-full flex-col gap-3">
      <button
        type="button"
        onClick={onNewChat}
        className={cn(
          "flex items-center justify-center gap-2 rounded-lg bg-brand px-3 py-[9px] text-[13px] font-semibold text-on-brand shadow-sh-1",
          "transition-colors hover:bg-brand-2",
        )}
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" aria-hidden />
        New chat
      </button>

      <div className="px-1 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-ink-4">History</div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-1 text-xs text-ink-3">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="px-1 text-xs text-ink-3">No conversations yet</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {threads.map((t) => {
              const active = t.id === activeThreadId;
              return (
                <li key={t.id}>
                  <Link
                    href={`/app/chat?thread=${t.id}`}
                    className={cn(
                      "block w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                      active ? "bg-surface shadow-sh-1" : "hover:bg-surface-2",
                    )}
                  >
                    <div
                      className={cn(
                        "truncate text-[13px] font-medium",
                        active ? "text-ink" : "text-ink-2",
                      )}
                    >
                      {t.title || "Untitled chat"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface-2 px-[7px] py-[1px] font-mono text-[9px] font-semibold text-ink-3">
                        {threadScopeLabel(t)}
                      </span>
                      <span className="font-mono text-[9.5px] text-ink-4">{formatThreadTime(t.updated_at)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
