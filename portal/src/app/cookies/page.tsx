import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/Nav";
import { LandingFooter } from "@/components/landing/Footer";
import { Container } from "@/components/landing/primitives";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "How MeetBase uses cookies and similar technologies.",
};

export default function CookiePage() {
  return (
    <>
      <LandingNav />
      <main className="py-20">
        <Container>
          <div className="mx-auto max-w-3xl">
            {/* header */}
            <div className="mb-12 border-b border-border pb-8">
              <p className="text-xs font-medium uppercase tracking-widest text-primary mb-3">Legal</p>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">Cookie Policy</h1>
              <p className="mt-3 text-sm text-muted-foreground">Last updated: June 30, 2026</p>
            </div>

            {/* prose sections */}
            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">1. Introduction</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              Cookies are small text files that a website stores on your device when you visit it. They are widely
              used to make websites work, to keep you signed in, and to remember information about your session. This
              Cookie Policy explains how MeetBase uses cookies and similar technologies, and the choices you have.
              It should be read alongside our{" "}
              <a href="/privacy" className="text-primary underline-offset-4 hover:underline">Privacy Policy</a>.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">2. How We Use Cookies</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We currently use only <strong className="text-foreground">strictly necessary</strong> cookies — the
              cookies required for MeetBase to function and to keep your account secure. Specifically:
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              (a) <strong className="text-foreground">Authentication &amp; session cookies</strong> — set via our
              authentication provider, Supabase, to keep you signed in and to secure your session as you move
              between pages. Without these, you would be unable to log in or stay logged in.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              (b) <strong className="text-foreground">Hosting &amp; CDN cookies</strong> — basic cookies set by our
              hosting and content-delivery provider, Vercel, for security and load balancing so that requests are
              routed correctly and the service stays available.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              Because these cookies are essential to providing the service you have requested, they do not require
              consent under most applicable laws.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">3. What We Don&apos;t (Yet) Use</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We do not currently use advertising, marketing, or third-party analytics or tracking cookies. We do
              not build advertising profiles or sell your data. If we introduce analytics or marketing cookies in
              the future, we will update this policy and, where required by law, ask for your consent first before
              setting any non-essential cookies.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">4. Managing Cookies</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              You can control and clear cookies through your browser settings — most browsers let you block or
              delete cookies for specific sites or all sites. Please note that because MeetBase currently uses
              only strictly necessary cookies, disabling them will break sign-in and core functionality, and you may
              not be able to use the service.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">5. Changes to This Policy</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We may update this Cookie Policy from time to time. When we do, we will post the revised policy here
              with an updated date. We encourage you to review this page periodically to stay informed about how we
              use cookies.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">6. Contact</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              For questions about this Cookie Policy or our use of cookies, contact us at [privacy@...].
            </p>
          </div>
        </Container>
      </main>
      <LandingFooter />
    </>
  );
}
