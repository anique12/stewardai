import { cn } from "@/lib/utils";

/** Centered max-width content column with responsive gutters. */
export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-container px-5 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

/** Small uppercase label that sits above a section heading. */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary",
        className,
      )}
    >
      <span aria-hidden className="h-px w-6 bg-primary/60" />
      {children}
    </span>
  );
}

/** Section heading + optional lead paragraph, left- or center-aligned. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow ? <Eyebrow className={align === "center" ? "justify-center" : ""}>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          {lead}
        </p>
      ) : null}
    </div>
  );
}
