import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StewardAI — Your AI meeting agent",
  description: "Connect your Google Calendar. Toggle a meeting. StewardAI joins, listens, and delivers a full transcript, summary, and action items.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
