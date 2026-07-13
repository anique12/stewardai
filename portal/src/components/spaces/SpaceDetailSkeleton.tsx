import { Skeleton } from "@/components/ui/skeleton";

// Mirrors SpaceDetailPage: breadcrumb, title + meta row, then the
// facts/meetings column paired with the people & companies aside.
export function SpaceDetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <Skeleton className="mb-3 h-3 w-24" />
      <div className="mb-4 flex flex-wrap items-start gap-3.5">
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-2 h-7 w-[240px]" />
          <Skeleton className="h-3 w-[200px]" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <Skeleton className="mb-[13px] h-3 w-28" />
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="mb-[11px] h-3 w-32" />
            <Skeleton className="h-[180px] w-full rounded-lg" />
          </div>
        </div>
        <div className="flex flex-col gap-3.5">
          <Skeleton className="h-[220px] w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
