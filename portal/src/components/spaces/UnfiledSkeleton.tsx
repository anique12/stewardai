import { Skeleton } from "@/components/ui/skeleton";

// Mirrors UnfiledPage: back link, title + subtitle, then a stack of
// review-queue cards (icon + title/meta + a footer action row).
export function UnfiledSkeleton() {
  return (
    <div className="mx-auto max-w-[760px] pb-[60px]">
      <Skeleton className="mb-3.5 h-3 w-16" />
      <Skeleton className="mb-2 h-6 w-40" />
      <Skeleton className="mb-[22px] h-3.5 w-full max-w-[520px]" />
      <div className="flex flex-col gap-3.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
            <div className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-[9px]" />
              <div className="min-w-0 flex-1">
                <Skeleton className="mb-[7px] h-3.5 w-2/3" />
                <Skeleton className="mb-2 h-2.5 w-1/3" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            </div>
            <div className="mt-3.5 flex items-center gap-[10px] border-t border-line pt-[13px]">
              <Skeleton className="h-5 w-24 rounded-pill" />
              <span className="flex-1" />
              <Skeleton className="h-8 w-28 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
