-- 0010_kb_embeddings.sql — KB L1/L2: pgvector chunk store + cosine retrieval RPC.

create extension if not exists vector;

-- One embeddable chunk of a meeting: a transcript window, the summary, or a fact.
-- space_id is NULLABLE so unfiled meetings are still searchable (globally / by meeting).
create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  kind text not null check (kind in ('segment','summary','fact')),
  source_seq integer,                 -- transcript index for provenance (null for summary)
  text text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create index if not exists kb_chunks_user_space_idx on public.kb_chunks (user_id, space_id);
create index if not exists kb_chunks_meeting_idx on public.kb_chunks (meeting_id);
-- Cosine ANN index. Lists=100 is fine at single-user scale; revisit if the table grows large.
create index if not exists kb_chunks_embedding_idx on public.kb_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- RLS own-row (service-role bypasses; code re-filters by user_id anyway).
alter table public.kb_chunks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename='kb_chunks' and policyname='kb_chunks_own') then
    create policy kb_chunks_own on public.kb_chunks for all
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- Cosine top-k retrieval, user-scoped, optionally filtered to one Space.
-- query_embedding arrives as a JSON-array string and is cast to ::vector here, which
-- avoids PostgREST's vector-serialization pitfalls when passing an array RPC arg.
create or replace function public.match_kb_chunks(
  p_user_id uuid,
  query_embedding text,
  match_count int default 8,
  p_space_id uuid default null
)
returns table (
  text text,
  meeting_id uuid,
  source_seq int,
  kind text,
  similarity float
)
language sql stable
as $$
  select c.text, c.meeting_id, c.source_seq, c.kind,
         1 - (c.embedding <=> (query_embedding::vector)) as similarity
  from public.kb_chunks c
  where c.user_id = p_user_id
    and (p_space_id is null or c.space_id = p_space_id)
  order by c.embedding <=> (query_embedding::vector)
  limit match_count;
$$;
