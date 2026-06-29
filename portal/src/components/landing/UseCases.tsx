const CASES = [
  { title: "Sales calls", body: "Never lose a commitment made on a demo. Action items land in your portal before the call ends." },
  { title: "Engineering stand-ups", body: "Full transcript + decisions for async teammates — no note-taker needed." },
  { title: "Client check-ins", body: "Review TL;DR and decisions before your next meeting without re-watching a recording." },
];

export function UseCases() {
  return (
    <section className="bg-card py-20">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-3xl font-bold text-foreground">Built for real meetings</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {CASES.map((c) => (
            <div key={c.title} className="rounded-lg border border-border bg-background p-6">
              <h3 className="font-semibold text-foreground">{c.title}</h3>
              <p className="mt-2 text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
