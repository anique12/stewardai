import { Skeleton } from "@/components/ui/skeleton";

export function UsageSkeleton() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <Skeleton className="mb-5 h-[26px] w-[140px]" />
      <div className="mb-[22px] grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[240px] w-full rounded-xl" />
    </div>
  );
}
