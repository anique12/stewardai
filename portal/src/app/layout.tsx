import type { Metadata } from "next";
import localFont from "next/font/local";
import { paperFontVars } from "@/lib/fonts";
import "./globals.css";

// Self-hosted Inter (variable) — avoids a build-time Google Fonts fetch that
// times out on slow/offline networks and left the site unstyled.
const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://meetbase.site"),
  title: {
    default: "MeetBase — AI notetaker & meeting assistant",
    template: "%s — MeetBase",
  },
  description:
    "MeetBase joins your meetings, takes notes and action items automatically, and organizes everything into spaces — with an assistant you can ask about your entire meeting history.",
  openGraph: {
    title: "MeetBase — AI notetaker & meeting assistant",
    description:
      "MeetBase joins your meetings, captures notes and action items, and lets you chat over your meeting history.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} ${paperFontVars}`}>
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
