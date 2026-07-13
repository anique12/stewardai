"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export type SpaceOption = { id: string; name: string };

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
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function file(spaceId: string) {
    setBusy(true);
    setError(null);
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestedSpaceId ? (
        <Button size="sm" disabled={busy} onClick={() => file(suggestedSpaceId)}>
          {busy ? "Filing…" : `Confirm: ${suggestedSpaceName ?? "suggested"}`}
        </Button>
      ) : null}
      {picking ? (
        <select
          className="rounded-md border border-line-2 bg-surface px-2 py-1 text-[12.5px] text-ink"
          disabled={busy}
          defaultValue=""
          onChange={(e) => e.target.value && file(e.target.value)}
        >
          <option value="" disabled>Pick a space…</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPicking(true)}>
          {suggestedSpaceId ? "Choose another" : "Move to space…"}
        </Button>
      )}
      {error ? <span role="alert" className="w-full text-xs text-danger-strong">{error}</span> : null}
    </div>
  );
}
