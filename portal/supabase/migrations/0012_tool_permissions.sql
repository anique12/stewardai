-- 0012_tool_permissions.sql — per-user tool allowlist (Claude-Code-style "always allow").
create table if not exists public.tool_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  scope text,                       -- optional (e.g. app or space); null = whole tool
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, tool_name, scope)
);
create index if not exists tool_permissions_user_idx on public.tool_permissions (user_id, tool_name);
alter table public.tool_permissions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='tool_permissions' and policyname='tool_permissions_own') then
    create policy tool_permissions_own on public.tool_permissions for all using (user_id=auth.uid()) with check (user_id=auth.uid());
  end if;
end $$;
