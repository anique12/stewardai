import { Skeleton } from "@/components/ui/skeleton";

export function ActionItemsSkeleton() {
  return (
    <div>
      <div className="mb-[18px] flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[58px] flex-1 min-w-[120px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="mb-[18px] h-9 w-[220px] rounded-md" />
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3.5 rounded-xl border border-line bg-surface px-4 py-[15px]">
            <Skeleton className="h-[19px] w-[19px] rounded-[5px]" />
            <div className="flex-1">
              <Skeleton className="mb-2 h-[13px] w-[48%]" />
              <Skeleton className="h-[10px] w-[28%]" />
            </div>
            <Skeleton className="h-[22px] w-20 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
