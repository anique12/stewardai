import { UserCircle, PhoneCall, Headset, Code2 } from "lucide-react";
import { Container, SectionHeading } from "./primitives";

const CASES = [
  {
    icon: UserCircle,
    title: "Personal productivity",
    body: "Let Steward be the one who remembers. Walk out of back-to-backs with every decision captured and every commitment tracked — without taking a single note.",
    detail: "Recaps · action tracking · recall",
  },
  {
    icon: PhoneCall,
    title: "Sales calls",
    body: "Never lose a promise made on a demo. Steward logs next steps, objections, and commitments the moment the call ends, so follow-up writes itself.",
    detail: "Next steps · CRM-ready notes",
  },
  {
    icon: Headset,
    title: "Customer support",
    body: "Build voice agents that resolve real issues — sub-second responses, accurate transcription for QA, and summaries that flow into your ticketing system.",
    detail: "Live agents · QA transcripts",
  },
  {
    icon: Code2,
    title: "Developers building voice apps",
    body: "Ship voice features without owning the audio stack. Stream STT, synthesize TTS, and orchestrate full agents through one API and SDK.",
    detail: "STT · TTS · Agents API",
  },
];

export function UseCases() {
  return (
    <section id="use-cases" className="py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Solutions"
          title="One platform, many jobs to do"
          lead="From a personal assistant that runs your day to the infrastructure powering production voice products."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {CASES.map((c) => (
            <div
              key={c.title}
              className="card-ring group rounded-2xl p-6 transition-colors hover:border-primary/40 sm:p-7"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary">
                <c.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
              <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {c.detail}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
