import { ChevronDown } from "lucide-react";
import { Container, SectionHeading } from "./primitives";

// Truthful, SEO-oriented Q&A. Rendered server-side (crawlable text) with a
// FAQPage JSON-LD block below for rich results. Keep answers accurate — these
// are the same claims the Trust/Privacy pages make.
const FAQS: { q: string; a: string }[] = [
  {
    q: "What is MeetBase?",
    a: "MeetBase is an AI meeting agent that joins your video calls, takes notes and captures action items automatically, and organizes every meeting into Spaces you can search and chat with. Unlike a silent notetaker, it can also answer questions out loud during the meeting.",
  },
  {
    q: "How does MeetBase join my meetings?",
    a: "Connect your Google Calendar once (read-only), then choose which meetings to enable — or let MeetBase auto-join recurring calls. It joins on Google Meet as a visible participant, with no links to paste and nothing to download.",
  },
  {
    q: "Can MeetBase speak during a meeting?",
    a: "Yes. Ask it a question in the call and it answers out loud, grounded in the live transcript; tell it to summarize and it speaks the recap. Speaking is optional — you can turn it on per meeting, or leave MeetBase silent and just taking notes.",
  },
  {
    q: "Do the other participants know MeetBase is there?",
    a: "Yes. MeetBase always joins as a named, visible participant in the attendee list. It never records covertly or impersonates a person.",
  },
  {
    q: "Is my meeting data private and secure?",
    a: "Your data is encrypted in transit (TLS) and at rest, isolated per user with row-level security, and never used to train AI models. You can delete any transcript, or your entire account and its data, at any time.",
  },
  {
    q: "What calendar access does MeetBase need?",
    a: "By default MeetBase connects read-only — it only reads your calendar to know when to join. If you'd like it to create or manage calendar events for you, you can grant write access; that's entirely your choice, and you can revoke it anytime.",
  },
  {
    q: "Can MeetBase connect to my other tools?",
    a: "Yes. Connect apps like Notion, Slack, and Google Sheets, and MeetBase can turn meeting outcomes into action — create a task, post a recap, or log a row — when you ask. You choose which apps are connected, and it only acts with your approval.",
  },
  {
    q: "Which meeting platforms does MeetBase support?",
    a: "Google Meet and Google Calendar today. Support for Zoom and Microsoft Teams — both calls and calendars — is on the roadmap.",
  },
  {
    q: "How much does MeetBase cost?",
    a: "MeetBase has a free tier, and no credit card is required to get started.",
  },
];

export function FAQ() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <section id="faq" className="border-t border-border py-20 sm:py-28">
      <Container>
        <SectionHeading
          align="center"
          eyebrow="FAQ"
          title="Questions, answered"
          lead="Everything you need to know about how MeetBase works, joins, and keeps your meetings private."
        />
        <div className="mx-auto mt-12 max-w-3xl divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/30">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
      {/* FAQPage structured data for SEO rich results. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}
