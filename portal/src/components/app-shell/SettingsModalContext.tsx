"use client";

import { createContext, useContext } from "react";

export type SettingsModalContextValue = {
  /** Opens the settings modal over whatever page is currently mounted — no navigation. */
  openSettings: () => void;
  settingsOpen: boolean;
};

export const SettingsModalContext = createContext<SettingsModalContextValue | null>(null);

/** Provided by `AppChrome`; lets the sidebar nav, account menu, and mobile drawer trigger the settings modal without a route change. */
export function useSettingsModal(): SettingsModalContextValue {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) {
    throw new Error("useSettingsModal must be used within AppChrome's SettingsModalContext.Provider");
  }
  return ctx;
}
