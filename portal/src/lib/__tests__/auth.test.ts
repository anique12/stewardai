import type { Session } from "@supabase/supabase-js";
import { extractRefreshToken } from "@/lib/auth-helpers";

describe("extractRefreshToken", () => {
  it("returns the token when present in provider_token", () => {
    const session = {
      provider_token: "access",
      provider_refresh_token: "refresh-abc",
    } as unknown as Session;
    expect(extractRefreshToken(session)).toBe("refresh-abc");
  });

  it("returns null when provider_refresh_token is absent", () => {
    const session = { provider_token: "access" } as unknown as Session;
    expect(extractRefreshToken(session)).toBeNull();
  });
});
