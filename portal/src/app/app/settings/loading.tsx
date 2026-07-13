import { PageHeader } from "@/components/app-shell/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

// Settings is a client component with its own "loading" phase (identical
// PageHeader + 4 card skeletons) — this route-level version just covers the
// brief window before that client state kicks in, so the two never conflict.
export default function Loading() {
  return (
    <div className="mx-auto max-w-[620px] space-y-6">
      <PageHeader title="Settings" subtitle="Manage your assistant, calendar, and plan." />
      <div className="flex flex-col gap-3.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
