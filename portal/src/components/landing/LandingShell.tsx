"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

type Ctx = { theme: Theme; toggle: () => void };
const LandingThemeContext = createContext<Ctx | null>(null);

export function LandingShell({
  initial,
  children,
}: {
  initial: Theme;
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return (
    <LandingThemeContext.Provider value={{ theme, toggle }}>
      {/* Outer element carries the `.dark` class; the inner wrapper carries
          `.steward-app`. Scoped tokens like `.dark .steward-app { ... }` in
          globals.css are a *descendant* selector, so the two classes must
          live on different elements — not the same one — or the dark-mode
          block never matches, even though both classes are technically
          "present". */}
      <div className={theme === "dark" ? "dark" : undefined}>
        <div className="steward-app min-h-screen bg-background text-foreground">{children}</div>
      </div>
    </LandingThemeContext.Provider>
  );
}

export function useLandingTheme(): Ctx {
  const ctx = useContext(LandingThemeContext);
  if (!ctx) throw new Error("useLandingTheme must be used within LandingShell");
  return ctx;
}
