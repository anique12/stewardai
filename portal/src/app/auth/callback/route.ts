import { extractRefreshToken, isSafeNextPath } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  const supabase = createServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session || !data.user) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  const service = createServiceClient();

  // Upsert profile
  await service.from("profiles").upsert(
    { user_id: data.user.id, display_name: data.user.user_metadata?.full_name ?? null },
    { onConflict: "user_id" }
  );

  // Only persist a calendar connection when this OAuth round-trip was
  // explicitly requesting calendar access (see /auth/connect-calendar,
  // which tags its callback URL with `calendar=1`). A plain identity
  // sign-in via /auth/login can still return a provider_refresh_token from
  // Google without the calendar scope ever having been granted — storing
  // that token here would falsely mark the account as "connected" and
  // later break calendar sync (no calendar scope actually authorized).
  const calendarRequested = searchParams.get("calendar") === "1";
  const refreshToken = extractRefreshToken(data.session);
  const calendarConnected = calendarRequested && Boolean(refreshToken);
  if (calendarConnected) {
    await service.from("calendar_connections").upsert(
      {
        user_id: data.user.id,
        google_refresh_token: refreshToken,
        scopes: ["calendar.readonly"],
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  }

  // A caller-supplied destination (e.g. the onboarding wizard resuming at
  // `/welcome?connected=1` after the user connects their calendar) wins over
  // the default routing below. Only same-origin relative paths are honored.
  if (isSafeNextPath(next)) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // No explicit `next`: send users with a calendar connection straight into
  // the app; everyone else (new identity-only sign-ups, or existing users
  // who still haven't connected a calendar) continues the onboarding wizard.
  let hasCalendar = calendarConnected;
  if (!hasCalendar) {
    const { data: existingConn } = await service
      .from("calendar_connections")
      .select("id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    hasCalendar = Boolean(existingConn);
  }

  return NextResponse.redirect(hasCalendar ? `${origin}/app` : `${origin}/welcome`);
}
