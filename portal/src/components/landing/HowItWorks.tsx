import { CalendarPlus, FileCheck2, MessageCircle } from "lucide-react";
import { Container, SectionHeading } from "./primitives";

const STEPS = [
  {
    n: "01",
    icon: CalendarPlus,
    title: "Connect your calendar",
    body: "Sign in with Google — under a minute, no downloads.",
  },
  {
    n: "02",
    icon: FileCheck2,
    title: "MeetBase joins & takes notes",
    body: "It joins the calls you choose and auto-captures notes, decisions, and action items.",
  },
  {
    n: "03",
    icon: MessageCircle,
    title: "Organized & searchable",
    body: "Every meeting files into Spaces — then ask MeetBase anything about your history.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          align="center"
          eyebrow="Get started"
          title="Live in a few minutes"
          lead="No note-takers to invite, no recordings to babysit. Connect once and MeetBase handles the rest."
        />
        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
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
