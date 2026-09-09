-- Single-row-per-user app settings. period_mode chooses how every screen
-- groups entries: calendar months (default) or marked salary periods.
create table user_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  period_mode text not null default 'month' check (period_mode in ('month', 'salary')),
  updated_at  timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "own settings" on user_settings
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
