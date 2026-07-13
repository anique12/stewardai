// Client-safe: no Node built-ins here (this is imported by client components
// like AttendeeAvatars). Node-only helpers (md5/Gravatar hashing) live in
// ./attendees.ts instead.

export type Attendee = {
  email: string;
  name: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
  photoUrl?: string | null;
};

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]);
  return (chars.join("") || base[0] || "?").toUpperCase();
}
