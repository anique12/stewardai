import { PageHeader } from "@/components/app-shell/PageHeader";
import { ActionItemsList } from "@/components/meetings/ActionItemsList";
import type { ActionRow } from "@/lib/meetings/actions";
import { requireUserPage } from "@/lib/auth-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  await requireUserPage();
  const db = createServerClient(); // RLS-scoped: action_items has no user_id column, scoping is via the meetings.user_id join

  const { data } = await db
    .from("action_items")
    .select("id,owner,task,due,done,meeting_id,meetings(title)")
    .order("created_at", { ascending: false });

  const rows: ActionRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    owner: (r.owner as string) ?? "unassigned",
    task: r.task as string,
    due: (r.due as string | null) ?? null,
    done: Boolean(r.done),
    meeting_id: r.meeting_id as string,
    meeting_title: ((r as unknown as { meetings: { title: string } | null }).meetings?.title) ?? "Meeting",
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Action items" subtitle="Every task Steward captured across your meetings." />
      <ActionItemsList rows={rows} />
    </div>
  );
}
