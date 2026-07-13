import { Skeleton } from "@/components/ui/skeleton";

// Simple centered skeleton matching WelcomePage's grid — brand pane is
// static marketing copy (no data), so only the form pane needs a placeholder.
export default function Loading() {
  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-paper text-ink lg:grid-cols-2">
      <div className="hidden bg-brand lg:block" />
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-[400px] rounded-lg border border-line bg-surface p-8 shadow-sh-1">
          <Skeleton className="mb-[18px] h-6 w-28" />
          <Skeleton className="mb-4 h-12 w-12 rounded-[13px]" />
          <Skeleton className="mb-[6px] h-6 w-56" />
          <Skeleton className="mb-5 h-3.5 w-full max-w-[320px]" />
          <Skeleton className="mb-5 h-20 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
