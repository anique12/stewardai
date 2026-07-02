// Deterministic speaker → color mapping for timeline avatars.
const PALETTE: { bg: string; text: string }[] = [
  { bg: "bg-sky-500/15", text: "text-sky-400" },
  { bg: "bg-violet-500/15", text: "text-violet-400" },
  { bg: "bg-emerald-500/15", text: "text-emerald-400" },
  { bg: "bg-amber-500/15", text: "text-amber-400" },
  { bg: "bg-rose-500/15", text: "text-rose-400" },
  { bg: "bg-cyan-500/15", text: "text-cyan-400" },
];

export function speakerColor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
