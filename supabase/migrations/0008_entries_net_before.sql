-- Database-side aggregate for the running-balance prefix on /entries:
-- signed net (in minus out) of the caller's entries with
-- p_from <= entry_date < p_to. Replaces a row-fetching query that would
-- silently truncate at PostgREST's 1,000-row limit. security invoker, so
-- RLS scopes it to the signed-in user.
create function entries_net_before(p_from date, p_to date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    sum(case when direction = 'in' then amount else -amount end),
    0
  )
  from public.entries
  where entry_date >= p_from
    and entry_date < p_to;
$$;
