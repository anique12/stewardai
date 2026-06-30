import Link from "next/link";
import { Bot, GitBranch, AtSign, Mail } from "lucide-react";
import { Container } from "./primitives";

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Products",
    links: [
      { label: "Steward", href: "#steward" },
      { label: "Voice Agents", href: "#voice-agents" },
      { label: "Speech-to-Text", href: "#developers" },
      { label: "Text-to-Speech", href: "#developers" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Docs", href: "#developers" },
      { label: "API reference", href: "#developers" },
      { label: "Status", href: "#" },
      { label: "Changelog", href: "#" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
      { label: "Security", href: "#" },
    ],
  },
];

const SOCIAL = [
  { label: "GitHub", href: "#", icon: GitBranch },
  { label: "X", href: "#", icon: AtSign },
  { label: "Email us", href: "#", icon: Mail },
];

export function LandingFooter() {
  return (
    <footer id="footer" className="border-t border-border bg-card/30">
      <Container className="py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <Bot className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-foreground">StewardAI</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              The personal AI agent platform — and the real-time voice stack to build your own.
            </p>
            <div className="mt-5 flex gap-2">
              {SOCIAL.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  <s.icon className="h-4 w-4" aria-hidden />
                </a>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} StewardAI. All rights reserved.</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            All systems operational
          </span>
        </div>
      </Container>
    </footer>
  );
}
