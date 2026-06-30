import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Composio } from "composio-core";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_APPS = ["gmail", "googlecalendar", "notion", "slack"] as const;
type AllowedApp = (typeof ALLOWED_APPS)[number];

export async function POST(
  _request: NextRequest,
  { params }: { params: { app: string } }
) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const app = params.app as AllowedApp;
  if (!ALLOWED_APPS.includes(app)) {
    return NextResponse.json({ error: "Unknown app" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: row } = await service
    .from("connected_apps")
    .select("connected_account_id")
    .eq("user_id", user.id)
    .eq("app", app)
    .single();

  // Delete the Composio connected account if we have its ID
  if (row?.connected_account_id) {
    try {
      const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
      await composio.connectedAccounts.delete({
        connectedAccountId: row.connected_account_id,
      });
    } catch {
      // Best-effort: proceed even if Composio delete fails (e.g. already deleted)
    }
  }

  // Mark as disconnected in our table
  await service.from("connected_apps").upsert(
    {
      user_id: user.id,
      app,
      status: "disconnected",
      connected_account_id: null,
      connected_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,app" }
  );

  return NextResponse.json({ success: true });
}
