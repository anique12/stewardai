import { CalendarPlus, ToggleRight, FileCheck2, FolderKanban, MessageCircle } from "lucide-react";
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
    title: "MeetBase joins your meetings",
    body: "Flip on the meetings you want covered, or let MeetBase auto-join recurring calls. You choose which ones it joins, and the bot is always visible on the call.",
  },
  {
    n: "03",
    icon: FileCheck2,
    title: "Notes & action items, auto-captured",
    body: "Minutes after the call, your recap is waiting — named transcript, decisions, owners, and follow-ups, all searchable.",
  },
  {
    n: "04",
    icon: FolderKanban,
    title: "Organized into Spaces",
    body: "Every meeting is filed under the client, project, or topic it belongs to, so your history stays organized without any manual filing.",
  },
  {
    n: "05",
    icon: MessageCircle,
    title: "Ask MeetBase about any of it",
    body: "Chat with your entire meeting history — 'what did we decide', 'what are my open action items' — and get answers grounded in the transcript.",
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
