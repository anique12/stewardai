import { LandingNav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { StatsBar } from "@/components/landing/StatsBar";
import { ProductSuite } from "@/components/landing/ProductSuite";
import { Features } from "@/components/landing/Features";
import { SpeaksInMeeting } from "@/components/landing/SpeaksInMeeting";
import { VoiceAgents } from "@/components/landing/VoiceAgents";
import { Developers } from "@/components/landing/Developers";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { UseCases } from "@/components/landing/UseCases";
import { Pricing } from "@/components/landing/Pricing";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { LandingFooter } from "@/components/landing/Footer";

export default function HomePage() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <StatsBar />
        <ProductSuite />
        <Features />
        <SpeaksInMeeting />
        <VoiceAgents />
        <Developers />
        <HowItWorks />
        <UseCases />
        <Pricing />
        <FinalCTA />
      </main>
      <LandingFooter />
    </>
  );
}
