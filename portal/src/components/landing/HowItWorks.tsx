const STEPS = [
  { n: "1", title: "Connect your calendar", body: "Sign in with Google and grant StewardAI read-only access to your Google Calendar." },
  { n: "2", title: "Toggle a meeting", body: "Flip the opt-in switch next to any upcoming meeting to send StewardAI to it." },
  { n: "3", title: "Get transcript + results", body: "The bot joins, listens, and delivers a full transcript, AI summary, and action items when it's done." },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-card py-20">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-3xl font-bold text-foreground">How it works</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                {s.n}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
