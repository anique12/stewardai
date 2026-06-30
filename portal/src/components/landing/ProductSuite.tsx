import { Bot, AudioLines, FileText, Speech, ArrowRight } from "lucide-react";
import { Container, SectionHeading } from "./primitives";

const PRODUCTS = [
  {
    name: "Steward",
    tag: "Personal agent",
    icon: Bot,
    href: "#steward",
    one: "Your always-on personal AI agent.",
    lines: [
      "Joins your meetings, transcribes by speaker, and writes the summary, decisions, and action items.",
      "Unlike silent notetakers, it speaks up in the room — answer a question, summarize on request, all out loud.",
      "Remembers everything across calls and nudges you on what's owed.",
    ],
    featured: true,
  },
  {
    name: "Voice Agents",
    tag: "Build & deploy",
    icon: AudioLines,
    href: "#voice-agents",
    one: "Real-time conversational voice agents.",
    lines: [
      "Sub-second turn-taking, barge-in, and natural interruptions out of the box.",
      "Bring your own LLM; we handle the audio loop end to end.",
    ],
  },
  {
    name: "Speech-to-Text",
    tag: "Developer API",
    icon: FileText,
    href: "#developers",
    one: "Fast, accurate, multilingual transcription.",
    lines: [
      "Streaming and batch endpoints with word-level timestamps and diarization.",
      "25+ languages, tuned for noisy real-world audio.",
    ],
  },
  {
    name: "Text-to-Speech",
    tag: "Developer API",
    icon: Speech,
    href: "#developers",
    one: "Natural, low-latency voices as a service.",
    lines: [
      "Streaming synthesis with first-byte latency low enough for live agents.",
      "Expressive voices, SSML control, and consistent pacing.",
    ],
  },
];

export function ProductSuite() {
  return (
    <section id="products" className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="One platform"
          title="A personal agent for you, the voice stack for developers"
          lead="Four products on a single, production-grade voice pipeline. Use Steward as your assistant, or build your own agents on the same infrastructure."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {PRODUCTS.map((p) => (
            <a
              key={p.name}
              href={p.href}
              className={`group card-ring relative flex flex-col rounded-2xl p-6 transition-colors hover:border-primary/40 sm:p-7 ${
                p.featured ? "sm:col-span-2 sm:flex-row sm:items-center sm:gap-8" : ""
              }`}
            >
              <div className={p.featured ? "sm:max-w-md" : ""}>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary">
                    <p.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {p.tag}
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-semibold text-foreground">{p.name}</h3>
                <p className="mt-1 text-sm font-medium text-foreground/90">{p.one}</p>
                <div className="mt-3 space-y-2">
                  {p.lines.map((l) => (
                    <p key={l} className="text-sm leading-relaxed text-muted-foreground">
                      {l}
                    </p>
                  ))}
                </div>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Learn more
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </div>
              {p.featured ? (
                <div className="mt-6 flex-1 sm:mt-0">
                  <FeaturedPanel />
                </div>
              ) : null}
            </a>
          ))}
        </div>
      </Container>
    </section>
  );
}

function FeaturedPanel() {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Meeting recap · auto-generated
      </p>
      <ul className="mt-3 space-y-2.5 text-sm">
        <li className="flex gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="text-foreground">Decided: launch pricing v2 on the 15th.</span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="text-foreground">
            <span className="text-primary">@you</span> — send the revised deck to Finance.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="text-foreground">Open question: do we grandfather legacy plans?</span>
        </li>
      </ul>
    </div>
  );
}
