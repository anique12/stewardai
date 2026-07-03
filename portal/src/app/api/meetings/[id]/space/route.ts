import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { deriveHints, type HintEntity } from "@/lib/spaces/hints";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  let spaceId: string | null = null;
  try {
    const body = await request.json();
    spaceId = typeof body?.space_id === "string" ? body.space_id : null;
  } catch {
    // fall through → 400 below
  }
  if (!spaceId) return NextResponse.json({ error: "space_id required" }, { status: 400 });

  const service = createServiceClient();

  // Ownership: the meeting AND the target space must belong to the user.
  const [{ data: meeting }, { data: space }] = await Promise.all([
    service.from("meetings").select("id").eq("id", params.id).eq("user_id", user.id).single(),
    service.from("spaces").select("id").eq("id", spaceId).eq("user_id", user.id).single(),
  ]);
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });

  // 1) File the meeting (manual → confident, correctable).
  const { error: updErr } = await service
    .from("meetings")
    .update({ space_id: spaceId, space_source: "manual", space_confidence: 1.0 })
    .eq("id", params.id).eq("user_id", user.id);
  if (updErr) return NextResponse.json({ error: "Failed to file meeting" }, { status: 500 });

  // 2) Re-parent this meeting's facts to the new space (correction moves provenance).
  await service.from("space_facts").update({ space_id: spaceId })
    .eq("meeting_id", params.id).eq("user_id", user.id);

  // 3) Teach the filing loop from the meeting's linked entities (best-effort).
  const { data: entLinks } = await service
    .from("meeting_entities").select("entities(kind,email,domain)")
    .eq("meeting_id", params.id).eq("user_id", user.id);
  const entities = (entLinks ?? [])
    .map((row) => (row as unknown as { entities: HintEntity | null }).entities)
    .filter((e): e is HintEntity => !!e);
  const hints = deriveHints(entities, spaceId, user.id);
  if (hints.length > 0) {
    await service.from("filing_hints").upsert(hints, { onConflict: "user_id,kind,value,space_id" });
  }

  return NextResponse.json({ success: true });
}
