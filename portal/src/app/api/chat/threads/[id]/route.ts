import { requireUserRoute } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { NextRequest, NextResponse } from "next/server";
import type { Activity, Citation, Message } from "@/lib/chat/types";

type StoredPart = {
  type?: string;
  text?: string;
  citations?: Citation[];
  activities?: Activity[];
  thinking?: string;
};

// Rebuild a display Message from a stored chat_messages row's `parts` jsonb.
// (Activity lines are ephemeral turn-progress and aren't persisted — restored
// history shows the answer + citations.)
function rowToMessage(row: { role: string; parts: unknown }): Message {
  const parts: StoredPart[] = Array.isArray(row.parts) ? (row.parts as StoredPart[]) : [];
  let text = "";
  let citations: Citation[] = [];
  let activities: Activity[] = [];
  let thinking = "";
  for (const p of parts) {
    if (p?.type === "text" && typeof p.text === "string") text += p.text;
    else if (p?.type === "citation_group" && Array.isArray(p.citations)) citations = p.citations;
    else if (p?.type === "activity_group" && Array.isArray(p.activities)) activities = p.activities;
    else if (p?.type === "thinking_block" && typeof p.thinking === "string") thinking = p.thinking;
  }
  return {
    role: row.role === "user" ? "user" : "assistant",
    text,
    activities,
    citations,
    thinking,
    done: true,
  };
}

// Load one thread's messages (in order) so the client can restore it on refresh.
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const service = createServiceClient();
  const { data } = await service
    .from("chat_messages")
    .select("role,parts,seq")
    .eq("thread_id", params.id)
    .eq("user_id", user.id)
    .order("seq", { ascending: true });

  const messages = (data ?? []).map((r) => rowToMessage(r as { role: string; parts: unknown }));
  return NextResponse.json({ messages });
}
