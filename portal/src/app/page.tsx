import { cookies } from "next/headers";
import { LandingNav } from "@/components/landing/Nav";
import { LandingShell } from "@/components/landing/LandingShell";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { SpeaksInMeeting } from "@/components/landing/SpeaksInMeeting";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { LandingFooter } from "@/components/landing/Footer";
import { createServerClient } from "@/lib/supabase/server";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthed = !!user;
  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);

  return (
    <LandingShell initial={theme}>
      <LandingNav isAuthed={isAuthed} />
      <main>
        <Hero isAuthed={isAuthed} />
        <Features />
        <SpeaksInMeeting />
        <HowItWorks />
        <FinalCTA />
      </main>
      <LandingFooter />
    </LandingShell>
  );
}
