import { signDemoToken, verifyDemoToken } from "@/lib/demo-token";

const SECRET = "a".repeat(64); // 32-byte hex string mock

describe("demo token", () => {
  it("signs and verifies a token successfully", async () => {
    const token = await signDemoToken(SECRET);
    expect(typeof token).toBe("string");
    const payload = await verifyDemoToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.purpose).toBe("demo");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signDemoToken(SECRET);
    const payload = await verifyDemoToken(token, "b".repeat(64));
    expect(payload).toBeNull();
  });
});
