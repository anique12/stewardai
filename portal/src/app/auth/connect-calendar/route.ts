import { isSafeNextPath } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Separate, explicit consent step for Google Calendar access. Distinct from
 * /auth/login (identity-only sign-in): this route requests the calendar
 * scope and always tags the callback URL with `calendar=1` so
 * /auth/callback knows a calendar grant was actually requested and may
 * persist a calendar_connections row. Without that flag, a plain identity
 * sign-in that happens to return a provider refresh token (but no calendar
 * scope) could be mistaken for a calendar connection.
 */
export async function GET(request: Request) {
  const supabase = createServerClient();
  const { origin, searchParams } = new URL(request.url);

  // Optional post-auth destination. Only same-origin relative paths are
  // honored — see isSafeNextPath — to prevent this becoming an open redirect.
  const next = searchParams.get("next");
  const safeNext = isSafeNextPath(next) ? next : "/welcome?connected=1";

  const redirectTo = `${origin}/auth/callback?calendar=1&next=${encodeURIComponent(safeNext)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: "https://www.googleapis.com/auth/calendar.readonly",
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(`${origin}/?error=oauth_failed`);
  }
  return NextResponse.redirect(data.url);
}
