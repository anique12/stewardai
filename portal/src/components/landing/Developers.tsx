"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Container, SectionHeading } from "./primitives";
import { CopyButton } from "./CopyButton";

type Sample = { lang: string; code: string };

const STT: Sample[] = [
  {
    lang: "cURL",
    code: `curl https://api.stewardai.com/v1/listen \\
  -H "Authorization: Bearer $STEWARD_API_KEY" \\
  -H "Content-Type: audio/wav" \\
  --data-binary @call.wav \\
  -d model=steward-stt-1 \\
  -d diarize=true \\
  -d language=auto`,
  },
  {
    lang: "Python",
    code: `from stewardai import Steward

client = Steward(api_key=os.environ["STEWARD_API_KEY"])

result = client.stt.transcribe(
    audio=open("call.wav", "rb"),
    model="steward-stt-1",
    diarize=True,        # speaker labels
    language="auto",     # 25+ languages
    timestamps="word",
)

for turn in result.turns:
    print(f"[{turn.speaker}] {turn.text}")`,
  },
  {
    lang: "JavaScript",
    code: `import { Steward } from "@stewardai/sdk";

const client = new Steward({ apiKey: process.env.STEWARD_API_KEY });

// Stream a live mic / call socket and get partials as you go
const stream = client.stt.stream({
  model: "steward-stt-1",
  diarize: true,
  language: "auto",
});

stream.on("transcript", ({ speaker, text, isFinal }) => {
  if (isFinal) console.log(\`[\${speaker}] \${text}\`);
});`,
  },
];

const TTS: Sample[] = [
  {
    lang: "cURL",
    code: `curl https://api.stewardai.com/v1/speak \\
  -H "Authorization: Bearer $STEWARD_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "steward-tts-1",
    "voice": "ava",
    "text": "Your meeting recap is ready.",
    "format": "pcm_16000",
    "stream": true
  }' --output reply.pcm`,
  },
  {
    lang: "Python",
    code: `from stewardai import Steward

client = Steward(api_key=os.environ["STEWARD_API_KEY"])

# Stream audio bytes as they're synthesized — first byte in ~90ms
with client.tts.stream(
    model="steward-tts-1",
    voice="ava",
    text="Your meeting recap is ready.",
    format="pcm_16000",
) as audio:
    for chunk in audio:
        speaker.write(chunk)`,
  },
  {
    lang: "JavaScript",
    code: `import { Steward } from "@stewardai/sdk";

const client = new Steward({ apiKey: process.env.STEWARD_API_KEY });

const audio = await client.tts.stream({
  model: "steward-tts-1",
  voice: "ava",
  text: "Your meeting recap is ready.",
  format: "pcm_16000",
});

for await (const chunk of audio) {
  player.push(chunk); // play as it arrives
}`,
  },
];

export function Developers() {
  return (
    <section id="developers" className="border-y border-border bg-card/30 py-20 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow="Developer products"
          title="Speech APIs you can ship today"
          lead="Production-grade speech-to-text and text-to-speech behind a clean API. Streaming-first, multilingual, and priced per use — drop them into your own product."
        />

        <div className="mt-12 grid items-stretch gap-8 lg:grid-cols-2">
          <ApiCard
            id="stt"
            name="Speech-to-Text"
            tagline="POST /v1/listen"
            samples={STT}
            specs={[
              ["Latency", "~120ms partials"],
              ["Languages", "25+, auto-detect"],
              ["Features", "diarization · word timestamps"],
            ]}
          />
          <ApiCard
            id="tts"
            name="Text-to-Speech"
            tagline="POST /v1/speak"
            samples={TTS}
            specs={[
              ["First byte", "~90ms"],
              ["Output", "PCM · MP3 · streaming"],
              ["Control", "SSML · voices · pacing"],
            ]}
          />
        </div>
      </Container>
    </section>
  );
}

function ApiCard({
  id,
  name,
  tagline,
  samples,
  specs,
}: {
  id: string;
  name: string;
  tagline: string;
  samples: Sample[];
  specs: [string, string][];
}) {
  const [active, setActive] = useState(samples[0].lang);
  const current = samples.find((s) => s.lang === active) ?? samples[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{name}</h3>
          <p className="mt-0.5 font-mono text-xs text-primary">{tagline}</p>
        </div>
      </div>

      <Tabs value={active} onValueChange={setActive} className="mt-4 flex flex-1 flex-col">
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-[#0a0e14]">
          <div className="flex items-center justify-between border-b border-border bg-background/40 px-2">
            <TabsList className="h-auto gap-0.5 bg-transparent p-1.5">
              {samples.map((s) => (
                <TabsTrigger
                  key={s.lang}
                  value={s.lang}
                  className="rounded-md px-3 py-1.5 text-xs data-[state=active]:bg-secondary data-[state=active]:text-foreground"
                >
                  {s.lang}
                </TabsTrigger>
              ))}
            </TabsList>
            <CopyButton text={current.code} />
          </div>
          {samples.map((s) => (
            <TabsContent key={s.lang} value={s.lang} className="mt-0 flex-1 data-[state=active]:flex">
              {/* Stable min-height fits the tallest tab so switching cURL/Python/JS
                  does not change the panel height (no reflow/jump). */}
              <pre className="h-full min-h-[20rem] w-full overflow-auto p-4 text-[12.5px] leading-relaxed">
                <code className="font-mono text-foreground/90">{highlight(s.code)}</code>
              </pre>
            </TabsContent>
          ))}
        </div>
      </Tabs>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        {specs.map(([k, v]) => (
          <div key={k} className="flex h-full min-h-[4.75rem] flex-col rounded-lg border border-border bg-background/40 p-3">
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd className="mt-1 text-xs font-medium text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      <span className="sr-only">{id}</span>
    </div>
  );
}

/**
 * Lightweight token highlighter — comments, strings, and a small keyword set.
 * Kept dependency-free and deterministic.
 */
function highlight(code: string): React.ReactNode {
  const lines = code.split("\n");
  return lines.map((line, li) => (
    <span key={li} className="block">
      {highlightLine(line)}
      {li < lines.length - 1 ? "\n" : ""}
    </span>
  ));
}

const KEYWORDS = new Set([
  "import", "from", "for", "in", "with", "as", "await", "const", "new", "if", "true", "false",
  "print", "open", "os.environ",
]);

function highlightLine(line: string): React.ReactNode {
  const commentIdx = findCommentStart(line);
  if (commentIdx !== -1) {
    return (
      <>
        {highlightCode(line.slice(0, commentIdx))}
        <span className="text-muted-foreground/70">{line.slice(commentIdx)}</span>
      </>
    );
  }
  return highlightCode(line);
}

function findCommentStart(line: string): number {
  // naive: # outside quotes, or //
  const hash = line.indexOf("#");
  const slash = line.indexOf("//");
  const idxs = [hash, slash].filter((i) => i !== -1);
  return idxs.length ? Math.min(...idxs) : -1;
}

function highlightCode(text: string): React.ReactNode {
  // Split on string literals and tokens.
  const parts = text.split(/("[^"]*"|'[^']*')/g);
  return parts.map((part, i) => {
    if (/^["']/.test(part)) {
      return (
        <span key={i} className="text-primary">
          {part}
        </span>
      );
    }
    // keyword pass within non-string segments
    const tokens = part.split(/(\b)/);
    return (
      <span key={i}>
        {tokens.map((tok, j) =>
          KEYWORDS.has(tok) ? (
            <span key={j} className="text-sky-400">
              {tok}
            </span>
          ) : (
            <span key={j}>{tok}</span>
          ),
        )}
      </span>
    );
  });
}
