import Link from "next/link";
import { groupFacts, type FactRow, type FactKind } from "@/lib/spaces/facts";

const SECTIONS: { kind: FactKind; label: string }[] = [
  { kind: "action_item", label: "Open items" },
  { kind: "decision", label: "Decisions" },
  { kind: "date", label: "Key dates" },
  { kind: "risk", label: "Risks" },
  { kind: "open_question", label: "Open questions" },
];

export function SpaceFactsPanel({ facts }: { facts: FactRow[] }) {
  const grouped = groupFacts(facts);
  const anything = SECTIONS.some((s) => grouped[s.kind].length > 0);
  if (!anything) {
    return <p className="text-sm text-muted-foreground">No facts captured yet.</p>;
  }
  return (
    <div className="space-y-4">
      {SECTIONS.map(({ kind, label }) => {
        const rows = grouped[kind];
        if (rows.length === 0) return null;
        return (
          <div key={kind}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="text-sm">
                  {/* Provenance: link back to the source meeting when known */}
                  {r.meeting_id ? (
                    <Link href={`/app/meetings/${r.meeting_id}`} className="hover:underline">
                      {r.text}
                    </Link>
                  ) : (
                    r.text
                  )}
                  {r.due ? <span className="text-muted-foreground"> · {r.due}</span> : null}
                  {r.owner ? <span className="text-muted-foreground"> · {r.owner}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
