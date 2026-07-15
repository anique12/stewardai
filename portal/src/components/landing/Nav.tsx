"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Container } from "./primitives";
import { cn } from "@/lib/utils";
import { landingCta } from "@/lib/landing-cta";

const LINKS = [
  { name: "Features", href: "#features" },
  { name: "How it works", href: "#how" },
  { name: "Speaks in meetings", href: "#speaks" },
  { name: "Privacy & trust", href: "/trust" },
];

export function LandingNav({ isAuthed = false }: { isAuthed?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
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
            {/* eslint-disable-next-line @next/next/no-img-element -- small local brand mark */}
            <img src="/meetbase-mark.png" alt="MeetBase" className="h-7 w-7 shrink-0" />
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Meet<span className="text-primary">Base</span>
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden items-center gap-1 lg:flex">
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
            <div className="grid gap-1">
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
