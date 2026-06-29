type Summary = { tldr: string; decisions: { text: string }[]; discrepancies: { text: string }[] } | null;

export function SummaryPanel({ summary }: { summary: Summary }) {
  if (!summary) return <p className="text-muted-foreground">Summary will appear after the meeting ends.</p>;
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-foreground">TL;DR</h4>
        <p className="mt-1 text-muted-foreground">{summary.tldr}</p>
      </div>
      {summary.decisions.length > 0 && (
        <div>
          <h4 className="font-semibold text-foreground">Decisions</h4>
          <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground">
            {summary.decisions.map((d, i) => <li key={i}>{d.text}</li>)}
          </ul>
        </div>
      )}
      {summary.discrepancies.length > 0 && (
        <div>
          <h4 className="font-semibold text-foreground">Discrepancies</h4>
          <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground">
            {summary.discrepancies.map((d, i) => <li key={i}>{d.text}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
