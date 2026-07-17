import type { Metadata } from "next";
import localFont from "next/font/local";
import { paperFontVars } from "@/lib/fonts";
import { Analytics } from "@vercel/analytics/next";
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
    default: "MeetBase — The active AI meeting agent",
    template: "%s — MeetBase",
  },
  description:
    "MeetBase is an active AI meeting agent: it joins your calls prepared, speaks up when you ask, and captures every decision and action item — then organizes it into spaces you can chat with. Not a silent notetaker.",
  openGraph: {
    title: "MeetBase — The active AI meeting agent",
    description:
      "An active AI meeting agent that joins prepared, speaks up when asked, and captures every decision and action item — not a silent notetaker.",
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
      <body className="antialiased font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
