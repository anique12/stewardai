import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Public onboarding wizard — hosts all three steps of account creation, in
 * OUR branded UI, as two separate consent grants:
 *   1. "Create your account" (unauthenticated) — identity-only sign-in via
 *      /auth/login, no calendar permission requested.
 *   2. "Connect your calendar" (authenticated, no calendar_connections row
 *      yet) — separate, explicit consent via /auth/connect-calendar.
 *   3. "Done" (authenticated + calendar connected, or ?connected=1 fresh
 *      off the calendar-connect round trip) — enter the app.
 * (MeetBase.design.html ~1834-1856 for the visual spec of steps 2 & 3.)
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: { connected?: string };
}) {
  const db = createServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  let hasCalendar = false;
  if (user) {
    const { data: conn } = await db
      .from("calendar_connections")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    hasCalendar = Boolean(conn);
  }

  const justConnected = searchParams.connected === "1";

  // Already fully onboarded (signed in + calendar connected) and not arriving
  // fresh off the connect flow → skip the wizard entirely and go to the app.
  // The "You're all set" screen is only a post-connect confirmation.
  if (user && hasCalendar && !justConnected) {
    redirect("/app");
  }

  const isDone = Boolean(user) && (justConnected || hasCalendar);

  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-paper text-ink lg:grid-cols-2">
      {/* BRAND PANE */}
      <div className="relative hidden flex-col overflow-hidden bg-brand p-12 text-on-brand lg:flex">
        <div className="inline-flex items-center gap-[9px]">
          <div className="flex h-[29px] w-[29px] items-center justify-center rounded-md bg-on-brand/[.16]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" fill="currentColor" />
              <path
                d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="font-display text-lg font-bold">
            Meet<span className="opacity-70">Base</span>
          </span>
        </div>
        <div className="flex max-w-[420px] flex-1 flex-col justify-center">
          <div className="mb-[18px] font-mono text-[11px] uppercase tracking-[.14em] opacity-70">
            Your always-on agent
          </div>
          <p className="mb-[26px] font-display text-[28px] font-bold leading-[1.25] tracking-[-.02em]">
            &ldquo;It joins the call, remembers every commitment, and nudges me before anything
            slips. I stopped taking notes months ago.&rdquo;
          </p>
          <div className="flex items-center gap-3">
            <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-on-brand/[.18] text-[15px] font-bold">
              DW
            </span>
            <div>
              <div className="text-sm font-semibold">Dana Whitfield</div>
              <div className="text-xs opacity-75">VP Operations, Northwind</div>
            </div>
          </div>
        </div>
        <div className="flex gap-[22px] text-xs opacity-80">
          <span>Encrypted at rest</span>
          <span>·</span>
          <span>Read-only calendar</span>
          <span>·</span>
          <span>Revoke anytime</span>
        </div>
      </div>

      {/* FORM PANE */}
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-[400px] rounded-lg border border-line bg-surface p-8 shadow-sh-1">
          {!user ? <CreateAccountStep /> : isDone ? <DoneStep /> : <ConnectCalendarStep />}
        </div>
      </div>
    </div>
  );
}

