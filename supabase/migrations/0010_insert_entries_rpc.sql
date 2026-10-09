-- Follow-up to 0009 (run that first).
--
-- 1. Tighten the entry_categories policy: a link row must belong to the
--    caller AND point at the caller's own entry and category, so a row
--    can't attach someone else's entry or category even with a valid
--    user_id.
-- 2. insert_entries_with_categories: one transactional call that creates
--    entries and their category links together, so a failure anywhere
--    leaves nothing behind. Used by the add form, the statement import,
--    and "copy recurring".

drop policy "own entry_categories" on entry_categories;

create policy "own entry_categories" on entry_categories
  for all
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from entries e
      where e.id = entry_id and e.user_id = (select auth.uid())
    )
    and exists (
      select 1 from categories c
      where c.id = category_id and c.user_id = (select auth.uid())
    )
  );

-- p_entries is a JSON array; each element:
--   { "id"?: uuid, "amount": number, "direction": "in"|"out",
--     "entry_date": "YYYY-MM-DD", "note"?: string, "is_recurring"?: bool,
--     "import_batch"?: uuid, "fingerprint"?: string,
--     "category_ids": uuid[] }
-- Returns the new entry ids in input order. user_id is always the caller;
-- the legacy entries.category_id column gets the first category. security
-- invoker, so RLS (including the policy above) applies to every row.
-- Any failure raises, which rolls the whole call back.
create function insert_entries_with_categories(p_entries jsonb)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[] := '{}';
  v_entry jsonb;
  v_id uuid;
  v_cat_ids uuid[];
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be a JSON array';
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    select coalesce(array_agg(t.value::uuid order by t.ord), '{}')
    into v_cat_ids
    from jsonb_array_elements_text(coalesce(v_entry->'category_ids', '[]'::jsonb))
      with ordinality as t(value, ord);

    v_id := coalesce((v_entry->>'id')::uuid, gen_random_uuid());

    insert into public.entries (
      id, user_id, amount, direction, category_id, entry_date, note,
      is_recurring, import_batch, fingerprint
    )
    values (
      v_id,
      v_uid,
      (v_entry->>'amount')::numeric,
      v_entry->>'direction',
      v_cat_ids[1],
      (v_entry->>'entry_date')::date,
      nullif(v_entry->>'note', ''),
      coalesce((v_entry->>'is_recurring')::boolean, false),
      (v_entry->>'import_batch')::uuid,
      nullif(v_entry->>'fingerprint', '')
    );

    insert into public.entry_categories (entry_id, category_id, user_id)
    select v_id, c, v_uid from unnest(v_cat_ids) as c
    on conflict do nothing;

    v_ids := v_ids || v_id;
  end loop;

  return v_ids;
end;
$$;
