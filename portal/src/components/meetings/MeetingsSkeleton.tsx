import { Skeleton } from "@/components/ui/skeleton";

export function MeetingsSkeleton() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <Skeleton className="mb-[6px] h-[26px] w-[180px]" />
      <Skeleton className="mb-[26px] h-[13px] w-[280px]" />
      <Skeleton className="mb-[22px] h-[34px] w-[220px] rounded-lg" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="mb-3 flex items-center gap-4 rounded-[13px] border border-line bg-surface p-[18px]">
          <Skeleton className="h-11 w-[58px] rounded-lg" />
          <div className="flex-1">
            <Skeleton className="mb-[9px] h-[15px] w-[52%]" />
            <Skeleton className="h-[11px] w-[32%]" />
          </div>
          <Skeleton className="h-[26px] w-24 rounded-pill" />
        </div>
      ))}
    </div>
  );
}
