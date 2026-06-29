type Segment = { id: string; seq: number; speaker: string; text: string };

export function TranscriptPanel({ segments }: { segments: Segment[] }) {
  if (!segments.length) {
    return <p className="text-muted-foreground">Transcript will appear here once the meeting starts.</p>;
  }
  return (
    <div className="space-y-3">
      {segments.map((s) => (
        <div key={s.id} className="flex gap-3">
          <span className="w-24 shrink-0 text-sm font-medium text-primary">{s.speaker}</span>
          <p className="text-foreground">{s.text}</p>
        </div>
      ))}
    </div>
  );
}
