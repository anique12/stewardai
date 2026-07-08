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

  async function file(spaceId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/space`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: spaceId }),
      });
      if (res.ok) router.refresh();
      else setBusy(false);
    } catch {
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
          className="rounded-md border bg-background px-2 py-1 text-sm"
          disabled={busy}
          defaultValue=""
          onChange={(e) => e.target.value && file(e.target.value)}
        >
          <option value="" disabled>Pick a space…</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPicking(true)}>
          {suggestedSpaceId ? "Choose another" : "File…"}
        </Button>
      )}
    </div>
  );
}
