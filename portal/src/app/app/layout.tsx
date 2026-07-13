import { cookies } from "next/headers";
import localFont from "next/font/local";
import { TimezoneSync } from "@/components/TimezoneSync";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { ThemeProvider } from "@/components/app-shell/ThemeProvider";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Self-hosted "paper" design-system fonts (see scripts/fetch-design-fonts.sh).
// All three were fetched successfully at implementation time; if a given
// woff2 is ever missing from src/app/fonts, remove its localFont() call and
// drop the corresponding className below — Tailwind's font-display/font-ui
// already fall back to ui-sans-serif/system-ui, and font-mono falls back to
// --font-mono (Geist) when --font-mono-plex is unset.
const display = localFont({
  src: "../fonts/BricolageGrotesk.woff2",
  variable: "--font-display",
  display: "swap",
  weight: "400 800",
});
const ui = localFont({
  src: "../fonts/HankenGrotesk.woff2",
  variable: "--font-ui",
  display: "swap",
  weight: "400 800",
});
const plex = localFont({
  src: "../fonts/IBMPlexMono.woff2",
  variable: "--font-mono-plex",
  display: "swap",
  weight: "400 600",
});

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);

  return (
    <ThemeProvider initial={theme} className={`steward-app ${display.variable} ${ui.variable} ${plex.variable}`}>
      <TimezoneSync />
      <Sidebar email={user.email ?? "Account"} />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        {children}
      </main>
    </ThemeProvider>
  );
}
