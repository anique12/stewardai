import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SpaceNode } from "@/lib/spaces/tree";

export function SpaceCard({
  node,
  meetingCount,
  openFactsCount,
}: {
  node: SpaceNode;
  meetingCount: number;
  openFactsCount: number;
}) {
  return (
    <Link href={`/app/spaces/${node.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-accent">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{node.name}</h3>
          {node.kind ? <Badge variant="outline">{node.kind}</Badge> : null}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {meetingCount} meeting{meetingCount === 1 ? "" : "s"}
          {openFactsCount > 0 ? ` · ${openFactsCount} open` : ""}
        </p>
        {node.children.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {node.children.map((c) => c.name).join(" · ")}
          </p>
        ) : null}
      </Card>
    </Link>
  );
}
