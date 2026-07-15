-- Email system: outbox (single send funnel), per-user prefs, suppression list.
-- profiles.email lets the backend resolve an owner's address without an auth-admin call.

alter table public.profiles
  add column if not exists email text;

create table if not exists public.email_outbox (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in (
                  'welcome','calendar_connected','bot_failed','meeting_notes',
                  'meeting_prep','digest','action_reminder','manual_share')),
  to_email      text not null,
  meeting_id    uuid references public.meetings(id) on delete cascade,
  dedup_key     text not null unique,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending','sent','failed','suppressed','canceled')),
  attempts      int not null default 0,
  last_error    text,
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists email_outbox_due_idx
  on public.email_outbox (status, scheduled_for);

create table if not exists public.email_prefs (
  user_id                       uuid primary key references auth.users(id) on delete cascade,
  notes_enabled                 boolean not null default true,
  notes_recipients              text not null default 'only_me'
                                  check (notes_recipients in ('only_me','everyone')),
  notes_include_transcript_link boolean not null default true,
  prep_enabled                  boolean not null default false,
  prep_recipients               text not null default 'only_me'
                                  check (prep_recipients in ('only_me','everyone')),
  digest_frequency              text not null default 'off'
                                  check (digest_frequency in ('off','daily','weekly')),
  action_reminders_enabled      boolean not null default false
);

create table if not exists public.email_suppressions (
  email      text primary key,
  reason     text not null check (reason in ('unsubscribed','bounced','complained')),
  created_at timestamptz not null default now()
);

-- meetings gets a per-meeting notes override (used by the later notes plan; added now
-- so the schema is stable). NULL = fall back to email_prefs.notes_recipients.
alter table public.meetings
  add column if not exists notes_recipients text
    check (notes_recipients is null or notes_recipients in ('only_me','everyone'));

-- RLS: outbox/prefs/suppressions are service-role only (no client access).
alter table public.email_outbox enable row level security;
alter table public.email_prefs enable row level security;
alter table public.email_suppressions enable row level security;
-- email_prefs is user-readable/writable for the Settings UI (later plan).
create policy email_prefs_owner on public.email_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
