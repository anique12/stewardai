import { Zap, MicOff, Split, Gauge } from "lucide-react";
import { Container, SectionHeading } from "./primitives";
import { VoiceDemoDialog } from "./VoiceDemoDialog";

const TURN = [
  { label: "User speaks", sub: "VAD + endpointing", t: "0ms" },
  { label: "STT", sub: "streaming transcript", t: "~120ms" },
  { label: "LLM", sub: "first token", t: "~280ms" },
  { label: "TTS", sub: "first audio byte", t: "~640ms" },
];

const POINTS = [
  {
    icon: Gauge,
    title: "Sub-second responses",
    body: "Streaming STT, LLM, and TTS run concurrently so the agent starts speaking before the full reply is generated.",
  },
  {
    icon: MicOff,
    title: "Barge-in, handled",
    body: "Talk over the agent and it stops instantly, re-listens, and picks up the new thread — like a real conversation.",
  },
  {
    icon: Split,
    title: "Turn detection that's right",
    body: "Semantic endpointing distinguishes a pause for thought from the end of a turn, so the agent waits when it should.",
  },
];

export function VoiceAgents() {
  return (
    <section id="voice-agents" className="py-20 sm:py-28">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="Voice Agents"
              title="Conversational agents that feel real-time"
              lead="The same pipeline behind Steward, exposed for you to build on. Bring your own LLM and prompts; we own the hard part — the low-latency audio loop."
            />
            <div className="mt-8 space-y-5">
              {POINTS.map((p) => (
                <div key={p.title} className="flex gap-4">
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                    <p.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{p.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <VoiceDemoDialog variant="solid" label="Talk to Steward — live demo" />
            </div>
          </div>

          {/* How a turn flows */}
          <div className="card-ring rounded-2xl p-6 shadow-xl shadow-black/30 sm:p-8">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" aria-hidden />
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                How a turn flows
              </p>
            </div>
            <ol className="mt-6 space-y-px">
              {TURN.map((step, i) => (
                <li key={step.label} className="relative flex items-center gap-4 py-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 font-mono text-xs text-primary">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.sub}</p>
                  </div>
                  <span className="font-mono text-xs text-primary">{step.t}</span>
                  {i < TURN.length - 1 ? (
                    <span
                      aria-hidden
                      className="absolute left-4 top-[2.6rem] h-3 w-px bg-border"
                    />
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="mt-6 rounded-lg border border-border bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground">
              End-to-end voice-to-voice latency stays under ~700ms — fast enough that callers
              don&apos;t notice they&apos;re talking to software.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
