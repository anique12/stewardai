import type { Session } from "@supabase/supabase-js";

export function extractRefreshToken(session: Session): string | null {
  // provider_refresh_token is present after OAuth but not in Supabase's Session type
  return (session as Session & { provider_refresh_token?: string }).provider_refresh_token ?? null;
}
