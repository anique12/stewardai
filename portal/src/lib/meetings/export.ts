export type ExportSummary = {
  tldr: string;
  decisions: { text: string }[];
  discrepancies: { text: string }[];
} | null;

export type ExportAction = { owner: string; task: string; due: string | null; done: boolean };

function hasOwner(owner: string): boolean {
  const o = owner?.trim().toLowerCase();
  return !!o && o !== "unassigned";
}

export function meetingToMarkdown(input: {
  title: string;
  startTime: string;
  summary: ExportSummary;
  actionItems: ExportAction[];
}): string {
  const { title, startTime, summary, actionItems } = input;
  const out: string[] = [`# ${title}`, ""];

  const d = new Date(startTime);
  if (!isNaN(d.getTime())) out.push(`_${d.toLocaleString()}_`, "");

  if (summary?.tldr) out.push("## Summary", "", summary.tldr, "");

  if (summary?.decisions?.length) {
    out.push("## Decisions", "");
    for (const x of summary.decisions) out.push(`- ${x.text}`);
    out.push("");
  }

  if (summary?.discrepancies?.length) {
    out.push("## Open questions", "");
    for (const x of summary.discrepancies) out.push(`- ${x.text}`);
    out.push("");
  }

  if (actionItems.length) {
    out.push("## Action items", "");
    for (const a of actionItems) {
      const box = a.done ? "[x]" : "[ ]";
      const owner = hasOwner(a.owner) ? `@${a.owner.trim()} — ` : "";
      const due = a.due ? ` (due ${a.due})` : "";
      out.push(`- ${box} ${owner}${a.task}${due}`);
    }
    out.push("");
  }

  return out.join("\n").trimEnd() + "\n";
}
