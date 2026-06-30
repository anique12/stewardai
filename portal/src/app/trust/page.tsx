import type { Metadata } from "next";
import React from "react";
import { Lock, ShieldCheck, Brain, Eye, Settings2, List, ChevronRight } from "lucide-react";
import { LandingNav } from "@/components/landing/Nav";
import { LandingFooter } from "@/components/landing/Footer";
import { Container } from "@/components/landing/primitives";

export const metadata: Metadata = {
  title: "Security & Trust",
  description: "How StewardAI protects your data and keeps your meetings private.",
};

const PILLARS = [
  {
    icon: Lock,
    title: "End-to-end encryption",
    description:
      "All data is encrypted in transit with TLS and encrypted at rest. Meeting audio is processed over secure channels only.",
  },
  {
    icon: ShieldCheck,
    title: "Your data is isolated",
    description:
      "We use row-level security so each user's data is strictly isolated. No user can access another's meetings, transcripts, or summaries.",
  },
  {
    icon: Brain,
    title: "We never train on your data",
    description:
      "Your meeting content is never used to train AI models — ours or our sub-processors'. Our AI providers are contractually restricted from training on your data via API.",
  },
  {
    icon: Eye,
    title: "Transparent by design",
    description:
      "Our meeting bot always joins as a named, visible participant. It never impersonates a human or records covertly. Every participant can see it in the attendee list.",
  },
  {
    icon: Settings2,
    title: "You're in control",
    description:
      "Opt individual meetings in or out. Delete any recording or transcript at any time. Revoke calendar access. Delete your account and all data.",
  },
  {
    icon: List,
    title: "Sub-processor transparency",
    description:
      "We publish our complete sub-processor list in our Privacy Policy and keep it up to date. You always know which providers handle your data.",
  },
];

const STEPS = [
  {
    title: "Calendar opt-in",
    body: "You choose which meetings to enable. StewardAI reads your calendar (read-only) to show upcoming events.",
  },
  {
    title: "Bot joins visibly",
    body: "Your named bot joins as a visible participant when the meeting starts. All attendees can see it.",
  },
  {
    title: "Transcribe & summarise",
    body: "Audio is transcribed and summarised via AI over secure, encrypted channels.",
  },
  {
    title: "Stored & yours",
    body: "Results are stored encrypted in your account. View, share, or delete anytime.",
  },
];

export default function TrustPage() {
  return (
    <>
      <LandingNav />
      <main>
        <Container>
          {/* A) Hero */}
          <section className="py-20 text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-primary mb-4">Trust &amp; Security</p>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-foreground max-w-3xl mx-auto">
              Built to earn your trust
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Your meetings are sensitive. Here&apos;s exactly how we handle your data — and why you can trust us
              with it.
            </p>
          </section>

          {/* B) 6 Trust pillar cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 py-16">
            {PILLARS.map((pillar) => (
              <div key={pillar.title} className="card-ring rounded-xl p-6">
                <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                  <pillar.icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mb-2 text-base font-semibold text-foreground">{pillar.title}</h3>
                <p className="text-sm leading-6 text-muted-foreground">{pillar.description}</p>
              </div>
            ))}
          </div>

          {/* C) Data flow strip */}
          <div className="bg-card/30 border border-border rounded-xl p-8 my-16">
            <h2 className="mt-0 mb-8 text-xl font-semibold text-foreground">How your meeting data flows</h2>
            <div className="flex flex-wrap items-start gap-4">
              {STEPS.map((step, i) => (
                <React.Fragment key={step.title}>
                  <div className="min-w-[140px] flex-1">
                    <div className="mb-2 text-sm font-medium text-primary">{i + 1}</div>
                    <div className="mb-1 text-sm font-semibold text-foreground">{step.title}</div>
                    <p className="text-xs leading-5 text-muted-foreground">{step.body}</p>
                  </div>
                  {i < STEPS.length - 1 && (
                    <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* D) Compliance section */}
          <div className="py-16 border-t border-border">
            <h2 className="text-2xl font-semibold text-foreground mb-8">Compliance posture</h2>

            <div className="space-y-8">
              <div>
                <h3 className="mt-6 mb-3 text-base font-semibold text-foreground">GDPR &amp; CCPA aligned</h3>
                <p className="mb-4 leading-7 text-muted-foreground">
                  We process EU and California personal data in accordance with GDPR and CCPA requirements. See our{" "}
                  <a href="/privacy" className="text-primary underline-offset-4 hover:underline">Privacy Policy</a>{" "}
                  for your rights.
                </p>
              </div>

              <div>
                <h3 className="mt-6 mb-3 text-base font-semibold text-foreground">Secure cloud infrastructure</h3>
                <p className="mb-4 leading-7 text-muted-foreground">
                  StewardAI is built on Supabase (database), Vercel (web hosting), and Hetzner (backend/bot
                  infrastructure) — providers with strong security standards.
                </p>
              </div>

              <div>
                <h3 className="mt-6 mb-3 text-base font-semibold text-foreground">SOC 2</h3>
                <p className="mb-4 leading-7 text-muted-foreground">
                  SOC 2 Type II certification is on our roadmap. We are working toward it and will publish the
                  report when available. We do not currently hold SOC 2 certification.
                </p>
              </div>
            </div>
          </div>

          {/* E) CTA close */}
          <div className="py-16 text-center border-t border-border">
            <h2 className="text-2xl font-semibold text-foreground mb-4">Questions about security?</h2>
            <p className="mb-8 text-muted-foreground leading-7 max-w-xl mx-auto">
              We&apos;re happy to walk you through our architecture, data flows, or compliance posture.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="/privacy"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Read Privacy Policy
              </a>
              <a
                href="/terms"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Read Terms of Service
              </a>
              <a
                href="mailto:[security@...]"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Email security team
              </a>
            </div>
          </div>
        </Container>
      </main>
      <LandingFooter />
    </>
  );
}
