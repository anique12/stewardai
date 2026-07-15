import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Insert one pending email_outbox row. Best-effort: a duplicate dedup_key (23505)
 * or any error is swallowed so it never blocks the request path (login, connect).
 */
export async function enqueueEmail(
  service: SupabaseClient,
  row: { userId: string; kind: string; toEmail: string; dedupKey: string; payload?: Record<string, unknown> }
): Promise<void> {
  try {
    const { error } = await service.from("email_outbox").insert({
      user_id: row.userId,
      kind: row.kind,
      to_email: row.toEmail,
      dedup_key: row.dedupKey,
      payload: row.payload ?? {},
    });
    // 23505 = unique_violation → already enqueued; anything else we log-and-ignore.
    if (error && (error as { code?: string }).code !== "23505") {
      console.error("enqueueEmail failed", error);
    }
  } catch (e) {
    console.error("enqueueEmail threw", e);
  }
}
