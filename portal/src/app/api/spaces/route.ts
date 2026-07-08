import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";

const KINDS = new Set(["client", "project", "topic"]);

export async function POST(request: NextRequest) {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  let name = "";
  let kind: string | null = null;
  try {
    const body = await request.json();
    name = typeof body?.name === "string" ? body.name.trim() : "";
    kind = typeof body?.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  } catch {
    // fall through → 400
  }
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from("spaces")
    .insert({ user_id: user.id, name, kind })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "Failed to create space" }, { status: 500 });

  return NextResponse.json({ success: true, id: data.id });
}
