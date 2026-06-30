import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
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
