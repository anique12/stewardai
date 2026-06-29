-- profiles: 1:1 with auth.users
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bot_name    text not null default 'StewardAI',
  plan        text not null default 'free' check (plan in ('free','pro')),
  created_at  timestamptz not null default now()
);

-- calendar_connections: one per user
create table if not exists public.calendar_connections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references auth.users(id) on delete cascade,
  google_refresh_token  text not null,
  scopes                text[] not null default '{}',
  connected_at          timestamptz not null default now()
);

-- meetings
create table if not exists public.meetings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  google_event_id   text not null,
  title             text not null,
  start_time        timestamptz not null,
  end_time          timestamptz not null,
  meet_url          text,
  native_meeting_id text,
  opted_in          boolean not null default false,
  bot_status        text not null default 'pending'
                      check (bot_status in ('pending','joining','in_meeting','done','failed')),
  vexa_meeting_id   uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, google_event_id)
);

-- auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger meetings_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

-- transcript_segments
create table if not exists public.transcript_segments (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  seq         integer not null,
  speaker     text not null,
  text        text not null,
  created_at  timestamptz not null default now()
);

-- summaries
create table if not exists public.summaries (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null unique references public.meetings(id) on delete cascade,
  tldr        text not null,
  decisions   jsonb not null default '[]',
  discrepancies jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

-- action_items
create table if not exists public.action_items (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  owner       text not null,
  task        text not null,
  due         date,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
