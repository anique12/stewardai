-- Groups occurrences of a recurring calendar event into one series. Populated
-- from Google's event.recurringEventId; null for one-off events (and for rows
-- written before this column existed — the portal derives a fallback key from
-- google_event_id at read time).
alter table public.meetings add column if not exists recurring_event_id text;
