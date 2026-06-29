const FEATURES = [
  { title: "Named diarization", body: "Speaker-labelled transcript turns — know who said what." },
  { title: "AI summary", body: "TL;DR + decisions + discrepancies, generated immediately after the meeting." },
  { title: "Action items", body: "Owner, task, and due date — checkable directly in the portal." },
  { title: "Calendar-driven", body: "Reads your calendar; you opt in per meeting. No scheduling friction." },
  { title: "Realtime updates", body: "Transcript and status update live in your browser while the meeting is running." },
  { title: "Privacy-first", body: "Your refresh token is server-side only; bot audio is processed on Hetzner, not third-party cloud." },
];

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="text-center text-3xl font-bold text-foreground">Features</h2>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-lg border border-border bg-card p-5">
            <h3 className="font-semibold text-foreground">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
