"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Radio } from "lucide-react";
import { useInstantJoin } from "@/components/meetings/InstantJoin";

export function InstantJoinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { url, setUrl, loading, error, setError, submit, reset } = useInstantJoin();

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function join() {
    submit(() => handleOpenChange(false));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[440px]">
        <div className="mb-3.5 flex items-center gap-[11px]">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand text-on-brand">
            <Radio className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <div className="font-display text-[18px] font-bold text-ink">Instant join</div>
            <div className="text-[12px] text-ink-3">Point MeetBase at a meeting happening now</div>
          </div>
        </div>
        <p className="mb-3 text-[13px] leading-[1.5] text-ink-2">
          Paste a Google Meet link. MeetBase joins and starts transcribing right away. Zoom and
          Microsoft Teams are coming soon.
        </p>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && join()}
          autoFocus
          placeholder="https://meet.google.com/abc-defg-hij"
          aria-label="Meeting link"
          aria-invalid={error ? true : undefined}
          disabled={loading}
          className="mb-4 w-full rounded-md border border-line-2 bg-paper px-[13px] py-[11px] text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        {error ? (
          <p role="alert" className="mb-3 text-[13px] text-danger-strong">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="rounded-md border border-line-2 px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={join}
            disabled={loading || url.trim().length === 0}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-sh-1 transition-colors hover:bg-brand-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? "Joining…" : "Join now"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
