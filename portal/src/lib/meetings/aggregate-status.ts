export function aggregateStatus(
  actions: { state: string }[],
): { label: string; tone: "amber" | "blue" | "green" | "red" | "muted" } {
  if (!actions.length) return { label: "", tone: "muted" };
  const states = actions.map((a) => a.state);
  if (states.includes("proposed")) return { label: "Needs approval", tone: "amber" };
  if (states.includes("running") || states.includes("approved")) return { label: "Running…", tone: "blue" };
  if (states.includes("failed")) return { label: "Failed", tone: "red" };
  if (states.every((s) => s === "done")) return { label: "Done", tone: "green" };
  return { label: "", tone: "muted" };
}
