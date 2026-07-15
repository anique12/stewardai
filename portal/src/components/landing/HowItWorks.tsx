import { CalendarPlus, ToggleRight, FileCheck2, FolderKanban, MessageCircle } from "lucide-react";
import { Container, SectionHeading } from "./primitives";

const STEPS = [
  {
    n: "01",
    icon: CalendarPlus,
    title: "Connect your calendar",
    body: "Sign in with Google. Under a minute — no downloads.",
  },
  {
    n: "02",
    icon: ToggleRight,
    title: "MeetBase joins your meetings",
    body: "Pick which calls it joins, or auto-join recurring ones.",
  },
  {
    n: "03",
    icon: FileCheck2,
    title: "Notes & action items, auto-captured",
    body: "A searchable recap: transcript, decisions, follow-ups.",
  },
  {
    n: "04",
    icon: FolderKanban,
    title: "Organized into Spaces",
    body: "Auto-filed by client, project, or topic — no manual sorting.",
  },
  {
    n: "05",
    icon: MessageCircle,
    title: "Ask MeetBase about any of it",
    body: "Chat your whole history — answers grounded in the transcript.",
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
        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
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
