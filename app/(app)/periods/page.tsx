import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPeriods, formatDate, formatPeriodRange } from "@/lib/periods";
import PeriodsManager from "@/components/PeriodsManager";
import styles from "./periods.module.css";

export default async function PeriodsPage() {
  const supabase = await createClient();
  const [{ data: claims }, { data: periodRows }, { data: entryRows }] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase.from("periods").select("id, start_date").order("start_date"),
      supabase.from("entries").select("entry_date"),
    ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const idByStart = new Map(
    (periodRows ?? []).map((r) => [r.start_date, r.id])
  );
  const dates = (entryRows ?? []).map((r) => r.entry_date);

  // Derived ends: day before the next start; newest runs to the present.
  const built = buildPeriods([...idByStart.keys()], null);
  const rows = built.map((p) => ({
    id: idByStart.get(p.start)!,
    start: p.start,
    range: formatPeriodRange(p),
    count: dates.filter(
      (d) => d >= p.start && (p.open || d <= p.end)
    ).length,
  }));

  const firstStart =
    built.length > 0 ? built[built.length - 1].start : null;
  const beforeCount = firstStart
    ? dates.filter((d) => d < firstStart).length
    : 0;
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
