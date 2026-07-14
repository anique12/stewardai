import type { calendar_v3 } from "googleapis";
import { gravatarUrl, initials, type Attendee } from "@/lib/meetings/attendee-types";

// Server-side calendar sync lives here. `Attendee`/`initials`/`gravatarUrl`
// are just re-exported for convenience — the real (client-safe, dependency-
// free) implementations live in `@/lib/meetings/attendee-types` so they can
// also be imported directly from client components (e.g. PersonAvatar).
export type { Attendee };
export { initials, gravatarUrl };

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
