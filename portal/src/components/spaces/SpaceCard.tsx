import Link from "next/link";
import type { SpaceNode } from "@/lib/spaces/tree";
import { SpeakerAvatar } from "@/components/meetings/SpeakerAvatar";

export type SpaceCardStats = {
  meetings: number;
  open: number;
  updatedAt: string | null;
  people: { id: string; name: string; email?: string | null }[];
};

const EMPTY_STATS: SpaceCardStats = { meetings: 0, open: 0, updatedAt: null, people: [] };

function updatedLabel(iso: string | null): string {
  if (!iso) return "no meetings yet";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function OpenChip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-pill border border-attention-weak bg-attention-weak px-2 py-[3px] font-mono text-[10px] font-semibold text-attention-strong">
      {count} open
    </span>
  );
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5l8 4-8 4-8-4 8-4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 12l8 4 8-4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden className="text-ink-3">
      <path
        d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A single card in the Spaces grid. Renders as a "group" card (folder icon +
 *  a compact list of child rows) when the node has children, otherwise as a
 *  "leaf" card (icon, meeting/open stats, and an overlapping avatar row). */
export function SpaceCard({
  node,
  statsById,
}: {
  node: SpaceNode;
  statsById: Record<string, SpaceCardStats>;
}) {
  const stats = statsById[node.id] ?? EMPTY_STATS;

  if (node.children.length > 0) {
    return (
      <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 shadow-sh-1">
        <div className="flex items-center gap-[9px]">
          <FolderIcon />
          <span className="flex-1 truncate font-display text-[15.5px] font-bold">{node.name}</span>
          <span className="font-mono text-[10.5px] text-ink-3">
            {stats.meetings} mtg{stats.meetings === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {node.children.map((child) => {
            const cStats = statsById[child.id] ?? EMPTY_STATS;
            return (
              <Link
                key={child.id}
                href={`/app/spaces/${child.id}`}
                className="flex items-center gap-[10px] rounded-md border border-line px-2.5 py-[9px] transition-colors hover:bg-surface-2"
              >
                <span className="h-[6px] w-[6px] shrink-0 rounded-sm bg-brand" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{child.name}</span>
                <OpenChip count={cStats.open} />
                <span className="shrink-0 font-mono text-[10px] text-ink-4">{cStats.meetings}</span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/app/spaces/${node.id}`}
      className="flex flex-col gap-[14px] rounded-lg border border-line bg-surface p-4 shadow-sh-1 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start gap-[10px]">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-brand-weak text-brand">
          <LayersIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[16px] font-bold leading-[1.15]">{node.name}</div>
          <div className="mt-[3px] font-mono text-[11px] text-ink-3">
            {stats.meetings} meeting{stats.meetings === 1 ? "" : "s"} · updated {updatedLabel(stats.updatedAt)}
          </div>
        </div>
        <OpenChip count={stats.open} />
      </div>
      {stats.people.length > 0 ? (
        <div className="flex items-center gap-1.5">
          {stats.people.map((p) => (
            <SpeakerAvatar key={p.id} name={p.name} email={p.email} />
          ))}
        </div>
      ) : null}
    </Link>
  );
}
