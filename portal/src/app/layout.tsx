import type { Metadata } from "next";
import localFont from "next/font/local";
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
  metadataBase: new URL("https://stewardai.com"),
  title: {
    default: "StewardAI — The personal AI agent platform",
    template: "%s — StewardAI",
  },
  description:
    "StewardAI is a personal AI agent and the voice stack to build your own — real-time voice agents, fast multilingual speech-to-text, and natural low-latency text-to-speech, on one platform.",
  openGraph: {
    title: "StewardAI — The personal AI agent platform",
    description:
      "A personal AI agent for you, and the voice infrastructure for developers: real-time voice agents, speech-to-text, and text-to-speech.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
