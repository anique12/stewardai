import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("anim-pulse rounded-md bg-surface-2", className)}
      {...props}
    />
  )
}

export { Skeleton }
