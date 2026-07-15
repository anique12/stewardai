import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Container } from "./primitives";
import { VoiceToWork } from "./VoiceToWork";
import { landingCta } from "@/lib/landing-cta";

export function Hero({ isAuthed = false }: { isAuthed?: boolean }) {
  const cta = landingCta(isAuthed);
  return (
    <section id="hero" className="relative overflow-hidden">
      {/* Ambient glow + grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-grid opacity-60" />
        <div className="absolute left-1/2 top-[-10%] h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
      </div>

      <Container className="relative pt-20 pb-16 sm:pt-28 sm:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href="#speaks"
            className="reveal reveal-1 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            New — MeetBase can speak up in your meetings
            <ArrowRight className="h-3 w-3" aria-hidden />
          </a>

          <h1 className="reveal reveal-2 mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            An active teammate —{" "}
            <span className="accent-text">not a notetaker</span>.
          </h1>

          <p className="reveal reveal-3 mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            It shows up briefed, speaks up when you ask, and captures every
            decision and action item.
          </p>

          <div className="reveal reveal-3 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={cta.href}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {cta.primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-transparent px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              See how it works
            </a>
          </div>

          <ul className="reveal reveal-4 mx-auto mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {["No credit card", "Free tier", "Read-only calendar access"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Hero visual: a meeting flowing from live capture → transcript → work. */}
        <div className="reveal reveal-4 mx-auto mt-16 max-w-4xl">
          <VoiceToWork />
        </div>
      </Container>
    </section>
  );
}
