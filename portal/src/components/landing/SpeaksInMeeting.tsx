import { Volume2, EarOff, CheckCircle2 } from "lucide-react";
import { Container, SectionHeading } from "./primitives";
import { VoiceDemoDialog } from "./VoiceDemoDialog";

// A spoken exchange shown as a "you → Steward" pair. `aloud` is what Steward
// says back out loud; `note` is a small honesty/affordance caption under it.
// `pending` marks the act-on-request example, whose reply is framed as the
// product vision (rolling out) rather than something every app supports today.
type Exchange = {
  you: string;
  aloud: string;
  note: string;
  pending?: boolean;
};

const EXCHANGES: Exchange[] = [
  {
    you: "Steward, what did we decide about pricing?",
    aloud:
      "You landed on launching v2 on the 15th and grandfathering legacy plans for 90 days.",
    note: "Answers aloud — grounded in the live transcript.",
  },
  {
    you: "Steward, summarize where we are.",
    aloud:
      "Three decisions, two open questions. Engineering's ready by the 12th; rollout phasing is still up in the air.",
    note: "Speaks the recap, mid-meeting, on request.",
  },
  {
    you: "Steward, book a follow-up with Priya for Friday.",
    aloud: "On it — I'll set up Friday at 3 and send Priya the invite.",
    note: "Acting on spoken requests — rolling out across your connected apps.",
    pending: true,
  },
];

// The "while other tools quietly transcribe…" contrast — no competitor names.
const CONTRAST = [
  {
    Icon: EarOff,
    label: "Other notetakers",
    body: "Sit silent in the corner. Listen, transcribe, and hand you a wall of text after the call.",
    them: true,
  },
  {
    Icon: Volume2,
    label: "Steward",
    body: "Has a voice in the room. Address it and it answers out loud, in real time — then still writes the recap.",
    them: false,
  },
];

export function SpeaksInMeeting() {
  return (
    <section
      id="speaks"
      className="relative overflow-hidden border-t border-border bg-card/30 py-20 sm:py-28"
    >
      {/* Ambient glow echoing the hero, anchored to the spoken-exchange side. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute right-[-10%] top-1/4 h-[420px] w-[620px] rounded-full bg-primary/10 blur-[130px]" />
      </div>

      <Container className="relative">
        <SectionHeading
          eyebrow="The difference · it talks back"
          title={
            <>
              Not a silent recorder — <span className="accent-text">a participant</span>.
            </>
          }
          lead="Every other notetaker just listens and transcribes. Steward is a real-time voice agent in the meeting: ask it a question and it answers out loud, tell it to summarize and it speaks the recap, ask it to do something and it goes and does it."
        />

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          {/* Left: the passive-vs-participant contrast. */}
          <div className="flex flex-col gap-3">
            {CONTRAST.map(({ Icon, label, body, them }) => (
              <div
                key={label}
                className={`card-ring rounded-2xl p-5 transition-colors ${
                  them ? "opacity-80" : "border-primary/30"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                      them
                        ? "bg-secondary text-muted-foreground"
                        : "bg-primary/12 text-primary"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span
                    className={`text-[11px] font-medium uppercase tracking-wider ${
                      them ? "text-muted-foreground" : "text-primary"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
            <p className="px-1 text-xs leading-relaxed text-muted-foreground/70">
              While other tools quietly transcribe in the background, Steward is the
              one teammate in the call you can actually talk to.
            </p>
          </div>

          {/* Right: the spoken exchanges — a "you ↔ Steward" conversation. */}
          <div className="card-ring overflow-hidden rounded-2xl shadow-2xl shadow-black/40">
            <div className="flex items-center gap-2 border-b border-border bg-background/60 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-primary/70" aria-hidden />
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                steward · in the meeting
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-primary">
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
                  aria-hidden
                />
                live
              </span>
            </div>

            <ul className="flex flex-col gap-6 p-5 sm:p-6">
              {EXCHANGES.map((ex) => (
                <li key={ex.you} className="flex flex-col gap-2.5">
                  {/* You — right-aligned speech bubble. */}
                  <div className="flex justify-end">
                    <p className="max-w-[88%] rounded-2xl rounded-br-sm border border-border bg-secondary/40 px-3.5 py-2 text-[13px] leading-snug text-foreground">
                      {ex.you}
                    </p>
                  </div>

                  {/* Steward — left-aligned, voice orb + waveform, spoken aloud. */}
                  <div className="flex items-start gap-2.5">
                    <SpeakingOrb />
                    <div className="min-w-0 flex-1">
                      <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-primary/25 bg-primary/[0.07] px-3.5 py-2.5">
                        <span className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                          <Volume2 className="h-3 w-3" aria-hidden />
                          Steward · aloud
                        </span>
                        <p className="text-[13px] leading-snug text-foreground">
                          {ex.aloud}
                        </p>
                      </div>
                      <p
                        className={`mt-1.5 flex items-center gap-1.5 pl-1 text-[11px] ${
                          ex.pending ? "text-muted-foreground" : "text-muted-foreground/80"
                        }`}
                      >
                        {ex.pending ? (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"
                            aria-hidden
                          />
                        ) : (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-primary/70" aria-hidden />
                        )}
                        {ex.note}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col items-start gap-3 border-t border-border bg-background/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Same real-time voice engine that powers the demo.
              </p>
              <VoiceDemoDialog
                variant="outline"
                label="Talk to Steward"
                className="px-4 py-2 text-xs"
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

// A small, hollow voice orb echoing the "Talk to Steward" visualizer: two
// concentric rings with a soft glow and a gentle live pulse, marking lines
// Steward speaks out loud. Purely decorative.
function SpeakingOrb() {
  return (
    <span
      aria-hidden
      className="relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full"
    >
      <span className="absolute inset-0 rounded-full bg-primary/15 blur-[6px]" />
      <span className="absolute inset-0 animate-ping rounded-full border border-primary/40 opacity-30" />
      <span className="absolute inset-0 rounded-full border border-primary/50" />
      <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
    </span>
  );
}
