import { isSafeNextPath } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = createServerClient();
  const { origin, searchParams } = new URL(request.url);

  // Optional post-auth destination (e.g. the onboarding wizard resuming at
  // `/welcome?connected=1`). Only same-origin relative paths are honored —
  // see isSafeNextPath — to prevent this becoming an open redirect.
  const next = searchParams.get("next");
  const redirectTo = isSafeNextPath(next)
    ? `${origin}/auth/callback?next=${encodeURIComponent(next)}`
    : `${origin}/auth/callback`;

  // Identity-only sign-in/sign-up: default Google OAuth scopes (no calendar
  // access requested here). Calendar access is a separate, explicit consent
  // step — see /auth/connect-calendar.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(`${origin}/?error=oauth_failed`);
  }
  return NextResponse.redirect(data.url);
}
