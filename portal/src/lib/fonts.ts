import localFont from "next/font/local";

// Self-hosted "paper" design-system fonts (see scripts/fetch-design-fonts.sh).
// Shared between the app shell (src/app/app/layout.tsx) and the marketing
// landing (src/app/layout.tsx) so both can render inside `.steward-app`
// with the correct typefaces. All three were fetched successfully at
// implementation time; if a given woff2 is ever missing from src/app/fonts,
// remove its localFont() call and drop the corresponding className —
// Tailwind's font-display/font-ui already fall back to
// ui-sans-serif/system-ui, and font-mono falls back to --font-mono (Geist)
// when --font-mono-plex is unset.
export const display = localFont({
  src: "../app/fonts/BricolageGrotesk.woff2",
  variable: "--font-display",
  display: "swap",
  weight: "400 800",
});

export const ui = localFont({
  src: "../app/fonts/HankenGrotesk.woff2",
  variable: "--font-ui",
  display: "swap",
  weight: "400 800",
});

export const plex = localFont({
  src: "../app/fonts/IBMPlexMono.woff2",
  variable: "--font-mono-plex",
  display: "swap",
  weight: "400 600",
});

export const paperFontVars = `${display.variable} ${ui.variable} ${plex.variable}`;
