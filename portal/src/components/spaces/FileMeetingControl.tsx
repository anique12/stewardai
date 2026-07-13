"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ConfidenceLevel } from "@/components/common/ConfidenceBadge";
import { NewSpaceDialog } from "@/components/spaces/NewSpaceDialog";

export type SpaceOption = { id: string; name: string };

/** space_confidence is a 0–1 float from the auto-filing model. Thresholds are
 *  tuned so "suggested" (surfaced for review) meetings mostly land medium/low,
 *  while a manual/confirmed file (confidence 1.0) always reads high. */
export function confidenceLevel(value: number | null | undefined): ConfidenceLevel {
  if (value == null) return "low";
  if (value >= 0.75) return "high";
  if (value >= 0.4) return "medium";
  return "low";
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function FileMeetingControl({
  meetingId,
  spaces,
  suggestedSpaceId,
  suggestedSpaceName,
}: {
  meetingId: string;
  spaces: SpaceOption[];
  suggestedSpaceId?: string | null;
  suggestedSpaceName?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function file(spaceId: string) {
    setBusy(true);
    setError(null);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/space`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: spaceId }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Couldn't file meeting (${res.status}).`);
        setBusy(false);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
      setBusy(false);
    }
  }

  const pickOptions = spaces.filter((s) => s.id !== suggestedSpaceId);

  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      {suggestedSpaceId ? (
        <Button size="sm" disabled={busy} onClick={() => file(suggestedSpaceId)} className="gap-[7px]">
          <CheckIcon />
          {busy ? "Filing…" : `File to ${suggestedSpaceName ?? "suggested"}`}
        </Button>
      ) : null}
      <div className="relative">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setMenuOpen((v) => !v)}
          className="gap-[5px]"
        >
          Pick another
          <ChevronDownIcon />
        </Button>
        {menuOpen ? (
          <>
            {/* click-outside backdrop */}
            <div
              role="presentation"
              className="fixed inset-0 z-[59] cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-[40px] z-[60] w-[210px] rounded-lg border border-line-2 bg-surface p-[6px] shadow-sh-pop">
              <div className="px-[9px] pb-[4px] pt-[6px] font-mono text-[9px] uppercase tracking-wide text-ink-4">
                File to
              </div>
              {pickOptions.length === 0 ? (
                <p className="px-[9px] py-2 text-[12.5px] text-ink-3">No other spaces yet.</p>
              ) : (
                pickOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={busy}
                    onClick={() => file(o.id)}
                    className="flex w-full items-center gap-2 rounded-md px-[9px] py-2 text-left text-[12.5px] text-ink transition-colors hover:bg-surface-2"
                  >
                    <span className="h-[6px] w-[6px] shrink-0 rounded-sm bg-brand" />
                    {o.name}
                  </button>
                ))
              )}
              <div className="my-[5px] h-px bg-line" />
              <NewSpaceDialog
                onCreated={(id) => file(id)}
                trigger={
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-[9px] py-2 text-left text-[12.5px] font-semibold text-brand transition-colors hover:bg-surface-2"
                  >
                    <PlusIcon />
                    File to a new space…
                  </button>
                }
              />
            </div>
          </>
        ) : null}
      </div>
      {error ? <span role="alert" className="w-full text-xs text-danger-strong">{error}</span> : null}
    </div>
  );
}
