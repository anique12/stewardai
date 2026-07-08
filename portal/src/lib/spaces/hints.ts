export type HintEntity = {
  kind: "person" | "company";
  email: string | null;
  domain: string | null;
};

export type FilingHintRow = {
  user_id: string;
  kind: "attendee_email" | "domain";
  value: string;
  space_id: string;
  weight: number;
};

function domainOf(email: string | null): string | null {
  if (email && email.includes("@")) return email.split("@", 2)[1].trim().toLowerCase() || null;
  return null;
}

/** Derive filing_hints rows teaching that these entities → this space. A person's
 *  email becomes an attendee_email hint; a company's domain (explicit or from its
 *  email) becomes a domain hint. Values are lower-cased and de-duplicated. */
export function deriveHints(entities: HintEntity[], spaceId: string, userId: string): FilingHintRow[] {
  const seen = new Set<string>();
  const rows: FilingHintRow[] = [];
  const push = (kind: "attendee_email" | "domain", raw: string | null) => {
    if (!raw) return;
    const value = raw.trim().toLowerCase();
    if (!value) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ user_id: userId, kind, value, space_id: spaceId, weight: 1 });
  };
  for (const ent of entities) {
    if (ent.kind === "person") push("attendee_email", ent.email);
    else if (ent.kind === "company") push("domain", ent.domain ?? domainOf(ent.email));
  }
  return rows;
}
