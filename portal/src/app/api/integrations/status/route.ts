import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Composio } from "composio-core";
import { NextResponse } from "next/server";

const APPS = ["gmail", "googlecalendar", "notion", "slack"] as const;

export async function GET() {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all Composio connections for this entity (user)
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const entity = composio.getEntity(user.id);

  let composioConnections: Awaited<ReturnType<typeof entity.getConnections>> =
    [];
  try {
    composioConnections = await entity.getConnections();
  } catch {
    // If the entity has no connections yet Composio may throw — treat as empty
  }

  const service = createServiceClient();

  // Build a lookup: appName (lowercase) → composio connection
  // ConnectionItem uses `id` (not `connectedAccountId`) and `status` as a plain string
  const byApp = new Map<
    string,
    { id: string; status: string; appName: string }
  >();
  for (const conn of composioConnections) {
    const appKey = (conn.appName ?? "").toLowerCase();
    // Only track the most-recent active connection per app
    if (!byApp.has(appKey) || conn.status === "ACTIVE") {
      byApp.set(appKey, {
        id: conn.id,
        status: conn.status,
        appName: appKey,
      });
    }
  }

  // Upsert our local table to match Composio's truth
  const now = new Date().toISOString();
  const upserts = APPS.map((app) => {
    const composioConn = byApp.get(app);
    return {
      user_id: user.id,
      app,
      status: composioConn
        ? composioConn.status === "ACTIVE"
          ? "connected"
          : composioConn.status === "INITIATED"
          ? "pending"
          : "error"
        : "disconnected",
      connected_account_id: composioConn?.id ?? null,
      connected_at:
        composioConn?.status === "ACTIVE" ? now : null,
      updated_at: now,
    };
  });

  await service
    .from("connected_apps")
    .upsert(upserts, { onConflict: "user_id,app" });

  // Return the current state from our table (includes apps with no Composio conn)
  const { data: rows } = await service
    .from("connected_apps")
    .select("app,status,connected_account_id,connected_at,updated_at")
    .eq("user_id", user.id);

  return NextResponse.json({ apps: rows ?? [] });
}
