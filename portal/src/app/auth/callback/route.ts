import { extractRefreshToken } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

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

  // Persist refresh token if we got one
  const refreshToken = extractRefreshToken(data.session);
  if (refreshToken) {
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

  const hasCalendar = Boolean(refreshToken);
  return NextResponse.redirect(
    hasCalendar
      ? `${origin}/app`
      : `${origin}/app/settings?connect=calendar`
  );
}
