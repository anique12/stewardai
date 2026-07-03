-- 0009_knowledge_base.sql — Knowledge Base L0: spaces, entities, tags, facts, filing hints.

-- Spaces: flexible, nestable container; the home for meetings.
create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_id uuid references public.spaces(id) on delete set null,
  kind text check (kind in ('client','project','topic')),   -- cosmetic label; nullable
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists spaces_updated_at on public.spaces;
create trigger spaces_updated_at before update on public.spaces
  for each row execute function public.set_updated_at();

-- Entities: global (per user) people & companies.
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('person','company')),
  name text not null,
  email text,
  domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists entities_updated_at on public.entities;
create trigger entities_updated_at before update on public.entities
  for each row execute function public.set_updated_at();
create index if not exists entities_user_email_idx on public.entities (user_id, lower(email));
create index if not exists entities_user_domain_idx on public.entities (user_id, lower(domain));

-- Meeting -> entity links (many-to-many).
create table if not exists public.meeting_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  unique (meeting_id, entity_id)
);

-- Meeting -> topic tags (free-form, many per meeting).
create table if not exists public.meeting_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, tag)
);

-- Space-level facts, rolled up from member meetings; each links to its source.
create table if not exists public.space_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete set null,   -- source (provenance)
  kind text not null check (kind in ('action_item','decision','date','risk','open_question')),
  text text not null,
  owner text,
  due date,
  status text,
  source_seq integer,
  superseded_by uuid references public.space_facts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists space_facts_space_idx on public.space_facts (space_id, kind);

-- Filing hints: learned signal -> space mappings (updated on corrections).
create table if not exists public.filing_hints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('attendee_email','domain','series')),
  value text not null,
  space_id uuid not null references public.spaces(id) on delete cascade,
  weight integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, kind, value, space_id)
);

-- Meeting filing metadata.
alter table public.meetings add column if not exists space_id uuid references public.spaces(id) on delete set null;
alter table public.meetings add column if not exists space_confidence real;
alter table public.meetings add column if not exists space_source text
  check (space_source in ('recurring','auto','auto_created','manual','suggested','unfiled'));

-- RLS: own-row on every table (service-role key bypasses; anon/cookie client is scoped).
alter table public.spaces enable row level security;
alter table public.entities enable row level security;
alter table public.meeting_entities enable row level security;
alter table public.meeting_tags enable row level security;
alter table public.space_facts enable row level security;
alter table public.filing_hints enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='spaces' and policyname='spaces_own') then
    create policy spaces_own on public.spaces for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='entities' and policyname='entities_own') then
    create policy entities_own on public.entities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='meeting_entities' and policyname='meeting_entities_own') then
    create policy meeting_entities_own on public.meeting_entities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='meeting_tags' and policyname='meeting_tags_own') then
    create policy meeting_tags_own on public.meeting_tags for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='space_facts' and policyname='space_facts_own') then
    create policy space_facts_own on public.space_facts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename='filing_hints' and policyname='filing_hints_own') then
    create policy filing_hints_own on public.filing_hints for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
