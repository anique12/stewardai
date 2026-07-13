-- Per-user default auto-join policy for newly-synced calendar meetings.
-- Controls the DEFAULT `opted_in` for meetings that don't exist yet; it never
-- overrides a meeting's existing opted_in value on re-sync (see calendar sync
-- code in portal/src/app and src/stewardai/scheduler/calendar_sync.py).
alter table public.profiles
  add column if not exists auto_join_policy text not null default 'all';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_auto_join_policy_chk') then
    alter table public.profiles add constraint profiles_auto_join_policy_chk
      check (auto_join_policy in ('all','organizer','none'));
  end if;
end $$;
