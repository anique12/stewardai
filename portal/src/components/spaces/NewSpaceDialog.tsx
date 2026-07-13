"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { showToast } from "@/lib/toast";

function LayersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5l8 4-8 4-8-4 8-4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 12l8 4 8-4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function NewSpaceDialog({
  trigger,
  onCreated,
}: {
  /** Custom trigger element (e.g. a bigger "Create a space" CTA for an empty state). */
  trigger?: ReactNode;
  /** When set, called with the new space's id instead of the default toast + refresh —
   *  used by the review queue to create-and-file a meeting in one motion. */
  onCreated?: (spaceId: string) => void;
} = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setName("");
      setError(null);
    }
    setOpen(next);
  }

  async function create() {
    if (busy) return;
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        const created = name.trim();
        const body = await res.json().catch(() => null);
        handleOpenChange(false);
        if (onCreated && body?.id) {
          onCreated(body.id as string);
        } else {
          router.refresh();
          showToast({ message: `"${created}" space created.` });
        }
      } else {
        const body = await res.json().catch(() => null);
        const message = body?.error ?? `Couldn't create space (${res.status}).`;
        setError(message);
        showToast({ message });
      }
    } catch {
      const message = "Couldn't reach the server. Check your connection and try again.";
      setError(message);
      showToast({ message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-[7px] rounded-md border border-line-2 bg-transparent px-3.5 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-2"
          >
            <PlusIcon />
            New space
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[420px]">
        <div className="mb-4 flex items-center gap-[11px]">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand-weak text-brand">
            <LayersIcon />
          </div>
          <div>
            <div className="font-display text-[18px] font-bold text-ink">New space</div>
            <div className="text-[12px] text-ink-3">A thread for a client, project, or topic</div>
          </div>
        </div>
        <label htmlFor="space-name" className="mb-1.5 block text-[12px] font-semibold text-ink-2">
          Name
        </label>
        <input
          id="space-name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="e.g. Meridian Deal"
          className="mb-[18px] w-full rounded-md border border-line-2 bg-paper px-[13px] py-[11px] text-[13.5px] text-ink outline-none placeholder:text-ink-3"
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
            disabled={busy || !name.trim()}
            onClick={create}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-sh-1 transition-colors hover:bg-brand-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create space"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
