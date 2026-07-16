-- Close audit trail for action items: who closed it and when, plus a link to
-- the agent_actions row that closed it (used by part 2 — MeetBase auto-close).
alter table public.action_items
  add column if not exists closed_by  text,
  add column if not exists closed_at  timestamptz,
  add column if not exists agent_action_id uuid references public.agent_actions(id) on delete set null;
