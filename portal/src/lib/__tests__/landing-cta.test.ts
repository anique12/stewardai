import { landingCta } from "@/lib/landing-cta";

describe("landingCta", () => {
  it("points logged-in users to the app", () => {
    expect(landingCta(true)).toEqual({
      href: "/app",
      primaryLabel: "Go to app",
      secondaryLabel: null,
    });
  });

  it("points logged-out users to sign in", () => {
    expect(landingCta(false)).toEqual({
      href: "/auth/login",
      primaryLabel: "Start free",
      secondaryLabel: "Sign in",
    });
  });
});
