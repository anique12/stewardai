import { landingCta } from "@/lib/landing-cta";

describe("landingCta", () => {
  it("points logged-in users to the app", () => {
    expect(landingCta(true)).toEqual({
      href: "/app",
      primaryLabel: "Go to app",
      secondaryLabel: null,
      signInHref: "/auth/login",
    });
  });

  it("points logged-out users to our onboarding page, with a separate sign-in link", () => {
    expect(landingCta(false)).toEqual({
      href: "/welcome",
      primaryLabel: "Start free",
      secondaryLabel: "Sign in",
      signInHref: "/auth/login",
    });
  });
});
