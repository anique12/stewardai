import { PageHeader } from "@/components/app-shell/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

// Connections is a client component that renders its shell immediately
// (no gating "loading" phase — cards render with default status while the
// fetch resolves), so this route-level skeleton only needs to bridge the
// brief window before that JS mounts.
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Connected apps"
        subtitle="What Steward can read from and act on — you control every connection"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full rounded-md sm:max-w-[280px]" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-16 rounded-pill" />
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[100px] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
