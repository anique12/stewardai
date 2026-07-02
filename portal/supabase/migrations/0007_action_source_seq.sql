-- Attribute an agent action / action item to the transcript line (seq) that
-- produced it. Nullable: pre-existing rows and unattributable items stay null
-- and render only in the consolidated "Actions & tasks" section.
alter table public.agent_actions add column if not exists source_seq integer;
alter table public.action_items  add column if not exists source_seq integer;
