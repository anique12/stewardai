"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  AudioLines,
  FileText,
  Speech,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";
import { Container } from "./primitives";
import { cn } from "@/lib/utils";
import { landingCta } from "@/lib/landing-cta";

const PRODUCTS = [
  {
    name: "Steward",
    href: "#steward",
    icon: Bot,
    blurb: "Your always-on personal AI agent.",
  },
  {
    name: "Voice Agents",
    href: "#voice-agents",
    icon: AudioLines,
    blurb: "Real-time conversational agents.",
  },
  {
    name: "Speech-to-Text",
    href: "#developers",
    icon: FileText,
    blurb: "Fast, multilingual transcription API.",
  },
  {
    name: "Text-to-Speech",
    href: "#developers",
    icon: Speech,
    blurb: "Natural, low-latency voices API.",
  },
];

const LINKS = [
  { name: "Solutions", href: "#use-cases" },
  { name: "Pricing", href: "#pricing" },
  { name: "Docs", href: "#developers" },
  { name: "Company", href: "#footer" },
];

export function LandingNav({ isAuthed = false }: { isAuthed?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const cta = landingCta(isAuthed);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled
          ? "border-border bg-background/80 backdrop-blur-xl"
          : "border-transparent bg-background/0",
      )}
    >
      <Container>
        <nav className="flex h-16 items-center justify-between gap-6" aria-label="Primary">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Bot className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              StewardAI
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden items-center gap-1 lg:flex">
            <div
              className="relative"
              onMouseEnter={() => setProductsOpen(true)}
              onMouseLeave={() => setProductsOpen(false)}
            >
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={productsOpen}
                onClick={() => setProductsOpen((v) => !v)}
              >
                Products
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", productsOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
              {productsOpen ? (
                <div className="absolute left-0 top-full w-[26rem] pt-2">
                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-popover p-2 shadow-2xl shadow-black/40">
                    {PRODUCTS.map((p) => (
                      <a
                        key={p.name}
                        href={p.href}
                        className="group flex gap-3 rounded-lg p-3 transition-colors hover:bg-secondary"
                      >
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                          <p.icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span>
                          <span className="block text-sm font-medium text-foreground">{p.name}</span>
                          <span className="block text-xs leading-snug text-muted-foreground">{p.blurb}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {LINKS.map((l) => (
              <a
                key={l.name}
                href={l.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {l.name}
              </a>
            ))}
          </div>

          {/* Desktop CTAs */}
          <div className="hidden items-center gap-2 lg:flex">
            {cta.secondaryLabel ? (
              <Link
                href="/auth/login"
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {cta.secondaryLabel}
              </Link>
            ) : null}
            <Link
              href={cta.href}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              {cta.primaryLabel}
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            type="button"
            className="lg:hidden rounded-md p-2 text-foreground"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>
      </Container>

      {/* Mobile panel */}
      {mobileOpen ? (
        <div className="border-t border-border bg-background lg:hidden">
          <Container className="py-4">
            <p className="px-1 pb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Products
            </p>
            <div className="grid gap-1">
              {PRODUCTS.map((p) => (
                <a
                  key={p.name}
                  href={p.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-secondary"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
                    <p.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="text-sm font-medium text-foreground">{p.name}</span>
                </a>
              ))}
            </div>
            <div className="mt-3 grid gap-1 border-t border-border pt-3">
              {LINKS.map((l) => (
                <a
                  key={l.name}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg p-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  {l.name}
                </a>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {cta.secondaryLabel ? (
                <Link
                  href="/auth/login"
                  className="rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium text-foreground"
                >
                  {cta.secondaryLabel}
                </Link>
              ) : null}
              <Link
                href={cta.href}
                className="rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground"
              >
                {cta.primaryLabel}
              </Link>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
