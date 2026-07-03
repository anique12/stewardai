import { Badge } from "@/components/ui/badge";

export type SpaceEntity = { id: string; kind: "person" | "company"; name: string; email: string | null };

export function SpaceEntities({ entities }: { entities: SpaceEntity[] }) {
  if (entities.length === 0) return <p className="text-sm text-muted-foreground">No people or companies yet.</p>;
  const people = entities.filter((e) => e.kind === "person");
  const companies = entities.filter((e) => e.kind === "company");
  return (
    <div className="space-y-3">
      {companies.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {companies.map((c) => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
        </div>
      ) : null}
      {people.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {people.map((p) => <Badge key={p.id} variant="outline">{p.name}</Badge>)}
        </div>
      ) : null}
    </div>
  );
}
