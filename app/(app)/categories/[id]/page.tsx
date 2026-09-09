import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { monthLabel } from "@/lib/month";
import totals from "@/components/EntriesView.module.css";
import styles from "./category.module.css";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const [{ data: category }, { data: entries }] = await Promise.all([
    supabase.from("categories").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("entries")
      .select("amount, direction, entry_date")
      .eq("category_id", id)
      .order("entry_date", { ascending: false }),
  ]);

  if (!category) notFound();

  // Group into months, newest first (entries arrive date-descending).
  const months = new Map<string, { inSum: number; outSum: number }>();
  let inAll = 0;
  let outAll = 0;
  for (const e of entries ?? []) {
    const key = e.entry_date.slice(0, 7);
    const m = months.get(key) ?? { inSum: 0, outSum: 0 };
    if (e.direction === "in") {
      m.inSum += Number(e.amount);
      inAll += Number(e.amount);
    } else {
      m.outSum += Number(e.amount);
      outAll += Number(e.amount);
    }
    months.set(key, m);
  }

  const monthCount = months.size;
  const spendDominant = outAll >= inAll;
  const avg = monthCount
    ? (spendDominant ? outAll : inAll) / monthCount
    : 0;

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

      {monthCount === 0 ? (
        <p className={styles.empty}>No entries.</p>
      ) : (
        <>
          <p className={styles.avg}>
            Average monthly {spendDominant ? "spend" : "income"} ·{" "}
            {gbp.format(avg)}
          </p>

          <div className={styles.months}>
            <div className={styles.monthHeader}>
              <span>Month</span>
              <span className={styles.num}>In</span>
              <span className={styles.num}>Out</span>
              <span className={styles.num}>Net</span>
            </div>
            {[...months.entries()].map(([month, m]) => (
              <Link
                key={month}
                href={`/entries?month=${month}&cat=${category.id}`}
                className={styles.monthRow}
              >
                <span className={styles.monthName}>{monthLabel(month)}</span>
                <span className={`${styles.num} ${styles.numIn}`}>
                  {gbp.format(m.inSum)}
                </span>
                <span className={styles.num}>{gbp.format(m.outSum)}</span>
                <span className={styles.num}>
                  {gbp.format(m.inSum - m.outSum)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
