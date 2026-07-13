import type { Session } from "@supabase/supabase-js";
import { extractRefreshToken, isSafeNextPath } from "@/lib/auth-helpers";

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

describe("isSafeNextPath", () => {
  describe("accepts valid same-origin relative paths", () => {
    it("accepts /app", () => {
      expect(isSafeNextPath("/app")).toBe(true);
    });

    it("accepts /welcome?connected=1", () => {
      expect(isSafeNextPath("/welcome?connected=1")).toBe(true);
    });

    it("accepts / (root)", () => {
      expect(isSafeNextPath("/")).toBe(true);
    });

    it("accepts /path/to/page", () => {
      expect(isSafeNextPath("/path/to/page")).toBe(true);
    });

    it("accepts /path#hash", () => {
      expect(isSafeNextPath("/path#hash")).toBe(true);
    });
  });

  describe("rejects unsafe URLs", () => {
    it("rejects null", () => {
      expect(isSafeNextPath(null)).toBe(false);
    });

    it("rejects undefined", () => {
      expect(isSafeNextPath(undefined)).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isSafeNextPath("")).toBe(false);
    });

    it("rejects //evil.com (protocol-relative)", () => {
      expect(isSafeNextPath("//evil.com")).toBe(false);
    });

    it("rejects https://evil.com (absolute URL)", () => {
      expect(isSafeNextPath("https://evil.com")).toBe(false);
    });

    it("rejects http://evil.com (absolute URL)", () => {
      expect(isSafeNextPath("http://evil.com")).toBe(false);
    });

    it("rejects /\\evil.com (backslash trick)", () => {
      expect(isSafeNextPath("/\\evil.com")).toBe(false);
    });

    it("rejects \\\\evil.com (double backslash)", () => {
      expect(isSafeNextPath("\\\\evil.com")).toBe(false);
    });

    it("rejects \\evil.com (leading backslash)", () => {
      expect(isSafeNextPath("\\evil.com")).toBe(false);
    });

    it("rejects /path\\with\\backslash", () => {
      expect(isSafeNextPath("/path\\with\\backslash")).toBe(false);
    });

    it("rejects strings not starting with /", () => {
      expect(isSafeNextPath("app")).toBe(false);
    });
  });
});
