import Link from "next/link";
import { FileMeetingControl, type SpaceOption } from "@/components/spaces/FileMeetingControl";
import { SpaceEntities, type SpaceEntity } from "@/components/spaces/SpaceEntities";

export function MeetingSpaceSection({
  meetingId,
  space,
  spaceSource,
  tags,
  entities,
  allSpaces,
}: {
  meetingId: string;
  space: { id: string; name: string } | null;
  spaceSource: string | null;
  tags: string[];
  entities: SpaceEntity[];
  allSpaces: SpaceOption[];
}) {
  const unconfirmed = !space || spaceSource === "suggested" || spaceSource === "unfiled";
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        {space ? (
          <Link
            href={`/app/spaces/${space.id}`}
            className="inline-flex items-center gap-[7px] rounded-pill border border-brand-weak-2 bg-brand-weak px-2.5 py-[5px] text-[12.5px] font-semibold text-brand-ink transition-colors hover:bg-brand-weak-2"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M12 3.5l8 4-8 4-8-4 8-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M4 12l8 4 8-4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            {space.name}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-[7px] rounded-pill border border-line-2 bg-surface-2 px-2.5 py-[5px] text-[12.5px] font-semibold text-ink-3">
            Unfiled
          </span>
        )}
        <FileMeetingControl
          meetingId={meetingId}
          spaces={allSpaces}
          suggestedSpaceId={unconfirmed && space ? space.id : null}
          suggestedSpaceName={unconfirmed && space ? space.name : null}
        />
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-[6px]">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-pill border border-line-2 bg-surface-2 px-[9px] py-[2px] font-mono text-[10.5px] font-medium text-ink-3"
            >
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      {entities.length > 0 ? (
        <div className="min-w-0">
          <SpaceEntities entities={entities} />
        </div>
      ) : null}
    </div>
  );
}
