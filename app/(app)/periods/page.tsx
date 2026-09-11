import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPeriods, formatDate, formatPeriodRange } from "@/lib/periods";
import PeriodsManager from "@/components/PeriodsManager";
import styles from "./periods.module.css";

export default async function PeriodsPage() {
  const supabase = await createClient();
  const [{ data: claims }, { data: periodRows, error: periodsError }] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase.from("periods").select("id, start_date").order("start_date"),
    ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  // Fail loudly — a failed query must not render as "no periods".
  if (periodsError) {
    throw new Error(`Couldn't load periods: ${periodsError.message}`);
  }

  const idByStart = new Map(
    (periodRows ?? []).map((r) => [r.start_date, r.id])
  );

  // Derived ends: day before the next start; newest runs to the present.
  const built = buildPeriods([...idByStart.keys()], null);
  const firstStart =
    built.length > 0 ? built[built.length - 1].start : null;

  // Counted in the database — fetching rows to count them client-side
  // silently truncates at PostgREST's 1,000-row cap.
  const countQueries = built.map((p) => {
    let q = supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .gte("entry_date", p.start);
    if (!p.open) q = q.lte("entry_date", p.end);
    return q;
  });
  const results = await Promise.all([
    ...countQueries,
    ...(firstStart
      ? [
          supabase
            .from("entries")
            .select("id", { count: "exact", head: true })
            .lt("entry_date", firstStart),
        ]
      : []),
  ]);
  for (const r of results) {
    if (r.error) {
      throw new Error(`Couldn't count entries: ${r.error.message}`);
    }
  }

  const rows = built.map((p, i) => ({
    id: idByStart.get(p.start)!,
    start: p.start,
    range: formatPeriodRange(p),
    count: results[i].count ?? 0,
  }));
  const beforeCount = firstStart ? results[built.length].count ?? 0 : 0;
  const implicit =
    firstStart && beforeCount > 0
      ? { label: `Before ${formatDate(firstStart)}`, count: beforeCount }
      : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Periods</h1>
      <PeriodsManager rows={rows} implicit={implicit} userId={userId} />
    </div>
  );
}
