import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getComposio,
  getSupportedToolkits,
  resolveManagedAuthConfigId,
  type SupportedToolkit,
} from "@/lib/composio";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { app: string } }
) {
  const { user, response } = await requireUserRoute();
  if (!user) {
    return response;
  }

  const app = params.app as SupportedToolkit;
  if (!(await getSupportedToolkits()).includes(app)) {
    return NextResponse.json({ error: "Unknown app" }, { status: 400 });
  }

  // Parse optional redirect URL from request body — Composio sends the user
  // back here after the OAuth flow completes.
  let redirectUri: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    redirectUri = body?.redirectUri;
  } catch {
    // ignore — redirectUri is optional
  }

  let redirectUrl: string | null = null;
  let connectedAccountId: string | null = null;
  try {
    const composio = getComposio();
    // Managed OAuth: reuse/create a Composio-managed auth config, then link the
    // user (entity = Supabase user.id) so we can pass the post-OAuth callback.
    const authConfigId = await resolveManagedAuthConfigId(composio, app);
    const connectionRequest = await composio.connectedAccounts.link(
      user.id,
      authConfigId,
      { callbackUrl: redirectUri, allowMultiple: true }
    );
    redirectUrl = connectionRequest.redirectUrl ?? null;
    connectedAccountId = connectionRequest.id ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[integrations] connect failed for ${app}:`, message);
    return NextResponse.json(
      { error: "Failed to initiate connection", detail: message },
      { status: 502 }
    );
  }

  // Upsert a pending row so the UI can show the right status immediately.
  const service = createServiceClient();
  await service.from("connected_apps").upsert(
    {
      user_id: user.id,
      app,
      status: "pending",
      connected_account_id: connectedAccountId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,app" }
  );

  return NextResponse.json({ redirectUrl, connectedAccountId });
}
