import { requireUserRoute } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getComposio, SUPPORTED_TOOLKITS } from "@/lib/composio";
import { NextResponse } from "next/server";

// Maps a Composio connected-account status to our local `connected_apps.status`
// check-constraint values (connected | pending | error | disconnected).
function localStatus(composioStatus: string | undefined): string {
  switch (composioStatus) {
    case "ACTIVE":
      return "connected";
    case "INITIALIZING":
    case "INITIATED":
      return "pending";
    case "FAILED":
    case "EXPIRED":
    case "INACTIVE":
    case "REVOKED":
      return "error";
    default:
      return "disconnected";
  }
}

// Best-effort human label for a connected account (email/username), or null.
function accountLabel(account: Record<string, unknown>): string | null {
  const data = (account.data ?? account.params ?? {}) as Record<string, unknown>;
  const candidates = [
    (data as { email?: unknown }).email,
    (data as { username?: unknown }).username,
    (data as { login?: unknown }).login,
    (account as { email?: unknown }).email,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export async function GET() {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const db = createServerClient();     // RLS-scoped reads
  const service = createServiceClient(); // elevated: reconcile upsert

  // Fetch all Composio connected accounts for this entity (user). The list
  // items carry `id`, `status`, and `toolkit.slug` (no userId echo — we filter
  // by userIds on input, so every item belongs to this user).
  const byApp = new Map<string, { id: string; status: string; label: string | null }>();
  try {
    const composio = getComposio();
    const response = await composio.connectedAccounts.list({
      userIds: [user.id],
      toolkitSlugs: [...SUPPORTED_TOOLKITS],
    });
    for (const account of response.items) {
      const slug = (account.toolkit?.slug ?? "").toLowerCase();
      if (!slug) continue;
      // Prefer the ACTIVE account if multiple exist for the same toolkit.
      const current = byApp.get(slug);
      if (!current || account.status === "ACTIVE") {
        byApp.set(slug, {
          id: account.id,
          status: account.status,
          label: accountLabel(account as unknown as Record<string, unknown>),
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[integrations] status list failed:", message);
    // Fall through: return whatever our local table already has rather than 500.
    const { data: existing } = await db
      .from("connected_apps")
      .select("app,status,connected_account_id,connected_at,updated_at")
      .eq("user_id", user.id);
    return NextResponse.json({
      apps: (existing ?? []).map((r) => ({ ...r, account_label: null })),
    });
  }

  // Reconcile our local table to match Composio's truth for the 4 apps.
  const now = new Date().toISOString();
  const upserts = SUPPORTED_TOOLKITS.map((app) => {
    const conn = byApp.get(app);
    const status = conn ? localStatus(conn.status) : "disconnected";
    return {
      user_id: user.id,
      app,
      status,
      connected_account_id: conn?.id ?? null,
      connected_at: status === "connected" ? now : null,
      updated_at: now,
    };
  });

  await service
    .from("connected_apps")
    .upsert(upserts, { onConflict: "user_id,app" });

  // Return current state from our table (only this user's rows).
  const { data: rows } = await db
    .from("connected_apps")
    .select("app,status,connected_account_id,connected_at,updated_at")
    .eq("user_id", user.id);

  const withLabels = (rows ?? []).map((r) => ({
    ...r,
    account_label: byApp.get(r.app)?.label ?? null,
  }));
  return NextResponse.json({ apps: withLabels });
}
