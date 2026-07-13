import { createHash } from "crypto";
import type { calendar_v3 } from "googleapis";
import { initials, type Attendee } from "@/lib/meetings/attendee-types";

// Node-only module (uses `crypto`) — server-side use only (calendar sync).
// Client components must import `Attendee`/`initials` from
// `@/lib/meetings/attendee-types` instead, so a Node built-in never ends up
// in the browser bundle.
export type { Attendee };
export { initials };

// Gravatar keyed by the MD5 hash of the trimmed, lowercased email. `d=404`
// makes Gravatar 404 instead of serving a generated placeholder when there's
// no real photo for the address, so the client can fall back to initials —
// we only ever show a REAL photo, never a fake/generated one.
export function gravatarUrl(email: string): string {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=404&s=96`;
}

// Google Calendar attendee -> our stored Attendee shape. Skips conference
// rooms/resources (`resource: true`) since those aren't people.
export function attendeesFromEvent(event: calendar_v3.Schema$Event | { attendees?: unknown }): Attendee[] {
  const raw = (event as { attendees?: unknown }).attendees;
  if (!Array.isArray(raw)) return [];
  const out: Attendee[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const att = a as calendar_v3.Schema$EventAttendee;
    if (att.resource) continue;
    const email = (att.email ?? "").trim();
    if (!email) continue;
    const name = (att.displayName ?? "").trim() || email.split("@")[0];
    out.push({
      email,
      name,
      responseStatus: att.responseStatus ?? undefined,
      organizer: att.organizer ?? undefined,
      self: att.self ?? undefined,
      photoUrl: gravatarUrl(email),
    });
  }
  return out;
}