function CreateAccountStep() {
  return (
    <div>
      <div className="mb-[18px] flex items-center gap-[10px]">
        <span className="font-mono text-[11px] font-semibold text-brand">STEP 1 OF 2</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[13px] border border-line bg-surface-2">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" fill="currentColor" className="text-brand" />
          <path
            d="M6.5 6.5a7.8 7.8 0 000 11M17.5 6.5a7.8 7.8 0 010 11"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            className="text-brand"
          />
        </svg>
      </div>
      <h1 className="mb-[6px] font-display text-[22px] font-bold tracking-[-.01em]">
        Create your account
      </h1>
      <p className="mb-5 text-[13.5px] leading-[1.55] text-ink-2">
        We just need your basic profile to get started. Calendar access is a separate step,
        later — nothing is requested here beyond your identity.
      </p>
      <div className="mb-5 flex flex-col gap-[11px] rounded-xl border border-line bg-surface-2 p-[14px]">
        <Reassurance>
          <strong className="text-ink">Identity only.</strong> This step does not request
          calendar or any other data access.
        </Reassurance>
        <Reassurance>
          <strong className="text-ink">No spam.</strong> We use this only to sign you in to
          MeetBase.
        </Reassurance>
      </div>
      <Button asChild className="w-full gap-2">
        <Link href={`/auth/login?next=${encodeURIComponent("/welcome")}`}>
          <GoogleGlyph />
          Continue with Google
        </Link>
      </Button>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21.6 12.23c0-.68-.06-1.36-.18-2H12v3.99h5.4a4.62 4.62 0 01-2 3.03v2.5h3.23c1.9-1.74 2.97-4.32 2.97-7.52z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.97-.89 6.63-2.42l-3.23-2.5c-.9.6-2.05.95-3.4.95-2.6 0-4.8-1.76-5.6-4.12H3.06v2.58A10 10 0 0012 22z"
        fill="#34A853"
      />
      <path
        d="M6.4 13.91a5.99 5.99 0 010-3.82V7.51H3.06a10 10 0 000 8.98l3.34-2.58z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.58c1.47 0 2.79.5 3.82 1.5l2.87-2.87C16.96 3.61 14.7 2.7 12 2.7A10 10 0 003.06 7.51l3.34 2.58c.8-2.36 3-4.13 5.6-4.13z"
        fill="#EA4335"
      />
    </svg>
  );
}

function ConnectCalendarStep() {
  return (
    <div>
      <div className="mb-[18px] flex items-center gap-[10px]">
        <span className="font-mono text-[11px] font-semibold text-brand">STEP 2 OF 2</span>
        <span className="h-px flex-1 bg-line" />
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-weak text-brand">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12l4.5 4.5L19 7"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[13px] border border-line bg-surface-2">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" stroke="#4285F4" strokeWidth="1.7" />
          <path
            d="M3.5 9.5h17M8 3v3.5M16 3v3.5"
            stroke="#4285F4"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <rect x="6.5" y="12" width="4" height="4" rx="1" fill="#34A853" />
        </svg>
      </div>
      <h1 className="mb-[6px] font-display text-[22px] font-bold tracking-[-.01em]">
        Connect your calendar
      </h1>
      <p className="mb-5 text-[13.5px] leading-[1.55] text-ink-2">
        This is how MeetBase knows when to show up — it reads your schedule to time its joins.
      </p>
      <div className="mb-5 flex flex-col gap-[11px] rounded-xl border border-line bg-surface-2 p-[14px]">
        <Reassurance>
          <strong className="text-ink">Read-only to start.</strong> MeetBase only reads your
          schedule — it won&apos;t create, move or delete events unless you choose to let it.
        </Reassurance>
        <Reassurance>
          <strong className="text-ink">Encrypted &amp; revocable.</strong> Disconnect in Settings
          at any time.
        </Reassurance>
      </div>
      <Button asChild className="w-full">
        <Link href={`/auth/connect-calendar?next=${encodeURIComponent("/welcome?connected=1")}`}>
          Connect Google Calendar
        </Link>
      </Button>
      <Button asChild variant="link" className="mt-1 w-full text-ink-3">
        <Link href="/app">I&rsquo;ll do this later</Link>
      </Button>
    </div>
  );
}

function DoneStep() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-[18px] flex h-14 w-14 items-center justify-center rounded-full bg-brand-weak text-brand">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12l4.5 4.5L19 7"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="mb-2 font-display text-[23px] font-bold tracking-[-.01em]">
        You&rsquo;re all set
      </h1>
      <p className="mb-[22px] text-[13.5px] leading-[1.55] text-ink-2">
        Calendar connected. MeetBase will start joining your meetings and rolling up what was
        said — pick which ones from your Meetings home.
      </p>
      <Button asChild className="w-full gap-2">
        <Link href="/app">
          Enter MeetBase
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </Button>
    </div>
  );
}

function Reassurance({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-[9px]">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        className="mt-[1px] shrink-0 text-brand"
      >
        <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.7" />
      </svg>
      <span className="text-[12.5px] leading-[1.45] text-ink-2">{children}</span>
    </div>
  );
}
