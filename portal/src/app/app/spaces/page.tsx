import Link from "next/link";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { Card } from "@/components/ui/card";
import { buildSpaceTree, type SpaceRow } from "@/lib/spaces/tree";
import { SpaceCard } from "@/components/spaces/SpaceCard";

export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const user = await requireUserPage();
  const db = createServerClient();

  const [{ data: spaces }, { data: filedMeetings }, { data: facts }, { data: unfiled }] =
    await Promise.all([
      db.from("spaces").select("id,name,parent_id,kind,status").eq("user_id", user.id).eq("status", "active"),
      db.from("meetings").select("space_id").eq("user_id", user.id).not("space_id", "is", null),
      db.from("space_facts").select("space_id").eq("user_id", user.id).is("superseded_by", null),
      db.from("meetings").select("id").eq("user_id", user.id).in("space_source", ["suggested", "unfiled"]),
    ]);

  const meetingCounts = new Map<string, number>();
  for (const m of filedMeetings ?? []) if (m.space_id) meetingCounts.set(m.space_id, (meetingCounts.get(m.space_id) ?? 0) + 1);
  const factCounts = new Map<string, number>();
  for (const f of facts ?? []) factCounts.set(f.space_id, (factCounts.get(f.space_id) ?? 0) + 1);

  const tree = buildSpaceTree((spaces ?? []) as SpaceRow[]);
  const unfiledCount = unfiled?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Spaces" subtitle="Your work, organized into threads." />

      {unfiledCount > 0 ? (
        <Link href="/app/spaces/unfiled" className="block">
          <Card className="border-amber-500/40 bg-amber-500/5 p-4 transition-colors hover:bg-amber-500/10">
            <p className="text-sm font-medium text-amber-500">
              {unfiledCount} meeting{unfiledCount === 1 ? "" : "s"} to review →
            </p>
            <p className="text-xs text-muted-foreground">Confirm or correct where these belong.</p>
          </Card>
        </Link>
      ) : null}

      {tree.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No spaces yet. They&apos;re created automatically as Steward organizes your meetings.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((node) => (
            <SpaceCard
              key={node.id}
              node={node}
              meetingCount={meetingCounts.get(node.id) ?? 0}
              openFactsCount={factCounts.get(node.id) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
