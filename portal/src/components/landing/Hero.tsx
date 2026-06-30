import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Container } from "./primitives";
import { VoiceDemoDialog } from "./VoiceDemoDialog";

const BARS = [0.4, 0.7, 0.35, 0.9, 0.55, 1, 0.45, 0.8, 0.3, 0.65, 0.5, 0.85, 0.4, 0.75, 0.35];

export function Hero() {
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
            href="#voice-agents"
            className="reveal reveal-1 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            New — sub-second voice agents with barge-in
            <ArrowRight className="h-3 w-3" aria-hidden />
          </a>

          <h1 className="reveal reveal-2 mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Your personal AI agent — and the{" "}
            <span className="accent-text">voice stack</span> to build your own.
          </h1>

          <p className="reveal reveal-3 mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
            StewardAI is one platform: Steward, a proactive personal agent that sits in your
            meetings and remembers everything, plus the real-time voice infrastructure —
            agents, speech-to-text, and text-to-speech — that developers ship on.
          </p>

          <div className="reveal reveal-3 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/login"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Start free
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <VoiceDemoDialog variant="outline" />
          </div>

          <ul className="reveal reveal-4 mx-auto mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {["No credit card", "Free tier", "Live demo, no signup"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Hero visual: a live-pipeline panel */}
        <div className="reveal reveal-4 mx-auto mt-16 max-w-4xl">
          <div className="card-ring overflow-hidden rounded-2xl shadow-2xl shadow-black/40">
            <div className="flex items-center gap-2 border-b border-border bg-background/60 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-primary/70" aria-hidden />
              <span className="ml-2 font-mono text-xs text-muted-foreground">steward · live session</span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
                streaming
              </span>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-[1.4fr_1fr]">
              {/* Transcript */}
              <div className="bg-card p-5 sm:p-6">
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Transcript
                </p>
                <div className="mt-4 space-y-3 text-sm">
                  <p>
                    <span className="font-medium text-primary">Priya</span>{" "}
                    <span className="text-muted-foreground">00:14</span>
                    <br />
                    <span className="text-foreground">Can we ship the billing fix before the Q3 review?</span>
                  </p>
                  <p>
                    <span className="font-medium text-primary">Marcus</span>{" "}
                    <span className="text-muted-foreground">00:21</span>
                    <br />
                    <span className="text-foreground">Yes — I&apos;ll own it and have a PR up by Thursday.</span>
                  </p>
                </div>
                {/* Waveform */}
                <div className="mt-6 flex h-10 items-end gap-1" aria-hidden>
                  {BARS.map((h, i) => (
                    <span
                      key={i}
                      className="equalizer-bar w-full rounded-full bg-primary/70"
                      style={{ height: `${h * 100}%`, animationDelay: `${i * 0.07}s` }}
                    />
                  ))}
                </div>
              </div>
              {/* Steward output */}
              <div className="bg-card p-5 sm:p-6">
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Steward
                </p>
                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Decision</p>
                    <p className="text-foreground">Ship billing fix ahead of Q3 review.</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Action item</p>
                    <p className="text-foreground">
                      <span className="text-primary">@Marcus</span> — billing PR, due Thu.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
