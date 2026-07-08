-- 0011_chat.sql — agentic chat threads + messages (Plan C1).
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  space_id uuid references public.spaces(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  seq integer not null,
  parts jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, seq);
create index if not exists chat_threads_user_idx on public.chat_threads (user_id, updated_at desc);
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='chat_threads' and policyname='chat_threads_own') then
    create policy chat_threads_own on public.chat_threads for all using (user_id=auth.uid()) with check (user_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='chat_messages' and policyname='chat_messages_own') then
    create policy chat_messages_own on public.chat_messages for all using (user_id=auth.uid()) with check (user_id=auth.uid());
  end if;
end $$;
