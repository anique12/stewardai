import type { Session, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export function extractRefreshToken(session: Session): string | null {
  // provider_refresh_token is present after OAuth but not in Supabase's Session type
  return (session as Session & { provider_refresh_token?: string }).provider_refresh_token ?? null;
}

/** Server-component guard. Returns the user, or redirects to the login surface. */
export async function requireUserPage(): Promise<User> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/?login=1");
  return user;
}

/** Route-handler guard. Returns { user } or { user: null, response } with a 401. */
export async function requireUserRoute(): Promise<
  { user: User; response?: undefined } | { user: null; response: NextResponse }
> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}
