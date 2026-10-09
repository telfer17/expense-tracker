-- Entries can carry several categories. The join table replaces
-- entries.category_id as the source of truth; that column is kept (and
-- still written with the entry's first category) until the backfill below
-- has been verified, after which a later migration can drop it.
--
-- To verify the backfill, both of these should return 0:
--   select count(*) from entries e
--   where e.category_id is not null and not exists (
--     select 1 from entry_categories ec
--     where ec.entry_id = e.id and ec.category_id = e.category_id);
--   select count(*) from entries e
--   where e.category_id is null and exists (
--     select 1 from entry_categories ec where ec.entry_id = e.id);

create table entry_categories (
  entry_id     uuid not null references entries(id) on delete cascade,
  category_id  uuid not null references categories(id) on delete restrict,
  user_id      uuid not null references auth.users(id) on delete cascade,
  primary key (entry_id, category_id)
);

-- Category detail / filter: every entry carrying a category.
create index on entry_categories (user_id, category_id);

alter table entry_categories enable row level security;

create policy "own entry_categories" on entry_categories
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

insert into entry_categories (entry_id, category_id, user_id)
select id, category_id, user_id
from entries
where category_id is not null
on conflict do nothing;

-- Deleting a category, atomically: entries that would be left with no
-- categories get p_target, the category's tags are removed, the legacy
-- entries.category_id column is repointed at a category each entry still
-- carries, and the category row goes. security invoker, so RLS scopes
-- every statement to the signed-in user (and the target must be theirs).
create function delete_category_reassigning(p_category uuid, p_target uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_target = p_category then
    raise exception 'Target category must differ from the one being deleted';
  end if;
  if not exists (select 1 from public.categories where id = p_target) then
    raise exception 'Target category not found';
  end if;

  insert into public.entry_categories (entry_id, category_id, user_id)
  select ec.entry_id, p_target, ec.user_id
  from public.entry_categories ec
  where ec.category_id = p_category
    and not exists (
      select 1 from public.entry_categories o
      where o.entry_id = ec.entry_id and o.category_id <> p_category
    )
  on conflict do nothing;

  delete from public.entry_categories where category_id = p_category;

  update public.entries e
  set category_id = (
    select ec.category_id from public.entry_categories ec
    where ec.entry_id = e.id
    order by ec.category_id
    limit 1
  )
  where e.category_id = p_category;

  delete from public.categories where id = p_category;
end;
$$;
