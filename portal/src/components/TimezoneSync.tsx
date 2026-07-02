"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { useEffect } from "react";

/**
 * Silently persists the user's timezone from the browser (the OS's exact IANA
 * zone, e.g. "Asia/Karachi") to profiles.timezone — no prompt, no field. Runs on
 * every app load so it stays current if the user travels. Best-effort: ignores
 * errors (e.g. the timezone column not migrated yet).
 */
export function TimezoneSync() {
  useEffect(() => {
    (async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!tz) return;
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("timezone")
          .eq("user_id", user.id)
          .single();
        if (profile && profile.timezone === tz) return; // already current
        await supabase.from("profiles").update({ timezone: tz }).eq("user_id", user.id);
      } catch {
        /* best-effort — never block the app on timezone sync */
      }
    })();
  }, []);
  return null;
}
