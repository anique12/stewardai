-- Per-meeting STT keyterms: comma-separated domain vocabulary (attendee names +
-- LLM-extracted terms from the calendar event title/description) used to bias the
-- per-speaker Deepgram transcription. Populated by the calendar sync; read by the
-- meeting agent. Nullable — meetings without calendar context simply have none.
alter table public.meetings
  add column if not exists keyterms text;
