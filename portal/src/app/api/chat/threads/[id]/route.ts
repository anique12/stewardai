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
  thinking_seconds?: number | null;
  pending?: "permission" | "connect";
  data?: Record<string, unknown>;
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
  let thinkingSeconds: number | null = null;
  let pending: "permission" | "connect" | undefined;
  let permission: Record<string, unknown> | undefined;
  let connect: Record<string, unknown> | undefined;
  for (const p of parts) {
    if (p?.type === "text" && typeof p.text === "string") text += p.text;
    else if (p?.type === "citation_group" && Array.isArray(p.citations)) citations = p.citations;
    else if (p?.type === "activity_group" && Array.isArray(p.activities)) activities = p.activities;
    else if (p?.type === "thinking_block" && typeof p.thinking === "string") {
      thinking = p.thinking;
      if (typeof p.thinking_seconds === "number") thinkingSeconds = p.thinking_seconds;
    } else if (p?.type === "pending" && (p.pending === "permission" || p.pending === "connect")) {
      // A turn paused on a permission/connect interrupt — restore its card so a
      // refresh doesn't drop it (the server keeps the session alive to resume).
      pending = p.pending;
      if (p.pending === "permission") permission = p.data ?? {};
      else connect = p.data ?? {};
    }
  }
  return {
    role: row.role === "user" ? "user" : "assistant",
    text,
    activities,
    citations,
    thinking,
    thinkingSeconds,
    done: pending === undefined,
    pending,
    permission,
    connect,
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
