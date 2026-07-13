import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

// List the signed-in user's chat threads (most recent first) for the sidebar.
export async function GET() {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const service = createServiceClient();
  // `spaces(name)` is a nested select over the chat_threads.space_id FK — lets
  // the sidebar show a scope chip per thread without a second round trip.
  const { data } = await service
    .from("chat_threads")
    .select("id,title,updated_at,space_id,spaces(name)")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ threads: data ?? [] });
}
