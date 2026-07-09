// Meetings without a usable transcript get a "summary" that is really the LLM
// refusing ("No meeting transcript was provided…", "Please provide the
// transcript…"). That text is noise in a list, so treat it as no-summary.
const REFUSAL_PATTERNS: RegExp[] = [
  /no .*transcript.*(was )?provided/,
  /please provide .*transcript/,
  /i need a .*transcript/,
  /no (meeting )?summary can be generated/,
  /no summary.*can be (generated|extracted)/,
  /transcript.*to summarize/,
];

// Returns the tldr if it looks like a real summary, otherwise null.
export function cleanTldr(tldr: string | null | undefined): string | null {
  if (!tldr) return null;
  const trimmed = tldr.trim();
  if (!trimmed) return null;
  const low = trimmed.toLowerCase();
  if (REFUSAL_PATTERNS.some((re) => re.test(low))) return null;
  return trimmed;
}
