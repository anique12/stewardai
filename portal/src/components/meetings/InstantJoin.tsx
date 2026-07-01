"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InstantJoin() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/meetings/instant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Couldn't start the join. Please try again.");
        setLoading(false);
        return;
      }
      // Steward is queued — the backend scheduler will spawn the bot shortly.
      setJoining(true);
      setUrl("");
      if (data?.id) {
        router.push(`/app/meetings/${data.id}`);
      } else {
        router.refresh();
        setLoading(false);
        setJoining(false);
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-lg font-semibold text-foreground">Instant join</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste a Google Meet, Zoom, or Teams link and Steward will join right away —
        no calendar sync needed.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Input
          type="url"
          inputMode="url"
          placeholder="https://meet.google.com/abc-defg-hij"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          disabled={loading}
          aria-label="Meeting link"
          aria-invalid={error ? true : undefined}
          className="flex-1"
        />
        <Button type="submit" disabled={loading || url.trim().length === 0}>
          {loading ? "Sending…" : "Send Steward"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {joining && !error && (
        <p className="mt-2 text-sm text-muted-foreground">
          Steward is joining… the bot appears once the scheduler picks it up (usually within a minute).
        </p>
      )}
    </div>
  );
}
