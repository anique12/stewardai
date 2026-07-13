import { cookies } from "next/headers";
import localFont from "next/font/local";
import { TimezoneSync } from "@/components/TimezoneSync";
import { AppChrome } from "@/components/app-shell/AppChrome";
import { ThemeProvider } from "@/components/app-shell/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import type { NavCounts } from "@/components/app-shell/nav";
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

/** Best-effort count query — a failure here should never break the shell. */
async function safeCount(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await query;
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

async function loadNavCounts(
  db: ReturnType<typeof createServerClient>,
  userId: string
): Promise<NavCounts> {
  const [actions, review, live] = await Promise.all([
    safeCount(
      db.from("action_items").select("id", { count: "exact", head: true }).eq("done", false)
    ),
    safeCount(
      // Same "meetings needing filing" definition as /app/spaces: only
      // processed (done) meetings count — upcoming ones have nothing to
      // file yet.
      db
        .from("meetings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("bot_status", "done")
        .or("space_source.in.(suggested,unfiled),space_id.is.null")
    ),
    // Powers the sidebar's pulsing live-dot on "Meetings" — a lightweight
    // presence check, not a list, so a single row is all we need.
    safeCount(
      db
        .from("meetings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("bot_status", "in_meeting")
    ),
  ]);
  return { actions, review, live: live > 0 };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);
  const counts = await loadNavCounts(supabase, user.id);

  return (
    <ThemeProvider initial={theme} className={`steward-app ${display.variable} ${ui.variable} ${plex.variable}`}>
      <QueryProvider>
        <TimezoneSync />
        <AppChrome email={user.email ?? "Account"} counts={counts}>
          {children}
        </AppChrome>
      </QueryProvider>
    </ThemeProvider>
  );
}
