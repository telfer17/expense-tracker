create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create table entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  amount       numeric(10,2) not null check (amount > 0),
  direction    text not null check (direction in ('in', 'out')),
  category_id  uuid references categories(id) on delete restrict,
  entry_date   date not null default current_date,
  note         text,
  is_recurring boolean not null default false,
  created_at   timestamptz not null default now()
);

create index on entries (user_id, entry_date desc);

alter table categories enable row level security;
alter table entries enable row level security;

create policy "own categories" on categories
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "own entries" on entries
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
