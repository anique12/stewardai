import { Skeleton } from "@/components/ui/skeleton";

// Mirrors MeetingDetailPage's layout: back link + title/status row, a meta
// line, a space-section chip row, then the two-column transcript/recap tabs
// (side-by-side at lg+, matching MeetingDetailTabs).
export function MeetingDetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <Skeleton className="mb-3.5 h-3 w-20" />
      <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
        <Skeleton className="h-7 w-[280px]" />
        <Skeleton className="h-5 w-20 rounded-pill" />
      </div>
      <Skeleton className="mb-[18px] h-3 w-[220px]" />

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-surface p-3.5">
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-pill" />
        <Skeleton className="h-8 w-24 rounded-pill" />
      </div>

      <Skeleton className="mb-4 h-9 w-full max-w-[260px] rounded-md lg:hidden" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px] w-full rounded-xl" />
          ))}
        </div>
        <div className="space-y-3.5">
          <Skeleton className="h-[120px] w-full rounded-xl" />
          <Skeleton className="h-[90px] w-full rounded-xl" />
          <Skeleton className="h-[90px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
