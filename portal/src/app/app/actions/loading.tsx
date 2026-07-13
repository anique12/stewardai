import { PageHeader } from "@/components/app-shell/PageHeader";
import { ActionItemsSkeleton } from "@/components/meetings/ActionItemsSkeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Action items" subtitle="Every commitment across your meetings, in one place." />
      <ActionItemsSkeleton />
    </div>
  );
}
