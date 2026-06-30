import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/Nav";
import { LandingFooter } from "@/components/landing/Footer";
import { Container } from "@/components/landing/primitives";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How StewardAI collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <>
      <LandingNav />
      <main className="py-20">
        <Container>
          <div className="mx-auto max-w-3xl">
            {/* header */}
            <div className="mb-12 border-b border-border pb-8">
              <p className="text-xs font-medium uppercase tracking-widest text-primary mb-3">Legal</p>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
              <p className="mt-3 text-sm text-muted-foreground">Last updated: June 30, 2026</p>
            </div>

            {/* prose sections */}
            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">1. Introduction</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              StewardAI (operated by [Legal Entity Name], [Registered Address]) provides an AI-powered personal
              assistant that joins your meetings, transcribes them, and syncs your Google Calendar. This Privacy
              Policy describes how we collect, use, and protect information when you use our services. If you do
              not agree, please do not use StewardAI. Effective date: June 30, 2026.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">2. Information We Collect</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              (a) <strong className="text-foreground">Account &amp; identity</strong> — When you sign in with Google,
              we receive your name, email address, and profile picture via Google Sign-In (OAuth 2.0).
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              (b) <strong className="text-foreground">Google Calendar data</strong> — With your authorisation,
              StewardAI accesses your Google Calendar via the Google Calendar API using a read-only OAuth scope. We
              store your OAuth refresh token to sync your calendar on your behalf. We access event titles, dates
              and times, attendee lists, and conference/Google Meet links.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              (c) <strong className="text-foreground">Meeting content</strong> — When you opt a specific meeting in,
              our bot joins as a named, visible participant. We capture the meeting audio and use it to generate
              transcripts, summaries, decisions, and action items. We store these outputs linked to your account.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              (d) <strong className="text-foreground">Usage and technical data</strong> — We collect standard server
              logs, device/browser information, IP addresses, and in-product usage events to operate and improve
              the service.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              (e) <strong className="text-foreground">Cookies</strong> — We use strictly necessary cookies to keep
              you signed in and to secure your session. For details on the cookies we use and how to manage them,
              see our <a href="/cookies" className="text-primary underline-offset-4 hover:underline">Cookie Policy</a>.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">3. How We Use Your Information</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We use your information to: provide and operate the StewardAI service; generate, store, and display
              transcripts, summaries, decisions, and action items; authenticate you and secure your account; detect
              abuse, debug issues, and improve the service; communicate with you about the service. We do not use
              your data for advertising or sell it to third parties.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">4. Meeting Recording &amp; Consent (Important)</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              Our meeting bot joins as a named, visible participant — it does not record covertly or impersonate a
              human. The bot&apos;s display name makes its presence apparent to all participants. You are responsible
              for ensuring all meeting participants are informed and that you have the legal right to record, prior
              to enabling the StewardAI bot for any meeting.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              Recording consent laws vary significantly by jurisdiction. Many jurisdictions — including several US
              states (e.g., California, Illinois) and EU member states under the GDPR — require all-party consent
              before a conversation may be recorded. It is your obligation to comply with applicable law.
              StewardAI provides tooling to support compliance: the bot is always visible, and you can remove it
              from any meeting at any time to stop recording.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">5. How We Share Information / Sub-processors</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We do not sell your personal data. We share information only with service providers
              (&ldquo;sub-processors&rdquo;) that help us operate the service, under appropriate data processing
              agreements.
            </p>
            <div className="overflow-x-auto my-6">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="border border-border px-4 py-2 text-left font-medium text-foreground bg-card/50">Provider</th>
                    <th className="border border-border px-4 py-2 text-left font-medium text-foreground bg-card/50">Purpose</th>
                    <th className="border border-border px-4 py-2 text-left font-medium text-foreground bg-card/50">Data shared</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Google LLC</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Sign-in (OAuth), Google Calendar API, AI summarization (Gemini API)</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Identity data, calendar data, transcript text</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Supabase, Inc.</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Database, authentication, file storage</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Account data, calendar data, transcripts, summaries, OAuth tokens</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Deepgram, Inc.</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Speech-to-text transcription (where cloud speech services are used)</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Meeting audio, transcript text</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Vercel Inc.</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Web application hosting</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Technical and usage data</td>
                  </tr>
                  <tr>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Hetzner Online GmbH (Germany, EU)</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Backend processing and meeting-bot infrastructure</td>
                    <td className="border border-border px-4 py-2 text-muted-foreground">Meeting audio and transcript text during processing</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mb-4 leading-7 text-muted-foreground">
              This list reflects our current architecture and may be updated. Contact us at [privacy@...] for
              the current list.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">6. AI Processing &amp; Training</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We do not use your meeting content, transcripts, summaries, or other personal data to train our own
              AI models or any third-party foundation models. Our AI sub-processors (including Google Gemini) are
              contractually restricted from training on your data when accessed via their API.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">7. Data Retention &amp; Deletion</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We retain your data for as long as your account is active. You may delete individual meetings and
              their transcripts/summaries from within the app at any time, or delete your account entirely which
              removes all associated personal data. Account deletion can be initiated in app settings or by
              contacting us at [privacy@...].
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">8. Security</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We protect your data with: encryption in transit (TLS/HTTPS) and at rest; row-level security for
              per-user data isolation; restricted and logged internal access. For more detail, see our{" "}
              <a href="/trust" className="text-primary underline-offset-4 hover:underline">Trust &amp; Security page</a>.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">9. Your Privacy Rights</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              <strong className="text-foreground">GDPR (EU/EEA):</strong> you have the right to access, rectify,
              erase, and port your personal data; to restrict or object to processing; and to withdraw consent.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              <strong className="text-foreground">CCPA (California):</strong> you have the right to know what data
              we collect, to request deletion, and to opt out of sale of personal data — we do not sell personal
              data.
            </p>
            <p className="mb-4 leading-7 text-muted-foreground">
              Contact [privacy@...] to exercise any rights.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">10. Google API Limited Use Disclosure</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              StewardAI&apos;s use of information received from Google APIs adheres to the Google API Services User
              Data Policy, including the Limited Use requirements. We use Google user data only to provide and
              improve the features visible to the user within StewardAI; we do not use it for serving ads, for
              unauthorized data sharing, or for purposes unrelated to the service.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">11. International Data Transfers</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              Your data may be processed in the United States and the European Union. Where data is transferred
              from the EEA, we rely on appropriate legal mechanisms such as Standard Contractual Clauses.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">12. Children</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              StewardAI is not directed to individuals under the age of 16. We do not knowingly collect personal
              data from children. If you believe we have inadvertently collected data from a minor, contact us at
              [privacy@...] and we will delete it promptly.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">13. Changes to This Policy</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              We may update this policy from time to time. When we do, we will post the revised policy with an
              updated effective date. Material changes will be communicated via email or in-app notice.
            </p>

            <h2 className="mt-12 mb-4 text-xl font-semibold text-foreground">14. Contact</h2>
            <p className="mb-4 leading-7 text-muted-foreground">
              For privacy-related questions or to exercise your rights: [privacy@...], [Legal Entity Name],
              [Registered Address].
            </p>
          </div>
        </Container>
      </main>
      <LandingFooter />
    </>
  );
}
