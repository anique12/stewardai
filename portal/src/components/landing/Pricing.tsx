import Link from "next/link";

const TIERS = [
  { name: "Free", price: "$0/mo", features: ["3 meetings / month", "Transcript + summary", "Action items", "1 user"], cta: "Start free", href: "/auth/login", highlight: false },
  { name: "Pro", price: "$X/mo", features: ["Unlimited meetings", "Everything in Free", "Priority processing", "Early access to new features"], cta: "Coming soon", href: "#", highlight: true },
];

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-4xl px-6 py-20">
      <h2 className="text-center text-3xl font-bold text-foreground">Pricing</h2>
      <p className="mt-2 text-center text-muted-foreground">Simple tiers. No credit card required to start.</p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {TIERS.map((t) => (
          <div key={t.name}
            className={`rounded-lg border p-6 ${t.highlight ? "border-primary bg-card" : "border-border bg-card"}`}>
            <h3 className="text-xl font-bold text-foreground">{t.name}</h3>
            <p className="mt-1 text-2xl font-semibold text-primary">{t.price}</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {t.features.map((f) => <li key={f} className="flex gap-2"><span className="text-primary">&#x2713;</span>{f}</li>)}
            </ul>
            <Link href={t.href}
              className={`mt-6 block w-full rounded-md px-4 py-2 text-center text-sm font-medium
                ${t.highlight ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:opacity-90"}`}>
              {t.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
