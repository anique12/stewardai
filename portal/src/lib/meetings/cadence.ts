const DAY_MS = 24 * 60 * 60 * 1000;

export function cadenceLabel(startTimesIso: string[]): string {
  const times = startTimesIso
    .map((t) => new Date(t).getTime())
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (times.length < 2) return "Recurring";
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY_MS);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];

  // Check if all gaps are consistent with the detected cadence
  if (median >= 0.5 && median <= 1.5 && gaps.every((g) => g >= 0.5 && g <= 1.5)) return "Daily";
  if (median >= 6 && median <= 8 && gaps.every((g) => g >= 6 && g <= 8)) return "Weekly";
  if (median >= 13 && median <= 15 && gaps.every((g) => g >= 13 && g <= 15)) return "Biweekly";
  if (median >= 27 && median <= 31 && gaps.every((g) => g >= 27 && g <= 31)) return "Monthly";
  return "Recurring";
}
