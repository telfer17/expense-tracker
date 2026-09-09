import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { monthLabel } from "@/lib/month";
import { buildPeriods, periodFor } from "@/lib/periods";
import totals from "@/components/EntriesView.module.css";
import styles from "./category.module.css";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

type Group = {
  key: string;
  label: string;
  href: string;
  inSum: number;
  outSum: number;
};

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const [
    { data: category },
    { data: settingsRow },
    { data: entries },
    { data: markerRows },
    { data: earliestRows },
  ] = await Promise.all([
    supabase.from("categories").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("user_settings").select("period_mode").maybeSingle(),
    supabase
      .from("entries")
      .select("amount, direction, entry_date")
      .eq("category_id", id)
      .order("entry_date", { ascending: false }),
    supabase.from("periods").select("start_date").order("start_date"),
    supabase
      .from("entries")
      .select("entry_date")
      .order("entry_date")
      .limit(1),
  ]);

  if (!category) notFound();

  const periods =
    settingsRow?.period_mode === "salary"
      ? buildPeriods(
          (markerRows ?? []).map((r) => r.start_date),
          earliestRows?.[0]?.entry_date ?? null
        )
      : [];
  const periodMode = periods.length > 0;

  // Group into periods (or calendar months with no markers), newest first —
  // entries arrive date-descending, so insertion order is already newest-first.
  const groups = new Map<string, Group>();
  let inAll = 0;
  let outAll = 0;
  for (const e of entries ?? []) {
    let key: string, label: string, href: string;
    if (periodMode) {
      const p = periodFor(periods, e.entry_date);
      if (!p) continue;
      key = p.start;
      label = p.label;
      href = `/entries?period=${p.start}&cat=${category.id}`;
    } else {
      key = e.entry_date.slice(0, 7);
      label = monthLabel(key);
      href = `/entries?month=${key}&cat=${category.id}`;
    }
    let g = groups.get(key);
    if (!g) {
      g = { key, label, href, inSum: 0, outSum: 0 };
      groups.set(key, g);
    }
    if (e.direction === "in") {
      g.inSum += Number(e.amount);
      inAll += Number(e.amount);
    } else {
      g.outSum += Number(e.amount);
      outAll += Number(e.amount);
    }
  }

  const groupList = [...groups.values()];
  const spendDominant = outAll >= inAll;
  const avg = groupList.length
    ? (spendDominant ? outAll : inAll) / groupList.length
    : 0;
  const avgLabel = periodMode
    ? `Average ${spendDominant ? "spend" : "income"} per period`
    : `Average monthly ${spendDominant ? "spend" : "income"}`;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{category.name}</h1>

      <div className={totals.totals}>
        <div className={totals.total}>
          <span className={totals.totalLabel}>In</span>
          <span className={totals.totalIn}>{gbp.format(inAll)}</span>
        </div>
        <div className={totals.total}>
          <span className={totals.totalLabel}>Out</span>
          <span>{gbp.format(outAll)}</span>
        </div>
        <div className={totals.total}>
          <span className={totals.totalLabel}>Net</span>
          <span>{gbp.format(inAll - outAll)}</span>
        </div>
      </div>

      {groupList.length === 0 ? (
        <p className={styles.empty}>No entries.</p>
      ) : (
        <>
          <p className={styles.avg}>
            {avgLabel} · {gbp.format(avg)}
          </p>

          <div className={styles.months}>
            <div className={styles.monthHeader}>
              <span>{periodMode ? "Period" : "Month"}</span>
              <span className={styles.num}>In</span>
              <span className={styles.num}>Out</span>
              <span className={styles.num}>Net</span>
            </div>
            {groupList.map((g) => (
              <Link key={g.key} href={g.href} className={styles.monthRow}>
                <span className={styles.monthName}>{g.label}</span>
                <span className={`${styles.num} ${styles.numIn}`}>
                  {gbp.format(g.inSum)}
                </span>
                <span className={styles.num}>{gbp.format(g.outSum)}</span>
                <span className={styles.num}>
                  {gbp.format(g.inSum - g.outSum)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
