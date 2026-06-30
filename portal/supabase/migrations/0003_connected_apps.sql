-- connected_apps: one row per (user, app) tracking Composio OAuth connections
create table if not exists public.connected_apps (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  app                   text not null,
  status                text not null default 'pending'
                          check (status in ('connected', 'pending', 'error', 'disconnected')),
  connected_account_id  text,
  connected_at          timestamptz,
  updated_at            timestamptz not null default now(),
  unique (user_id, app)
);

-- auto-update updated_at (reuse existing trigger function from 0001)
create trigger connected_apps_updated_at
  before update on public.connected_apps
  for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.connected_apps enable row level security;

-- Users can only read/write their own rows; service role bypasses RLS
create policy "connected_apps: own row select"
  on public.connected_apps for select using (user_id = auth.uid());
create policy "connected_apps: own row insert"
  on public.connected_apps for insert with check (user_id = auth.uid());
create policy "connected_apps: own row update"
  on public.connected_apps for update using (user_id = auth.uid());
create policy "connected_apps: own row delete"
  on public.connected_apps for delete using (user_id = auth.uid());
