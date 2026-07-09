import { StatusBadge } from "./StatusBadge";
import { MeetingExportActions } from "./MeetingExportActions";
import Link from "next/link";

export function MeetingHeader({
  title, startTime, endTime, meetUrl, botStatus, markdown,
}: { title: string; startTime: string; endTime: string | null; meetUrl: string | null; botStatus: string; markdown?: string }) {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : null;
  const mins = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000)) : null;
  return (
    <div className="border-b border-border pb-4">
      <Link href="/app" className="text-xs text-muted-foreground hover:text-foreground">← Meetings</Link>
      <div className="mt-1 flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <div className="flex items-center gap-3">
          {markdown && <MeetingExportActions markdown={markdown} filename={`${title.replace(/[^\w.-]+/g, "-").toLowerCase() || "meeting"}.md`} />}
          <StatusBadge status={botStatus} />
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
        {" · "}
        {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {end ? `–${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
        {mins ? ` · ${mins} min` : ""}
        {meetUrl && (
          <a href={meetUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-primary hover:underline">Join ↗</a>
        )}
      </p>
    </div>
  );
}
