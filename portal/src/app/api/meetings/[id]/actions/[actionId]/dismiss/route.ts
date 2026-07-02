import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string; actionId: string } }
) {
  const { user, response } = await requireUserRoute();
  if (!user) {
    return response;
  }

  const service = createServiceClient();

  // Verify the action belongs to the user
  const { data: action, error: fetchError } = await service
    .from("agent_actions")
    .select("id, state")
    .eq("id", params.actionId)
    .eq("meeting_id", params.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !action) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  const { error: updateError } = await service
    .from("agent_actions")
    .update({ state: "failed", error: "dismissed by user" })
    .eq("id", params.actionId)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to dismiss action" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
