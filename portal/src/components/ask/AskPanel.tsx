"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { askQuestion, splitAnswerWithCitations, type AskResult } from "@/lib/ask/client";

export function AskPanel({ spaceId = null }: { spaceId?: string | null }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function ask() {
    if (busy || !query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const baseUrl = process.env.NEXT_PUBLIC_ASK_API_URL;
      if (!token || !baseUrl) throw new Error("Ask is not available (sign in / configure API).");
      setResult(await askQuestion({ baseUrl, token }, { query: query.trim(), spaceId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const citById = new Map((result?.citations ?? []).map((c) => [c.n, c]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="Ask about your meetings… e.g. where are we with Acme?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          disabled={busy}
        />
        <button
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          onClick={ask}
          disabled={busy || !query.trim()}
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed">
            {splitAnswerWithCitations(result.answer).map((part, i) =>
              part.type === "text" ? (
                <span key={i}>{part.value}</span>
              ) : (
                <sup key={i} className="mx-0.5 text-blue-600">
                  {citById.has(part.n) ? (
                    <Link href={`/app/meetings/${citById.get(part.n)!.meeting_id}`}>[{part.n}]</Link>
                  ) : (
                    <>[{part.n}]</>
                  )}
                </sup>
              ),
            )}
          </p>

          {result.citations.length > 0 && (
            <ol className="flex flex-col gap-1 border-t pt-3 text-xs text-gray-600">
              {result.citations.map((c) => (
                <li key={c.n}>
                  <Link href={`/app/meetings/${c.meeting_id}`} className="text-blue-600">
                    [{c.n}]
                  </Link>{" "}
                  <span className="text-gray-400">({c.kind})</span> {c.snippet}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
