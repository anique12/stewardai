import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/PageHeader";
import { ActionItemsList } from "@/components/meetings/ActionItemsList";
import { ActionItemsSkeleton } from "@/components/meetings/ActionItemsSkeleton";
import { ActionItemsError } from "@/components/meetings/ActionItemsError";
import type { ActionRow } from "@/lib/meetings/actions";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  await requireUserPage();

  return (
    <div className="space-y-6">
      <PageHeader title="Action items" subtitle="Every commitment across your meetings, in one place." />
      <Suspense fallback={<ActionItemsSkeleton />}>
        <ActionItemsContent />
      </Suspense>
    </div>
  );
}

async function ActionItemsContent() {
  try {
    const user = await requireUserPage();
    const db = createServerClient(); // RLS-scoped: action_items has no user_id column, scoping is via the meetings.user_id join

    const [{ data, error }, { data: profile }] = await Promise.all([
      db
        .from("action_items")
        .select("id,owner,task,due,done,meeting_id,meetings(title)")
        .order("created_at", { ascending: false }),
      db.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle(),
    ]);

    if (error) throw error;

    const rows: ActionRow[] = (data ?? []).map((r) => ({
      id: r.id as string,
      owner: (r.owner as string) ?? "unassigned",
      task: r.task as string,
      due: (r.due as string | null) ?? null,
      done: Boolean(r.done),
      meeting_id: r.meeting_id as string,
      meeting_title: ((r as unknown as { meetings: { title: string } | null }).meetings?.title) ?? "Meeting",
    }));

    const timeZone = (profile?.timezone as string | null) ?? "UTC";

    return <ActionItemsList rows={rows} timeZone={timeZone} />;
  } catch {
    return <ActionItemsError />;
  }
}
