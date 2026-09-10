import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { monthLabel, monthRange } from "@/lib/month";
import { buildPeriods, periodFor } from "@/lib/periods";
import { resolveRange, type RangeView } from "@/lib/range";
import { likePattern } from "@/lib/search";
import RangeFilter from "@/components/RangeFilter";
import SearchBox from "@/components/SearchBox";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}) {
  const { id } = await params;
  const { range, from, to, q = "" } = await searchParams;

  // No valid range param means the current default: everything.
  const rv: RangeView = resolveRange(range, from, to) ?? {
    preset: "all",
    from: null,
    to: null,
    label: "All time",
  };

  // The search box owns q and must keep the range params intact.
  const searchOthers: Record<string, string> = {};
  if (range) searchOthers.range = range;
  if (from) searchOthers.from = from;
  if (to) searchOthers.to = to;

  const supabase = await createClient();
  let entriesQuery = supabase
    .from("entries")
    .select("amount, direction, entry_date")
    .eq("category_id", id)
    .order("entry_date", { ascending: false });
  if (rv.from) entriesQuery = entriesQuery.gte("entry_date", rv.from);
  if (rv.to) entriesQuery = entriesQuery.lte("entry_date", rv.to);
  if (q) entriesQuery = entriesQuery.ilike("note", likePattern(q));

  const [
    { data: category },
    { data: settingsRow },
    { data: entries },
    { data: markerRows },
    { data: earliestRows },
  ] = await Promise.all([
    supabase.from("categories").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("user_settings").select("period_mode").maybeSingle(),
    entriesQuery,
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

  // Drilldown links must cover exactly the entries counted in the row: when
  // the active range clips a group, link to the intersection as a custom
  // range instead of the whole month/period, and an active search carries
  // over so the sums still match.
  const qSuffix = q ? `&q=${encodeURIComponent(q)}` : "";
  const groupHref = (start: string, end: string, plain: string): string => {
    const from = rv.from && rv.from > start ? rv.from : start;
    const to = rv.to && rv.to < end ? rv.to : end;
    if (from === start && to === end) return `${plain}${qSuffix}`;
    return `/entries?range=custom&from=${from}&to=${to}&cat=${category.id}${qSuffix}`;
  };

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
      href = groupHref(
        p.start,
        p.end,
        `/entries?period=${p.start}&cat=${category.id}`
      );
    } else {
      key = e.entry_date.slice(0, 7);
      label = monthLabel(key);
      const m = monthRange(key);
      href = groupHref(m.start, m.end, `/entries?month=${key}&cat=${category.id}`);
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

      <RangeFilter
        basePath={`/categories/${category.id}`}
        preset={rv.preset}
        from={rv.from}
        to={rv.to}
        others={q ? { q } : {}}
        defaultPreset="all"
      />

      <SearchBox
        basePath={`/categories/${category.id}`}
        others={searchOthers}
        initialQuery={q}
        matched={q ? (entries ?? []).length : null}
      />

      <p className={styles.rangeNote}>{rv.label}</p>

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
        <p className={styles.empty}>
          {q
            ? "No entries match."
            : rv.preset === "all"
              ? "No entries."
              : "No entries in this range."}
        </p>
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
