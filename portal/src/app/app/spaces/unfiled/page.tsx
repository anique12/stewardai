import Link from "next/link";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { Card } from "@/components/ui/card";
import { FileMeetingControl, type SpaceOption } from "@/components/spaces/FileMeetingControl";

export const dynamic = "force-dynamic";

export default async function UnfiledPage() {
  const user = await requireUserPage();
  const db = createServerClient();

  const [{ data: meetings }, { data: spaces }] = await Promise.all([
    db.from("meetings")
      .select("id,title,start_time,space_id,space_source")
      .eq("user_id", user.id).or("space_source.in.(suggested,unfiled),space_id.is.null")
      .order("start_time", { ascending: false }),
    db.from("spaces").select("id,name").eq("user_id", user.id).eq("status", "active").order("name"),
  ]);

  const spaceOptions = (spaces ?? []) as SpaceOption[];
  const nameById = new Map(spaceOptions.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Unfiled" subtitle="Confirm or correct where these meetings belong." />
      {(meetings ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to review — <Link href="/app/spaces" className="hover:underline">back to Spaces</Link>.
        </p>
      ) : (
        <div className="space-y-3">
          {(meetings ?? []).map((m) => {
            // A 'suggested' meeting already has its best-guess space_id; offer it as a one-tap confirm.
            const suggestedId = m.space_source === "suggested" ? m.space_id : null;
            return (
              <Card key={m.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/app/meetings/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                    <p className="text-xs text-muted-foreground">{new Date(m.start_time).toLocaleString()}</p>
                  </div>
                  <FileMeetingControl
                    meetingId={m.id}
                    spaces={spaceOptions}
                    suggestedSpaceId={suggestedId}
                    suggestedSpaceName={suggestedId ? nameById.get(suggestedId) ?? null : null}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
