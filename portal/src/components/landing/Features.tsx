import {
  CalendarCheck,
  Users,
  ListChecks,
  Search,
  FolderKanban,
} from "lucide-react";
import { Container, SectionHeading } from "./primitives";

export function Features() {
  return (
    <section id="features" className="border-t border-border bg-card/30 py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="MeetBase · the meeting agent"
          title="An agent that actually shows up to your meetings"
          lead="MeetBase joins your calls on its own, captures everything that matters, and organizes it so nothing slips through the cracks."
        />

        <div className="mt-14 space-y-16 sm:space-y-24">
          <FeatureRow
            icon={CalendarCheck}
            kicker="Autonomy"
            title="Joins your meetings automatically"
            body="Connect your calendar once. MeetBase watches your schedule and dials into the calls you mark, on Google Meet — no copy-pasting links, no bot wrangling. It's listening from the first word."
            visual={<JoinVisual />}
          />
          <FeatureRow
            reverse
            icon={Users}
            kicker="Transcription"
            title="Named-speaker transcripts, in real time"
            body="Every line is attributed to the person who said it, streamed live as the conversation happens. Diarization, timestamps, and clean punctuation — accurate enough to quote, fast enough to read along."
            visual={<TranscriptVisual />}
          />
          <FeatureRow
            icon={ListChecks}
            kicker="Synthesis"
            title="Notes, decisions & action items"
            body="The moment a call ends, MeetBase delivers a structured recap: what was decided, who owns what, and the open questions left on the table. No more reconstructing a meeting from memory."
            visual={<SummaryVisual />}
          />
          <FeatureRow
            reverse
            icon={FolderKanban}
            kicker="Organization"
            title="Every meeting sorted into Spaces"
            body="MeetBase files each call under the client, project, or topic it belongs to — automatically. Open a Space and see the full history: notes, decisions, and action items in one place."
            visual={<SpacesVisual />}
          />
          <FeatureRow
            icon={Search}
            kicker="Memory"
            title="Chat with your entire meeting history"
            body="Ask 'what did we decide about pricing last month?' or 'what are my open action items?' and get an answer grounded in the transcript — with the exact moment it was said."
            visual={<RecallVisual />}
          />
        </div>
      </Container>
    </section>
  );
}

function FeatureRow({
  icon: Icon,
  kicker,
  title,
  body,
  visual,
  reverse,
}: {
  icon: React.ComponentType<{ className?: string }>;
  kicker: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={reverse ? "lg:order-2" : ""}>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs font-medium text-primary">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {kicker}
        </span>
        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>{visual}</div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="card-ring rounded-2xl p-5 shadow-xl shadow-black/30 sm:p-6">{children}</div>
  );
}

function JoinVisual() {
  return (
    <Frame>
      <div className="space-y-3">
        {[
          { t: "9:00", n: "Standup", on: false },
          { t: "11:30", n: "Q3 planning", on: true },
          { t: "2:00", n: "Customer · Acme", on: true },
        ].map((m) => (
          <div
            key={m.n}
            className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted-foreground">{m.t}</span>
              <span className="text-sm text-foreground">{m.n}</span>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                m.on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${m.on ? "bg-primary" : "bg-muted-foreground"}`} aria-hidden />
              {m.on ? "MeetBase joining" : "Off"}
            </span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function TranscriptVisual() {
  return (
    <Frame>
      <div className="space-y-4 text-sm">
        {[
          { who: "Dana", t: "08:42", text: "Let's lock the launch date this week." },
          { who: "Sam", t: "08:49", text: "I can confirm engineering is ready by the 12th." },
          { who: "Dana", t: "08:55", text: "Great — let's say the 15th to be safe." },
        ].map((l) => (
          <div key={l.t} className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
              {l.who[0]}
            </span>
            <div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{l.who}</span> · {l.t}
              </p>
              <p className="text-foreground">{l.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function SummaryVisual() {
  return (
    <Frame>
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Recap</p>
      <div className="mt-3 space-y-4 text-sm">
        <div>
          <p className="text-xs font-medium text-primary">Decisions</p>
          <p className="text-foreground">Launch on the 15th; engineering ready by the 12th.</p>
        </div>
        <div>
          <p className="text-xs font-medium text-primary">Action items</p>
          <ul className="mt-1 space-y-1 text-foreground">
            <li>@Sam — freeze scope by Friday.</li>
            <li>@Dana — brief the GTM team.</li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-primary">Open questions</p>
          <p className="text-foreground">Do we run a phased rollout?</p>
        </div>
      </div>
    </Frame>
  );
}

function SpacesVisual() {
  return (
    <Frame>
      <div className="space-y-3">
        {[
          { n: "Acme · Customer", meetings: 12 },
          { n: "Q3 Planning", meetings: 5 },
          { n: "Hiring", meetings: 3 },
        ].map((s) => (
          <div
            key={s.n}
            className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/12 text-primary">
                <FolderKanban className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="text-sm text-foreground">{s.n}</span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{s.meetings} meetings</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function RecallVisual() {
  return (
    <Frame>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2.5">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-sm text-foreground">What did we decide about pricing?</span>
      </div>
      <div className="mt-4 rounded-lg border-l-2 border-primary bg-secondary/30 p-3 text-sm">
        <p className="text-foreground">
          On June 3, the team agreed to launch pricing v2 on the 15th and grandfather legacy plans
          for 90 days.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Source · Q3 planning · 11:30 · Dana</p>
      </div>
    </Frame>
  );
}
