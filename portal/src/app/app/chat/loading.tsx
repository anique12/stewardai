import { Skeleton } from "@/components/ui/skeleton";

// Chat is a client component that manages its own connection/streaming
// state (ChatPage already wraps ChatInner in a Suspense with a text
// fallback for the useSearchParams CSR bailout) — this route-level skeleton
// only covers the brief window before that JS mounts, mirroring the
// sidebar + message pane + composer shell so there's no layout jump.
export default function Loading() {
  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] gap-6">
      <aside className="hidden w-[240px] shrink-0 rounded-xl border border-line bg-surface p-3 shadow-sh-1 lg:block">
        <Skeleton className="mb-3 h-8 w-full rounded-md" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 pt-4">
            <Skeleton className="h-16 w-3/4 self-end rounded-xl" />
            <Skeleton className="h-24 w-4/5 rounded-xl" />
            <Skeleton className="h-12 w-2/3 self-end rounded-xl" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
