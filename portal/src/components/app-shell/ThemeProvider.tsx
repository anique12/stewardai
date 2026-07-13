"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

type Ctx = { theme: Theme; toggle: () => void };
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({
  initial,
  children,
  className,
}: {
  initial: Theme;
  children: React.ReactNode;
  /** Extra classes (e.g. `.steward-app` scope + font variables) applied to the reactive theme wrapper. */
  className?: string;
}) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
    try { localStorage.setItem(THEME_COOKIE, theme); } catch {}
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {/* Outer element carries the `.dark` class; the inner wrapper carries
          `.steward-app` (+ font variables). Scoped tokens like `.dark
          .steward-app { ... }` in globals.css are a *descendant* selector,
          so the two classes must live on different elements — not the same
          one — or the dark-mode block never matches, even though both
          classes are technically "present". Both class lists are derived
          from the same reactive `theme` state, so toggling stays live. */}
      <div data-theme={theme} className={theme === "dark" ? "dark h-screen" : "h-screen"}>
        <div
          className={`flex h-full flex-col bg-background text-foreground lg:flex-row${className ? ` ${className}` : ""}`}
        >
          {children}
        </div>
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
