import { Skeleton } from "@/components/ui/skeleton";

export function HomeSkeleton() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <Skeleton className="mb-2 h-[30px] w-[260px]" />
      <Skeleton className="mb-6 h-[14px] w-[340px]" />
      <Skeleton className="mb-5 h-16 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-[280px] w-full rounded-xl" />
        <Skeleton className="h-[280px] w-full rounded-xl" />
      </div>
    </div>
  );
}
