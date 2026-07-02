import { speakerColor } from "@/lib/meetings/speaker-colors";

export function SpeakerAvatar({ name }: { name: string }) {
  const c = speakerColor(name);
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      {initials}
    </span>
  );
}
