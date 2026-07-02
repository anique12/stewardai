import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; actionId: string } }
) {
  const { user, response } = await requireUserRoute();
  if (!user) {
    return response;
  }

  const service = createServiceClient();

  // Verify the action belongs to the user and is in 'proposed' state
  const { data: action, error: fetchError } = await service
    .from("agent_actions")
    .select("id, state, args")
    .eq("id", params.actionId)
    .eq("meeting_id", params.id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !action) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  if (action.state !== "proposed") {
    return NextResponse.json(
      { error: "Action is not in proposed state" },
      { status: 409 }
    );
  }

  // Optionally accept edited args from request body
  let updatedArgs = action.args;
  try {
    const body = await request.json();
    if (body && typeof body.args === "object") {
      updatedArgs = body.args;
    }
  } catch {
    // No body or invalid JSON — use existing args
  }

  const { error: updateError } = await service
    .from("agent_actions")
    .update({ state: "approved", args: updatedArgs })
    .eq("id", params.actionId)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to approve action" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
