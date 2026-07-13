import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Use getSession (reads/validates the token from cookies LOCALLY — it only
  // hits the network when the token is actually expired, ~hourly) instead of
  // getUser (a network round-trip to the auth server on EVERY navigation, which
  // blocked the response before the route/skeleton could render — the "2-3s of
  // nothing on click" stall). This is only a UX redirect gate; real
  // authorization is enforced by Postgres RLS + each page's own auth check, so
  // the local session read is the correct trade here.
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("login", "1");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  // Only guard the authenticated app. Landing, legal, /welcome (public
  // onboarding), auth + API routes, and static assets skip middleware
  // entirely — navigating anywhere outside /app now pays zero auth cost.
  matcher: ["/app/:path*"],
};
