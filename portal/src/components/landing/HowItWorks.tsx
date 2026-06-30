import { CalendarPlus, ToggleRight, FileCheck2 } from "lucide-react";
import { Container, SectionHeading } from "./primitives";

const STEPS = [
  {
    n: "01",
    icon: CalendarPlus,
    title: "Connect your calendar",
    body: "Sign in with Google and grant read-only calendar access. Setup takes under a minute — no extensions, no downloads.",
  },
  {
    n: "02",
    icon: ToggleRight,
    title: "Steward joins your meetings",
    body: "Flip on the meetings you want covered, or let Steward auto-join recurring calls. It dials into Meet and Zoom on time, every time.",
  },
  {
    n: "03",
    icon: FileCheck2,
    title: "Get transcripts, summaries & action items",
    body: "Minutes after the call, your recap is waiting — named transcript, decisions, owners, and follow-ups, all searchable.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          align="center"
          eyebrow="Get started"
          title="Live in three steps"
          lead="No note-takers to invite, no recordings to babysit. Connect once and Steward handles the rest."
        />
        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-card p-7">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary">
                  <s.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="font-mono text-sm text-muted-foreground">{s.n}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
