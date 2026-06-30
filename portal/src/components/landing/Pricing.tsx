import Link from "next/link";
import { Check } from "lucide-react";
import { Container, SectionHeading } from "./primitives";
import { cn } from "@/lib/utils";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    unit: "/ month",
    blurb: "For trying Steward on your own meetings.",
    features: [
      "5 meetings / month",
      "Named-speaker transcripts",
      "Summaries & action items",
      "7-day recall history",
      "1 connected calendar",
    ],
    cta: "Start free",
    href: "/auth/login",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$24",
    unit: "/ month",
    blurb: "Your personal agent, full-time.",
    features: [
      "Unlimited meetings",
      "Auto-join recurring calls",
      "Unlimited recall & search",
      "Proactive follow-up nudges",
      "Priority processing",
      "Export to Notion & Slack",
    ],
    cta: "Start Pro",
    href: "/auth/login",
    highlight: true,
  },
  {
    name: "API",
    price: "Usage-based",
    unit: "",
    blurb: "STT, TTS & Voice Agents for developers.",
    features: [
      "STT from $0.0042 / min",
      "TTS from $14 / 1M chars",
      "Streaming endpoints",
      "Word timestamps & diarization",
      "Pay only for what you use",
    ],
    cta: "Read the docs",
    href: "#developers",
    highlight: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-border bg-card/30 py-20 sm:py-28">
      <Container>
        <SectionHeading
          align="center"
          eyebrow="Pricing"
          title="Start free. Scale on usage."
          lead="A personal plan for individuals and metered APIs for builders. No credit card to start; enterprise terms when you need them."
        />
        <div className="mt-12 grid items-start gap-5 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={cn(
                "relative flex h-full flex-col rounded-2xl p-7",
                t.highlight
                  ? "border border-primary/50 bg-card shadow-2xl shadow-primary/10"
                  : "card-ring",
              )}
            >
              {t.highlight ? (
                <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary-foreground">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-base font-semibold text-foreground">{t.name}</h3>
              <p className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight text-foreground">{t.price}</span>
                {t.unit ? <span className="text-sm text-muted-foreground">{t.unit}</span> : null}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{t.blurb}</p>
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-foreground/90">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={t.href}
                className={cn(
                  "mt-7 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  t.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border text-foreground hover:border-primary/60 hover:text-primary",
                )}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Need SSO, on-prem, or volume pricing?{" "}
          <a href="#footer" className="font-medium text-primary hover:underline">
            Contact sales
          </a>
          .
        </p>
      </Container>
    </section>
  );
}
