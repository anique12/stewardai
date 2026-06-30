-- agent_actions: actions Steward proposes for a meeting; user approves/dismisses
create table if not exists public.agent_actions (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  user_id      uuid not null references auth.users(id),
  source       text check (source in ('directed','inferred')),
  toolkit      text,  -- gmail | googlecalendar | notion | slack
  action_slug  text,
  args         jsonb not null default '{}'::jsonb,
  risk         text check (risk in ('low','high')),
  title        text,  -- human-readable, e.g. "Send recap to the team"
  state        text not null default 'proposed'
               check (state in ('proposed','approved','running','done','failed')),
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- auto-update updated_at (reuse existing trigger function from 0001)
create trigger agent_actions_updated_at
  before update on public.agent_actions
  for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.agent_actions enable row level security;

-- Users can only read/update their own rows; service role bypasses RLS
create policy "agent_actions: own row select"
  on public.agent_actions for select using (user_id = auth.uid());
create policy "agent_actions: own row insert"
  on public.agent_actions for insert with check (user_id = auth.uid());
create policy "agent_actions: own row update"
  on public.agent_actions for update using (user_id = auth.uid());
