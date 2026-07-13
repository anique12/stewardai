-- Per-user "Let Steward speak in meetings" setting.
-- Default true preserves today's behavior (bot speaks when the model decides to).
-- When false, the bot still joins + transcribes (notetaker) but never speaks;
-- enforced both by muting the outbound mic and by the system prompt.
alter table public.profiles
  add column if not exists allow_meeting_speech boolean not null default true;
