import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/Nav";
import { LandingFooter } from "@/components/landing/Footer";
import { Container } from "@/components/landing/primitives";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing your use of the StewardAI platform.",
};

export default function TermsPage() {
  return (
    <>
      <LandingNav />
      <main className="py-20">
        <Container>
          <div className="mx-auto max-w-3xl">
            {/* header */}
            <div className="mb-12 border-b border-border pb-8">
              <p className="text-xs font-medium uppercase tracking-widest text-primary mb-3">Legal</p>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">Terms of Service</h1>
              <p className="mt-3 text-sm text-muted-foreground">Last updated: June 30, 2026</p>
            </div>

            {/* prose sections */}
            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">1. Acceptance of Terms</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              By accessing or using StewardAI, you agree to be bound by these Terms. If you do not agree, you may
              not use the Service. These Terms form a binding agreement between you and [Legal Entity Name].
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">2. Description of Service</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              StewardAI is an AI-powered personal assistant that:
            </p>
            <ul className="mb-4 space-y-1.5 pl-5 text-muted-foreground list-disc">
              <li className="leading-7">
                connects to your Google Calendar via OAuth to identify and schedule meetings;
              </li>
              <li className="leading-7">
                dispatches a bot to join video meetings you opt in to, as a visible named participant, to capture
                audio and generate transcripts, summaries, decisions, and action items;
              </li>
              <li className="leading-7">
                provides a dashboard to review and manage your meeting records.
              </li>
            </ul>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">3. Eligibility &amp; Accounts</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              You must be at least 18 years old to use StewardAI. You are responsible for maintaining the
              confidentiality of your credentials and all activity under your account. You must provide accurate
              information when creating your account.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">4. Acceptable Use</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              You agree not to: use the Service for any illegal purpose; record meetings without legally required
              consent; use the Service to harm others; attempt to reverse-engineer, scrape, or circumvent security
              measures; transmit malware; or resell the Service without authorisation. We may suspend or terminate
              accounts that violate these terms.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">5. Meeting Recording Responsibilities</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              By enabling the StewardAI bot for a meeting, you represent and warrant that:
            </p>
            <ul className="mb-4 space-y-1.5 pl-5 text-muted-foreground list-disc">
              <li className="leading-7">
                (a) you are authorised to record that meeting;
              </li>
              <li className="leading-7">
                (b) you have obtained all necessary consents from all participants as required by applicable law
                (including all-party consent laws); and
              </li>
              <li className="leading-7">
                (c) your use complies with all applicable recording, wiretapping, and privacy laws.
              </li>
            </ul>
            <p className="mb-4 leading-7 text-muted-foreground">
              The bot joins as a named, visible participant — it does not record covertly. You assume full legal
              responsibility for recording consent compliance.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">6. Google/Calendar Integration</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              By authorising Google Calendar access, you grant StewardAI permission to read your calendar data to
              provide calendar-sync functionality. You may revoke this authorisation at any time via your Google
              Account or in StewardAI settings. Revocation does not affect prior processing performed under your
              authorisation.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">7. Plans &amp; Billing</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              StewardAI is currently free during our beta period. We reserve the right to introduce paid plans
              with at least 30 days&apos; notice to existing users. No credit card is required during beta.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">8. Your Content &amp; Data</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              You retain ownership of your data including meeting content, transcripts, and summaries. By using
              the Service, you grant StewardAI a limited, non-exclusive, royalty-free licence to process, store,
              and display your data solely to provide the Service. We do not use your data to train AI models. See
              our{" "}
              <a href="/privacy" className="text-primary underline-offset-4 hover:underline">Privacy Policy</a>{" "}
              for details.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">9. Intellectual Property</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              The StewardAI platform, software, design, and documentation are owned by [Legal Entity Name] and
              protected by intellectual property laws. You may not copy, modify, distribute, or create derivative
              works without our written permission.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">10. Third-Party Services</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              StewardAI integrates with Google, Supabase, Deepgram, and others. Your use of those services is
              governed by their respective terms. We are not responsible for third-party practices.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">11. Disclaimers</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              AI-generated transcripts, summaries, and action items may be inaccurate, incomplete, or misleading.
              They are provided for convenience only and are not professional, legal, medical, or financial advice.
              Do not rely on them for critical decisions without independent verification. THE SERVICE IS PROVIDED
              &ldquo;AS IS&rdquo; WITHOUT WARRANTIES OF ANY KIND.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">12. Limitation of Liability</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, STEWARDAI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
              SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES. OUR TOTAL LIABILITY SHALL NOT EXCEED AMOUNTS YOU PAID
              US IN THE TWELVE MONTHS PRECEDING THE CLAIM.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">13. Indemnification</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              You agree to indemnify StewardAI from claims arising from: your use of the Service; your violation
              of these Terms; your violation of recording consent laws; or your content.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">14. Termination</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We may suspend or terminate your access for violation of these Terms. You may terminate your account
              at any time in settings. Upon termination, your data will be handled per our Privacy Policy.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">15. Governing Law</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              These Terms are governed by the laws of [Governing Law Jurisdiction]. Disputes shall be resolved in
              the courts of [Governing Law Jurisdiction].
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">16. Changes to Terms</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We may update these Terms. Material changes will be communicated at least 14 days in advance.
              Continued use after the effective date constitutes acceptance.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">17. Contact</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              [legal@...], [Legal Entity Name], [Registered Address].
            </p>
          </div>
        </Container>
      </main>
      <LandingFooter />
    </>
  );
}
