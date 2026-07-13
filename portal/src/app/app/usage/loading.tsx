import { Skeleton } from "@/components/ui/skeleton";
import { UsageSkeleton } from "@/components/usage/UsageSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1080px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5">
        <div className="min-w-0">
          <Skeleton className="mb-2 h-6 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <UsageSkeleton />
    </div>
  );
}
