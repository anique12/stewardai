-- 0014_integrations.sql — single source of truth for supported app integrations.
-- Both the chat backend and the portal read this so their "available" sets can
-- never diverge. `available` = live (connectable + usable). The per-app action
-- allow-list stays in backend code (safety-sensitive); this table owns which
-- apps are offered.
create table if not exists public.integrations (
  slug text primary key,
  name text not null,
  category text not null default '',
  available boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.integrations enable row level security;
-- Non-sensitive catalog: any authenticated user may read; writes are service-role only.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='integrations' and policyname='integrations_read') then
    create policy integrations_read on public.integrations for select using (auth.role() = 'authenticated');
  end if;
end $$;

insert into public.integrations (slug, name, category, available, sort_order) values
  ('gmail',          'Gmail',            'Email',    true,  10),
  ('googlecalendar', 'Google Calendar',  'Calendar', true,  20),
  ('googledrive',    'Google Drive',     'Storage',  true,  30),
  ('googledocs',     'Google Docs',      'Docs',     true,  40),
  ('googlesheets',   'Google Sheets',    'Docs',     true,  50),
  ('notion',         'Notion',           'Docs',     false, 60),
  ('slack',          'Slack',            'Comms',    false, 70)
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  available = excluded.available,
  sort_order = excluded.sort_order,
  updated_at = now();
