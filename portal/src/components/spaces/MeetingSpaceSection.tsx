import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Space</h2>
          {space ? (
            <Link href={`/app/spaces/${space.id}`} className="text-sm hover:underline">{space.name}</Link>
          ) : (
            <p className="text-sm text-muted-foreground">Unfiled</p>
          )}
        </div>
        <FileMeetingControl
          meetingId={meetingId}
          spaces={allSpaces}
          suggestedSpaceId={unconfirmed && space ? space.id : null}
          suggestedSpaceName={unconfirmed && space ? space.name : null}
        />
      </div>
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.map((t) => <Badge key={t} variant="outline">#{t}</Badge>)}
        </div>
      ) : null}
      {entities.length > 0 ? <div className="mt-3"><SpaceEntities entities={entities} /></div> : null}
    </Card>
  );
}
