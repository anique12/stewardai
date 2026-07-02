-- Per-user IANA timezone (e.g. 'Asia/Karachi', 'America/New_York'), set by the
-- user in Settings. Calendar actions use it so "4 PM" means the user's local time
-- (the create-event tool otherwise assumes UTC). Nullable → falls back to UTC.
alter table public.profiles
  add column if not exists timezone text;
