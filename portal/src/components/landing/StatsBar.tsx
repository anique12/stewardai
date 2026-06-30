import { Container } from "./primitives";

const STATS = [
  { value: "<700ms", label: "Voice-to-voice latency" },
  { value: "25+", label: "Languages transcribed" },
  { value: "Real-time", label: "Streaming STT & TTS" },
  { value: "Barge-in", label: "Natural turn-taking" },
];

export function StatsBar() {
  return (
    <section aria-label="Platform capabilities" className="border-y border-border bg-card/40">
      <Container>
        <dl className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={`px-2 py-7 text-center sm:px-6 ${i >= 2 ? "border-t border-border sm:border-t-0" : ""}`}
            >
              <dt className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {s.value}
              </dt>
              <dd className="mt-1 text-xs text-muted-foreground sm:text-sm">{s.label}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
