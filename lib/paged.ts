// Fetch every row of a query, paged past PostgREST's silent 1,000-row cap.
// Fetching "all" rows with a single select truncates at that cap, so any
// query that aggregates or displays an unbounded set must go through this
// (or aggregate in the database instead).
//
// `page` must return a fresh query for the given inclusive row range and
// apply a deterministic order that includes a unique tiebreak column (e.g.
// .order("entry_date").order("id")) so pages never overlap or skip rows.
// Throws on the first page error, prefixed with `what`.
export async function fetchAllRows<T>(
  what: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't load ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
