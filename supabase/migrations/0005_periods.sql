-- Financial periods move from per-entry markers to a dedicated list of
-- start dates. A period runs from its start_date to the day before the next
-- period's start_date (the newest runs to today), so ends are derived and
-- there are never gaps or overlaps.
create table periods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, start_date)
);

alter table periods enable row level security;

create policy "own periods" on periods
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The old marker column (its partial index is dropped with it).
alter table entries drop column starts_period;
