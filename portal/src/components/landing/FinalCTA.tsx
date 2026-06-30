import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "./primitives";
import { VoiceDemoDialog } from "./VoiceDemoDialog";

export function FinalCTA() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="card-ring relative overflow-hidden rounded-3xl px-6 py-16 text-center sm:px-12 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-0 h-72 w-[640px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
            <div className="absolute inset-0 bg-grid opacity-40" />
          </div>
          <div className="relative">
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Meet your Steward.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
              Put a personal agent in every meeting — or build your own on the voice stack
              behind it. Start free in under a minute.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/auth/login"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Start free
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <VoiceDemoDialog variant="outline" />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
