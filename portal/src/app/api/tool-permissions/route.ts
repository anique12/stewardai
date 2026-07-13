import { NextRequest, NextResponse } from "next/server";
import { requireUserRoute } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";

// Lets a user view and revoke the "Always allow" tool permissions the chat
// approval flow (see PermissionCard's "Always allow" action) has persisted
// on their behalf. RLS policy `tool_permissions_own` (`user_id = auth.uid()`)
// scopes both the SELECT and DELETE below to the caller's own rows, so no
// explicit `.eq("user_id", user.id)` filter is required (or even harmful —
// it would just be redundant with the policy).
export async function GET() {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const db = createServerClient();
  const { data, error } = await db
    .from("tool_permissions")
    .select("id,tool_name,scope,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    // Don't fail the whole settings page over this — surface an empty list.
    console.error("[tool-permissions] list failed:", error.message);
    return NextResponse.json({ permissions: [] });
  }

  return NextResponse.json({ permissions: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  let id = req.nextUrl.searchParams.get("id");
  if (!id) {
    try {
      const body = (await req.json()) as { id?: string };
      id = body.id ?? null;
    } catch {
      // no JSON body — id stays null, handled below
    }
  }

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const db = createServerClient();
  const { error } = await db.from("tool_permissions").delete().eq("id", id);

  if (error) {
    console.error("[tool-permissions] delete failed:", error.message);
    return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
