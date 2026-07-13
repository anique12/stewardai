"use client";

// Chat input: auto-growing textarea + send button + a scope selector that lets
// the user narrow a question to "All work", a specific Space, or a specific
// Meeting. Enter (no shift) sends while not streaming; Shift+Enter inserts a
// newline. The scope choice becomes a text hint prepended by `useChat.send` —
// see there; the WS `user_message` payload shape itself is unchanged.

import { useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Layers } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChatScopeOptions } from "@/hooks/useChatScopeOptions";
import type { ChatScope } from "@/hooks/useChat";
import { cn } from "@/lib/utils";

function scopeLabel(scope: ChatScope): string {
  return scope.kind === "all" ? "All work" : scope.label;
}

export function Composer({
  onSend,
  disabled = false,
  placeholder = "Ask Steward, or tell it to do something…",
}: {
  onSend: (text: string, scope?: ChatScope) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<ChatScope>({ kind: "all" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { spaces, meetings } = useChatScopeOptions();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, scope);
    setValue("");
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
  }

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-paper via-paper/95 to-transparent pb-4 pt-6">
      <div
        className={cn(
          "mx-auto flex max-w-3xl flex-col gap-1 rounded-xl border-[1.5px] border-line-2 bg-surface px-3 py-2 shadow-sh-1",
          "transition-colors focus-within:border-brand-weak-2",
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-[180px] min-h-[24px] w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
        />
        <div className="flex items-center gap-2 px-1 pb-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-[6px] rounded-pill border border-line bg-surface-2 px-2.5 py-[5px] text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-3"
              >
                <Layers className="h-[13px] w-[13px]" aria-hidden />
                {scopeLabel(scope)}
                <ChevronDown className="h-3 w-3" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-4">
                Scope of question
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => setScope({ kind: "all" })}
                className="flex items-center justify-between text-[12.5px]"
              >
                All work
                {scope.kind === "all" && <Check className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />}
              </DropdownMenuItem>

              {spaces.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-4">
                    Spaces
                  </DropdownMenuLabel>
                  {spaces.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onSelect={() => setScope({ kind: "space", id: s.id, label: s.name })}
                      className="flex items-center justify-between gap-2 text-[12.5px]"
                    >
                      <span className="min-w-0 truncate">{s.name}</span>
                      {scope.kind === "space" && scope.id === s.id && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                      )}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {meetings.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-4">
                    Meetings
                  </DropdownMenuLabel>
                  {meetings.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      onSelect={() => setScope({ kind: "meeting", id: m.id, label: m.title })}
                      className="flex items-center justify-between gap-2 text-[12.5px]"
                    >
                      <span className="min-w-0 truncate">{m.title}</span>
                      {scope.kind === "meeting" && scope.id === m.id && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                      )}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="flex-1" />
          <span className="hidden text-[10.5px] text-ink-4 sm:inline">Steward can act on connected apps</span>
          <button
            type="button"
            aria-label="Send"
            disabled={disabled || !value.trim()}
            onClick={submit}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-on-brand shadow-sh-1 transition-colors hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
