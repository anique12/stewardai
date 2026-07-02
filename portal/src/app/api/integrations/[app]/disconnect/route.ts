import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getComposio,
  SUPPORTED_TOOLKITS,
  type SupportedToolkit,
} from "@/lib/composio";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: { app: string } }
) {
  const { user, response } = await requireUserRoute();
  if (!user) {
    return response;
  }

  const app = params.app as SupportedToolkit;
  if (!SUPPORTED_TOOLKITS.includes(app)) {
    return NextResponse.json({ error: "Unknown app" }, { status: 400 });
  }

  const service = createServiceClient();
  // Enforce row ownership: only read this user's row.
  const { data: row } = await service
    .from("connected_apps")
    .select("connected_account_id")
    .eq("user_id", user.id)
    .eq("app", app)
    .single();

  // Delete the Composio connected account if we have its id.
  if (row?.connected_account_id) {
    try {
      const composio = getComposio();
      await composio.connectedAccounts.delete(row.connected_account_id);
    } catch (err) {
      // Best-effort: proceed even if Composio delete fails (e.g. already gone).
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[integrations] disconnect delete failed for ${app}:`, message);
    }
  }

  // Mark as disconnected in our table.
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
