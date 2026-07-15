// Deterministic speaker → color mapping for avatar initial-chips. Tuned to be
// clearly visible in BOTH themes: a solid-enough tint (/25) with dark text on
// the light paper theme and a lighter text in dark mode. (The old /15 tint +
// light-400 text was dark-only and rendered as near-invisible bare letters on
// the cream surfaces.)
// OPAQUE fills on the light theme so overlapping avatar stacks occlude cleanly
// (a translucent /25 tint let the chip behind bleed through where they cross);
// dark mode keeps the subtler translucent tint.
const PALETTE: { bg: string; text: string }[] = [
  { bg: "bg-sky-100 dark:bg-sky-500/25", text: "text-sky-700 dark:text-sky-300" },
  { bg: "bg-violet-100 dark:bg-violet-500/25", text: "text-violet-700 dark:text-violet-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-500/25", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-amber-100 dark:bg-amber-500/25", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-rose-100 dark:bg-rose-500/25", text: "text-rose-700 dark:text-rose-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-500/25", text: "text-cyan-700 dark:text-cyan-300" },
];

export function speakerColor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
