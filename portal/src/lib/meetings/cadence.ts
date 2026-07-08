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

  // Pick a candidate band from the median, then confirm with a majority of gaps.
  let label: string | null = null;
  let lo = 0;
  let hi = 0;
  if (median >= 0.5 && median <= 1.5) {
    label = "Daily";
    lo = 0.5;
    hi = 1.5;
  } else if (median >= 6 && median <= 8) {
    label = "Weekly";
    lo = 6;
    hi = 8;
  } else if (median >= 13 && median <= 15) {
    label = "Biweekly";
    lo = 13;
    hi = 15;
  } else if (median >= 27 && median <= 31) {
    label = "Monthly";
    lo = 27;
    hi = 31;
  }
  if (label === null) return "Recurring";

  let matches = 0;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] >= lo && gaps[i] <= hi) matches++;
  }
  if (matches > gaps.length / 2) return label;
  return "Recurring";
}
