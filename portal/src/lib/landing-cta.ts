export function landingCta(isAuthed: boolean): {
  href: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  signInHref: string;
} {
  if (isAuthed) {
    return { href: "/app", primaryLabel: "Go to app", secondaryLabel: null, signInHref: "/auth/login" };
  }
  // "Start free" now lands on our own branded onboarding page (/welcome),
  // which owns account creation as its own step — it no longer jumps
  // straight into the Google OAuth redirect.
  return {
    href: "/welcome",
    primaryLabel: "Start free",
    secondaryLabel: "Sign in",
    signInHref: "/auth/login",
  };
}
