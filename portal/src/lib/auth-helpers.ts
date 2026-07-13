import type { Session, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export function extractRefreshToken(session: Session): string | null {
  // provider_refresh_token is present after OAuth but not in Supabase's Session type
  return (session as Session & { provider_refresh_token?: string }).provider_refresh_token ?? null;
}

/**
 * Guards against open-redirect: only same-origin relative paths are safe to
 * bounce a user to after auth. Rejects absolute URLs (`https://evil.com`),
 * protocol-relative paths (`//evil.com`), and backslash tricks (`/\evil.com`).
 * Browsers normalize backslashes to forward slashes, so we must reject them
 * to prevent bypassing the `//` check.
 */
export function isSafeNextPath(value: string | null | undefined): value is string {
  if (!value) return false;
  // Reject any string containing backslashes (including `/\` and `\` prefixes)
  if (value.includes("\\")) return false;
  // Must start with exactly one `/`, not `//` (protocol-relative) or other schemes
  return value.startsWith("/") && !value.startsWith("//");
}

/** Server-component guard. Returns the user, or redirects to the login surface. */
export async function requireUserPage(): Promise<User> {
  const supabase = createServerClient();
  // getSession reads the token from cookies LOCALLY (network only when the
  // token is expired) — much faster per navigation than getUser's always-on
  // auth round-trip. Safe for page reads: every query is RLS-scoped by the
  // verified JWT, so a user id used only as a filter can't widen access.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) redirect("/?login=1");
  return session.user;
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
