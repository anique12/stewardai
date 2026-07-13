import { Skeleton } from "@/components/ui/skeleton";

// Mirrors SpacesPage: header row + "new space" action, then a grid of
// SpaceCard-shaped tiles.
export function SpacesSkeleton() {
  return (
    <div className="space-y-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3.5 border-b border-line pb-5">
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-2 h-[26px] w-40" />
          <Skeleton className="h-3.5 w-[320px]" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[168px] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
