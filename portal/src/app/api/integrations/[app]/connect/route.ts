import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { Composio } from "composio-core";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_APPS = ["gmail", "googlecalendar", "notion", "slack"] as const;
type AllowedApp = (typeof ALLOWED_APPS)[number];

export async function POST(
  request: NextRequest,
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

  // Parse optional redirect URL from request body
  let redirectUri: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    redirectUri = body.redirectUri;
  } catch {
    // ignore
  }

  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const entity = composio.getEntity(user.id);

  const connectionRequest = await entity.initiateConnection({
    appName: app,
    redirectUri,
  });

  // Upsert a pending row so the UI can show the right status immediately
  const service = createServiceClient();
  await service.from("connected_apps").upsert(
    {
      user_id: user.id,
      app,
      status: "pending",
      connected_account_id: connectionRequest.connectedAccountId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,app" }
  );

  return NextResponse.json({
    redirectUrl: connectionRequest.redirectUrl,
    connectedAccountId: connectionRequest.connectedAccountId,
  });
}
