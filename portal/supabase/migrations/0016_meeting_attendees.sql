-- Persist calendar attendees on each meeting so the portal can show real
-- names/initials + best-effort real photos (Gravatar), never fake avatars.
-- Shape per attendee: { email, name, responseStatus, organizer, self, photoUrl }.
alter table public.meetings
  add column if not exists attendees jsonb not null default '[]'::jsonb;
