export type ActionRow = {
  id: string;
  owner: string;
  task: string;
  due: string | null;
  done: boolean;
  meeting_id: string;
  meeting_title: string;
};

export function groupActionItems(rows: ActionRow[]): { open: ActionRow[]; done: ActionRow[] } {
  const open = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);
  open.sort((a, b) => {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  });
  return { open, done };
}
