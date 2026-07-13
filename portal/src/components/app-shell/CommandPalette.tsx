"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/app/api/search/route";

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  meeting: "meeting",
  person: "person",
  space: "space",
  action: "action",
};

const TYPE_BADGE_CLASS: Record<SearchResult["type"], string> = {
  meeting: "bg-brand-weak text-brand-ink",
  person: "bg-surface-3 text-ink-2",
  space: "bg-attention-weak text-attention-strong",
  action: "bg-danger-weak text-danger-strong",
};

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Reset on open/close.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounced fetch as the query changes.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({ results: [] }));
        setResults(Array.isArray(data?.results) ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  const openResult = useCallback(
    (r: SearchResult) => {
      close();
      router.push(r.href);
    },
    [close, router]
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter" && results.length > 0) {
        e.preventDefault();
        openResult(results[0]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close, results, openResult]);

  if (!open || typeof document === "undefined") return null;

  const trimmed = query.trim();
  const showEmpty = trimmed.length >= 2 && !loading && results.length === 0;

  return createPortal(
    <div
      className="steward-app fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-5"
      style={{ paddingTop: "12vh" }}
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-xl border border-line-2 bg-surface shadow-sh-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <div className="flex items-center gap-[11px] border-b border-line px-[18px] py-[15px]">
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-3" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search meetings, people, facts, actions…"
            aria-label="Search meetings, people, facts, actions"
            className="flex-1 border-none bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            onClick={close}
            className="rounded-[5px] border border-line-2 px-[7px] py-[3px] font-mono text-[10px] text-ink-4"
          >
            esc
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              onClick={() => openResult(r)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-[11px] text-left transition-colors hover:bg-surface-2"
            >
              <span
                className={cn(
                  "shrink-0 rounded-pill px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
                  TYPE_BADGE_CLASS[r.type]
                )}
              >
                {TYPE_LABEL[r.type]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink">{r.title}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{r.sub}</span>
              </span>
            </button>
          ))}
          {showEmpty ? (
            <div className="px-5 py-[34px] text-center text-[13px] text-ink-3">
              No matches. Try a name, a client, or a decision.
            </div>
          ) : null}
          {trimmed.length < 2 && !loading ? (
            <div className="px-5 py-[34px] text-center text-[13px] text-ink-3">
              Keep typing to search meetings, people, spaces, and action items.
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-3.5 border-t border-line px-4 py-[10px] font-mono text-[10px] text-ink-4">
          <span>↵ open</span>
          <span>esc close</span>
          <span className="flex-1" />
          <span>Powered by Steward recall</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
