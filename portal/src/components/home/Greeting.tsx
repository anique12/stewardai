function greetingWord(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function firstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "there";
  const local = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const first = local.split(/[\s._-]+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "there";
}

export interface GreetingProps {
  displayName: string;
  now: Date;
  timeZone: string;
  meetingsToday: number;
  openActions: number;
}

export function Greeting({ displayName, now, timeZone, meetingsToday, openActions }: GreetingProps) {
  const dateLabel = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  });

  return (
    <div className="mb-[18px]">
      <h1 className="mb-1 font-display text-[28px] font-bold tracking-tight">
        {greetingWord(now)}, {firstName(displayName)}
      </h1>
      <p className="text-[13.5px] text-ink-2">
        {dateLabel} ·{" "}
        <span className="font-semibold text-brand">
          Steward is covering {meetingsToday} meeting{meetingsToday === 1 ? "" : "s"}
        </span>{" "}
        today · {openActions} open action item{openActions === 1 ? "" : "s"}
      </p>
    </div>
  );
}
