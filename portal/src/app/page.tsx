import { Features } from "@/components/landing/Features";
import { LandingFooter } from "@/components/landing/Footer";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingNav } from "@/components/landing/Nav";
import { Pricing } from "@/components/landing/Pricing";
import { UseCases } from "@/components/landing/UseCases";
import { VoiceDemo } from "@/components/landing/VoiceDemo";

export default function HomePage() {
  return (
    <>
      <LandingNav />
      <main>
        <section id="hero" className="mx-auto max-w-6xl px-6 pt-20 pb-12 text-center">
          <h1 className="text-5xl font-extrabold text-foreground leading-tight">
            Your AI agent for every meeting.
          </h1>
          <p className="mt-4 mx-auto max-w-2xl text-lg text-muted-foreground">
            Connect your Google Calendar. Toggle a meeting. StewardAI joins, listens, and delivers
            a full transcript, summary, and action items.
          </p>
          <div id="demo" className="mt-10 rounded-lg border border-border bg-card p-8 max-w-xl mx-auto space-y-3">
            <h2 className="font-semibold text-foreground">Try it now</h2>
            <p className="text-sm text-muted-foreground">Click below to talk to StewardAI live (mic required, ~60s session).</p>
            <VoiceDemo />
          </div>
        </section>
        <HowItWorks />
        <Features />
        <UseCases />
        <Pricing />
      </main>
      <LandingFooter />
    </>
  );
}
