-- 0013_usage_logs.sql — one row per LLM/embedding call, for cost/pricing + observability.
-- Written by the backend service role (litellm callback); read only via the
-- service role (owner-only usage page). RLS is enabled with NO permissive policy,
-- so end users cannot read others' (or their own) rows through the anon/auth key.
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,  -- null for system/unknown
  feature text not null default 'unknown',                    -- chat | ask | summary | voice | embedding | unknown
  request_id uuid,                                            -- groups the LLM calls of one user request/turn
  thread_id uuid,                                             -- chat only
  model text not null default '',
  model_role text,                                            -- reasoning | utility | embedding
  provider text,                                              -- gemini, etc.
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  latency_ms integer,
  status text not null default 'success',                     -- success | error
  error text,
  tool_calls jsonb,                                           -- [{name, args}]
  prompt jsonb,                                               -- full input messages
  response text,                                              -- full model output
  context jsonb                                               -- {space_id, meeting_ids, ...}
);

create index if not exists usage_logs_user_created_idx on public.usage_logs (user_id, created_at desc);
create index if not exists usage_logs_feature_created_idx on public.usage_logs (feature, created_at desc);
create index if not exists usage_logs_request_idx on public.usage_logs (request_id);

alter table public.usage_logs enable row level security;
-- No policy on purpose: only the service role (which bypasses RLS) reads/writes.
