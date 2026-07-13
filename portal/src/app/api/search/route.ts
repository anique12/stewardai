import { NextRequest, NextResponse } from "next/server";
import { requireUserRoute } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";

export type SearchResult = {
  type: "meeting" | "person" | "space" | "action";
  id: string;
  title: string;
  sub: string;
  href: string;
};

const PER_TABLE_LIMIT = 8;

export async function GET(request: NextRequest) {
  const { user, response } = await requireUserRoute();
  if (!user) return response;

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const db = createServerClient();
  const pattern = `%${q.replace(/[%_]/g, "")}%`;

  const [meetingsRes, entitiesRes, spacesRes, actionsRes] = await Promise.all([
    db
      .from("meetings")
      .select("id,title,start_time")
      .eq("user_id", user.id)
      .ilike("title", pattern)
      .order("start_time", { ascending: false })
      .limit(PER_TABLE_LIMIT),
    db
      .from("entities")
      .select("id,name,email,domain")
      .eq("user_id", user.id)
      .ilike("name", pattern)
      .limit(PER_TABLE_LIMIT),
    db
      .from("spaces")
      .select("id,name,kind")
      .eq("user_id", user.id)
      .ilike("name", pattern)
      .limit(PER_TABLE_LIMIT),
    // action_items has no user_id column — RLS scopes it via the meetings.user_id join.
    db
      .from("action_items")
      .select("id,task,meeting_id,meetings(title)")
      .ilike("task", pattern)
      .limit(PER_TABLE_LIMIT),
  ]);

  const results: SearchResult[] = [
    ...(meetingsRes.data ?? []).map((m): SearchResult => ({
      type: "meeting",
      id: m.id as string,
      title: m.title as string,
      sub: new Date(m.start_time as string).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      href: `/app/meetings/${m.id}`,
    })),
    ...(entitiesRes.data ?? []).map((e): SearchResult => ({
      type: "person",
      id: e.id as string,
      title: e.name as string,
      sub: (e.email as string | null) ?? (e.domain as string | null) ?? "",
      href: "/app/spaces",
    })),
    ...(spacesRes.data ?? []).map((s): SearchResult => ({
      type: "space",
      id: s.id as string,
      title: s.name as string,
      sub: (s.kind as string | null) ?? "Space",
      href: `/app/spaces/${s.id}`,
    })),
    ...(actionsRes.data ?? []).map((a): SearchResult => ({
      type: "action",
      id: a.id as string,
      title: a.task as string,
      sub: ((a as unknown as { meetings: { title: string } | null }).meetings?.title) ?? "Action item",
      href: `/app/meetings/${a.meeting_id}`,
    })),
  ];

  return NextResponse.json({ results });
}
