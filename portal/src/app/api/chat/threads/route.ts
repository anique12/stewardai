import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";

// List the signed-in user's chat threads (most recent first) for the sidebar.
export async function GET() {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const service = createServiceClient();
  const { data } = await service
    .from("chat_threads")
    .select("id,title,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ threads: data ?? [] });
}
