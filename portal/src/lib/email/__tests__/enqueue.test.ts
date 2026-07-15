import { enqueueEmail } from "@/lib/email/enqueue";

function fakeService(error: unknown = null) {
  const calls: unknown[] = [];
  return {
    calls,
    from() {
      return { insert: async (row: unknown) => { calls.push(row); return { error }; } };
    },
  };
}

describe("enqueueEmail", () => {
  it("inserts a pending outbox row", async () => {
    const svc = fakeService();
    await enqueueEmail(svc as never, {
      userId: "u1", kind: "welcome", toEmail: "o@x.ai", dedupKey: "welcome:u1",
    });
    expect(svc.calls[0]).toMatchObject({ user_id: "u1", kind: "welcome", dedup_key: "welcome:u1" });
  });

  it("does not throw on duplicate key", async () => {
    const svc = fakeService({ code: "23505" });
    await expect(
      enqueueEmail(svc as never, { userId: "u1", kind: "welcome", toEmail: "o@x.ai", dedupKey: "welcome:u1" })
    ).resolves.toBeUndefined();
  });
});
