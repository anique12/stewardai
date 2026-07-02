export function landingCta(isAuthed: boolean): {
  href: string;
  primaryLabel: string;
  secondaryLabel: string | null;
} {
  if (isAuthed) {
    return { href: "/app", primaryLabel: "Go to app", secondaryLabel: null };
  }
  return { href: "/auth/login", primaryLabel: "Start free", secondaryLabel: "Sign in" };
}
