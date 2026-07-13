import Link from "next/link";
import { groupFacts, type FactRow, type FactKind } from "@/lib/spaces/facts";

const SECTIONS: { kind: FactKind; label: string; dot: string; count: string }[] = [
  { kind: "action_item", label: "Open items", dot: "bg-attention", count: "border-attention-weak bg-attention-weak text-attention-strong" },
  { kind: "decision", label: "Decisions", dot: "bg-brand", count: "border-brand-weak-2 bg-brand-weak text-brand-ink" },
  { kind: "date", label: "Key dates", dot: "bg-ink-3", count: "border-line-2 bg-surface-2 text-ink-3" },
  { kind: "risk", label: "Risks", dot: "bg-danger", count: "border-danger-weak bg-danger-weak text-danger-strong" },
  { kind: "open_question", label: "Open questions", dot: "bg-ink-3", count: "border-line-2 bg-surface-2 text-ink-3" },
];

function CiteIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 17H5a2 2 0 01-2-2V7M15 7h4a2 2 0 012 2v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M15 4l-4 3 4 3M9 20l4-3-4-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "What's known" fact groups for a space — each fact links back to the
 *  meeting it was captured in, so every claim is traceable to its source. */
export function SpaceFactsPanel({ facts }: { facts: FactRow[] }) {
  const grouped = groupFacts(facts);
  const anything = SECTIONS.some((s) => grouped[s.kind].length > 0);
  if (!anything) {
    return <p className="text-sm text-ink-3">No facts captured yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3.5">
      {SECTIONS.map(({ kind, label, dot, count }) => {
        const rows = grouped[kind];
        if (rows.length === 0) return null;
        return (
          <div key={kind} className="rounded-lg border border-line bg-surface px-4 py-[14px] shadow-sh-1">
            <div className="mb-[11px] flex items-center gap-2">
              <span className={`h-[7px] w-[7px] shrink-0 rounded-pill ${dot}`} />
              <span className="text-[13px] font-bold">{label}</span>
              <span className={`ml-auto rounded-pill border px-2 py-[1px] font-mono text-[10px] font-semibold ${count}`}>
                {rows.length}
              </span>
            </div>
            <div className="flex flex-col gap-[11px]">
              {rows.map((r) => (
                <div key={r.id} className="flex items-start gap-[10px]">
                  <span className={`mt-[6px] h-[5px] w-[5px] shrink-0 rounded-pill ${dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-[1.5] text-ink">
                      {r.text}
                      {r.due || r.owner ? (
                        <span className="font-mono text-[11px] text-ink-3">
                          {" "}
                          · {[r.due, r.owner].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                    {r.meeting_id ? (
                      <Link
                        href={`/app/meetings/${r.meeting_id}`}
                        className="mt-[5px] inline-flex items-center gap-[5px] rounded-md border border-line-2 bg-surface-2 px-[7px] py-[3px] font-mono text-[10px] font-semibold text-ink-3 transition-colors hover:bg-surface-3"
                      >
                        <CiteIcon />
                        source
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
