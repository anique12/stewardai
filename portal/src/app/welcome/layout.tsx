import { cookies } from "next/headers";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/app-shell/ThemeProvider";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { requireUserPage } from "@/lib/auth-helpers";

// Same self-hosted "paper" design-system fonts as src/app/app/layout.tsx —
// see scripts/fetch-design-fonts.sh. Duplicated here (rather than imported)
// because next/font/local requires the call to live in the file that uses
// it; keep the two in sync if a font is ever swapped.
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

/**
 * Full-viewport, chrome-free layout for the post-signin onboarding wizard.
 * No sidebar/topbar — just the `.steward-app` token scope + fonts + theme,
 * matching src/app/app/layout.tsx's wrapper pattern so the wizard renders
 * with the same paper design system in both light and dark.
 */
export default async function WelcomeLayout({ children }: { children: React.ReactNode }) {
  await requireUserPage(); // redirects to "/" if unauthenticated

  const theme = parseTheme(cookies().get(THEME_COOKIE)?.value);

  return (
    <ThemeProvider initial={theme} className={`steward-app ${display.variable} ${ui.variable} ${plex.variable}`}>
      {children}
    </ThemeProvider>
  );
}
