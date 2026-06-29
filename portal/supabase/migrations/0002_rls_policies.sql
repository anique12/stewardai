-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.meetings enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.summaries enable row level security;
alter table public.action_items enable row level security;

-- profiles
create policy "profiles: own row select"
  on public.profiles for select using (user_id = auth.uid());
create policy "profiles: own row update"
  on public.profiles for update using (user_id = auth.uid());
create policy "profiles: own row insert"
  on public.profiles for insert with check (user_id = auth.uid());

-- calendar_connections
create policy "calendar_connections: own row select"
  on public.calendar_connections for select using (user_id = auth.uid());
create policy "calendar_connections: own row insert"
  on public.calendar_connections for insert with check (user_id = auth.uid());
create policy "calendar_connections: own row update"
  on public.calendar_connections for update using (user_id = auth.uid());
create policy "calendar_connections: own row delete"
  on public.calendar_connections for delete using (user_id = auth.uid());

-- meetings
create policy "meetings: own rows select"
  on public.meetings for select using (user_id = auth.uid());
create policy "meetings: own rows insert"
  on public.meetings for insert with check (user_id = auth.uid());
create policy "meetings: own rows update"
  on public.meetings for update using (user_id = auth.uid());
create policy "meetings: own rows delete"
  on public.meetings for delete using (user_id = auth.uid());

-- transcript_segments: readable if the parent meeting belongs to the user
create policy "transcript_segments: readable by meeting owner"
  on public.transcript_segments for select
  using (
    exists (
      select 1 from public.meetings m
      where m.id = transcript_segments.meeting_id
        and m.user_id = auth.uid()
    )
  );

-- summaries: same join pattern
create policy "summaries: readable by meeting owner"
  on public.summaries for select
  using (
    exists (
      select 1 from public.meetings m
      where m.id = summaries.meeting_id
        and m.user_id = auth.uid()
    )
  );

-- action_items: readable + done-toggle by meeting owner
create policy "action_items: readable by meeting owner"
  on public.action_items for select
  using (
    exists (
      select 1 from public.meetings m
      where m.id = action_items.meeting_id
        and m.user_id = auth.uid()
    )
  );
create policy "action_items: done toggle by meeting owner"
  on public.action_items for update
  using (
    exists (
      select 1 from public.meetings m
      where m.id = action_items.meeting_id
        and m.user_id = auth.uid()
    )
  );
