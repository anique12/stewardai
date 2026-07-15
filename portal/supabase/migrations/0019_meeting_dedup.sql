-- Dedup-per-meeting + fan-out: one bot per native_meeting_id.
-- 'grouped' = a sibling row whose bot is driven by the lead row (see
-- bot_lead_meeting_id); the scheduler must not dispatch its own bot. Fan-out
-- resolves grouped rows to 'done'/'failed' at teardown.

alter table public.meetings
  drop constraint if exists meetings_bot_status_check;

alter table public.meetings
  add constraint meetings_bot_status_check
  check (bot_status in ('pending','joining','in_meeting','done','failed','grouped'));

alter table public.meetings
  add column if not exists bot_lead_meeting_id uuid
    references public.meetings(id) on delete set null;

create index if not exists meetings_native_status_idx
  on public.meetings (native_meeting_id, bot_status);
