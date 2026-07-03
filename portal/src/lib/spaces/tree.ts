export type SpaceRow = {
  id: string;
  name: string;
  parent_id: string | null;
  kind: "client" | "project" | "topic" | null;
  status: "active" | "archived";
};

export type SpaceNode = SpaceRow & { children: SpaceNode[] };

/** Build a nested, name-sorted tree from a flat space list. A space whose
 *  parent_id is null or points at a space not in the list becomes a root. */
export function buildSpaceTree(spaces: SpaceRow[]): SpaceNode[] {
  const byId = new Map<string, SpaceNode>();
  for (const s of spaces) byId.set(s.id, { ...s, children: [] });
  const roots: SpaceNode[] = [];
  for (const node of Array.from(byId.values())) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: SpaceNode[]) => {
    nodes.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
