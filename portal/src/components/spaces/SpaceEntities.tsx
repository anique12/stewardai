import { SpeakerAvatar } from "@/components/meetings/SpeakerAvatar";

export type SpaceEntity = { id: string; kind: "person" | "company"; name: string; email: string | null };

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

/**
 * `"inline"` (default) renders the compact chip row used alongside tags on
 * the meeting detail page. `"panel"` renders the sidebar-style Companies /
 * People lists used on the Space detail page.
 */
export function SpaceEntities({
  entities,
  variant = "inline",
}: {
  entities: SpaceEntity[];
  variant?: "inline" | "panel";
}) {
  if (entities.length === 0) {
    return <p className="text-sm text-ink-3">No people or companies yet.</p>;
  }
  const people = entities.filter((e) => e.kind === "person");
  const companies = entities.filter((e) => e.kind === "company");

  if (variant === "panel") {
    return (
      <div className="flex flex-col gap-3.5">
        {companies.length > 0 ? (
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
            <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
              Companies
            </div>
            <div className="flex flex-col gap-2.5">
              {companies.map((c) => (
                <div key={c.id} className="flex items-center gap-[11px]">
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface-2 font-display text-[15px] font-bold text-ink-2">
                    {c.name[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold">{c.name}</div>
                    {c.email ? <div className="truncate text-[11.5px] text-ink-3">{c.email}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {people.length > 0 ? (
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sh-1">
            <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-wide text-ink-3">
              People
            </div>
            <div className="flex flex-col gap-3">
              {people.map((p) => (
                <div key={p.id} className="flex items-center gap-[11px]">
                  <SpeakerAvatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{p.name}</div>
                    {p.email ? <div className="truncate text-[11.5px] text-ink-3">{p.email}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {companies.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center rounded-pill border border-line-2 bg-surface-2 px-2.5 py-[3px] text-[12px] font-semibold text-ink-2"
        >
          {c.name}
        </span>
      ))}
      {people.map((p) => (
        <span
          key={p.id}
          title={p.email ?? undefined}
          className="inline-flex items-center gap-[5px] rounded-pill border border-line-2 bg-surface px-2.5 py-[3px] text-[12px] font-medium text-ink-3"
        >
          <span className="font-mono text-[9px] font-semibold text-ink-4">{initials(p.name)}</span>
          {p.name}
        </span>
      ))}
    </div>
  );
}
