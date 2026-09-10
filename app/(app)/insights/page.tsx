import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { addDays, ukToday } from "@/lib/month";
import { buildPeriods, daysBetween, formatDate, resolveView } from "@/lib/periods";
import { resolveRange } from "@/lib/range";
import RangeFilter from "@/components/RangeFilter";
import styles from "./insights.module.css";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

type OutRow = { amount: number; category_id: string | null; note: string | null };

// All outgoings in a window, paged past PostgREST's 1,000-row cap so an
// all-time view aggregates everything rather than a silent first page.
async function fetchOut(
  supabase: SupabaseClient,
  from: string | null,
  to: string | null
): Promise<OutRow[]> {
  const PAGE = 1000;
  const rows: OutRow[] = [];
  for (let start = 0; ; start += PAGE) {
    let q = supabase
      .from("entries")
      .select("amount, category_id, note")
      .eq("direction", "out")
      .order("entry_date", { ascending: false })
      .order("id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (from) q = q.gte("entry_date", from);
    if (to) q = q.lte("entry_date", to);
    const { data, error } = await q;
    if (error) {
      throw new Error(`Couldn't load entries: ${error.message}`);
    }
    rows.push(...((data as OutRow[]) ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { range, from, to } = await searchParams;
  const rangeView = resolveRange(range, from, to);

  const supabase = await createClient();
  const [{ data: settingsRow }, { data: markerRows }, { data: earliestRows }, { data: categories }] =
    await Promise.all([
      supabase.from("user_settings").select("period_mode").maybeSingle(),
      supabase.from("periods").select("start_date").order("start_date"),
      supabase.from("entries").select("entry_date").order("entry_date").limit(1),
      supabase.from("categories").select("id, name").order("name"),
    ]);

  const periods =
    settingsRow?.period_mode === "salary"
      ? buildPeriods(
          (markerRows ?? []).map((r) => r.start_date),
          earliestRows?.[0]?.entry_date ?? null
        )
      : [];
  const view = resolveView(periods, undefined, undefined);

  // No range param = the current month/period, like /entries.
  const curFrom = rangeView ? rangeView.from : view.start;
  const curTo = rangeView ? rangeView.to : view.end;
  const label = rangeView ? rangeView.label : view.label;

  // The comparison window: the previous period in period view, or the
  // equal-length window immediately before a bounded range. All time has
  // no "previous", so section 2 disappears there.
  let prev: { from: string; to: string; label: string } | null = null;
  if (!rangeView) {
    if (view.prev) {
      prev = { from: view.prev.start, to: view.prev.end, label: view.prev.label };
    }
  } else if (rangeView.from) {
    const end = rangeView.to ?? ukToday();
    const len = daysBetween(rangeView.from, end);
    const prevTo = addDays(rangeView.from, -1);
    const prevFrom = addDays(prevTo, -len);
    prev = {
      from: prevFrom,
      to: prevTo,
      label: `${formatDate(prevFrom)} – ${formatDate(prevTo)}`,
    };
  }

  const [outRows, prevRows] = await Promise.all([
    fetchOut(supabase, curFrom, curTo),
    prev ? fetchOut(supabase, prev.from, prev.to) : Promise.resolve([]),
  ]);

  // 1. Categories ranked by spend.
  const catNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const byCat = new Map<string, { name: string; total: number; count: number }>();
  let outTotal = 0;
  for (const r of outRows) {
    const key = r.category_id ?? "";
    let g = byCat.get(key);
    if (!g) {
      g = {
        name: key ? catNameById.get(key) ?? "—" : "Uncategorised",
        total: 0,
        count: 0,
      };
      byCat.set(key, g);
    }
    g.total += Number(r.amount);
    g.count += 1;
    outTotal += Number(r.amount);
  }
  const ranked = [...byCat.entries()]
    .map(([id, g]) => ({ id: id || null, ...g }))
    .sort((a, b) => b.total - a.total);

  // 2. Change vs the previous window, for the top categories.
  const prevByCat = new Map<string, number>();
  for (const r of prevRows) {
    const key = r.category_id ?? "";
    prevByCat.set(key, (prevByCat.get(key) ?? 0) + Number(r.amount));
  }
  const changes = ranked.slice(0, 8).map((c) => {
    const prevTotal = prevByCat.get(c.id ?? "") ?? 0;
    const diff = c.total - prevTotal;
    const pct = prevTotal > 0 ? (diff / prevTotal) * 100 : null;
    // The signal: up more than 25% — or spending where there was none.
    const spike = pct === null ? c.total > 0 : pct > 25;
    return { ...c, prevTotal, diff, pct, spike };
  });

  // 3. Small and frequent: outgoings grouped by note, same normalisation
  // as the grouped category view (trimmed, case-insensitive).
  const byNote = new Map<string, { name: string; total: number; count: number }>();
  for (const r of outRows) {
    const name = (r.note ?? "").trim();
    const key = name.toLowerCase();
    let g = byNote.get(key);
    if (!g) {
      g = { name: name || "No note", total: 0, count: 0 };
      byNote.set(key, g);
    }
    g.total += Number(r.amount);
    g.count += 1;
  }
  const frequent = [...byNote.values()]
    .filter((g) => g.count >= 5)
    .sort((a, b) => b.total - a.total);

  // Category drilldowns carry the same window along.
  const catHref = (id: string): string => {
    if (!rangeView) {
      return view.end
        ? `/categories/${id}?range=custom&from=${view.start}&to=${view.end}`
        : `/categories/${id}?range=custom&from=${view.start}`;
    }
    if (rangeView.preset === "custom") {
      const sp = new URLSearchParams({ range: "custom" });
      if (rangeView.from) sp.set("from", rangeView.from);
      if (rangeView.to) sp.set("to", rangeView.to);
      return `/categories/${id}?${sp}`;
    }
    return `/categories/${id}?range=${rangeView.preset}`;
  };

  const pctFmt = (pct: number): string =>
    `${pct >= 0 ? "+" : "−"}${Math.round(Math.abs(pct))}%`;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Insights</h1>

      <RangeFilter
        basePath="/insights"
        preset={rangeView?.preset ?? null}
        from={rangeView?.from ?? null}
        to={rangeView?.to ?? null}
        offLabel={view.mode === "month" ? "This month" : "This period"}
      />

      <p className={styles.rangeNote}>{label}</p>

      {outRows.length === 0 ? (
        <p className={styles.empty}>No outgoings in this range.</p>
      ) : (
        <>
          <p className={styles.outTotal}>
            Out <strong>{gbp.format(outTotal)}</strong> across {outRows.length}{" "}
            {outRows.length === 1 ? "entry" : "entries"}
          </p>

          <section>
            <h2 className={styles.sectionHead}>Where it went</h2>
            <ul className={styles.list}>
              {ranked.map((c) => {
                const inner = (
                  <>
                    <span className={styles.catName}>{c.name}</span>
                    <span className={styles.catMeta}>
                      {c.count} · {Math.round((c.total / outTotal) * 100)}%
                    </span>
                    <span className={styles.catTotal}>{gbp.format(c.total)}</span>
                  </>
                );
                return (
                  <li key={c.id ?? "uncategorised"}>
                    {c.id ? (
                      <Link href={catHref(c.id)} className={styles.catRow}>
                        {inner}
                      </Link>
                    ) : (
                      <div className={styles.catRow}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {prev && (
            <section>
              <h2 className={styles.sectionHead}>Change vs previous</h2>
              <p className={styles.sectionSub}>vs {prev.label}</p>
              <ul className={styles.list}>
                {changes.map((c) => (
                  <li key={c.id ?? "uncategorised"} className={styles.changeRow}>
                    <span className={styles.changeName}>{c.name}</span>
                    <span className={styles.changeNow}>
                      {gbp.format(c.total)}
                    </span>
                    <span className={styles.changePrev}>
                      was {gbp.format(c.prevTotal)}
                    </span>
                    <span
                      className={
                        c.spike ? styles.changeDiffUp : styles.changeDiff
                      }
                    >
                      {c.diff >= 0 ? "+" : "−"}
                      {gbp.format(Math.abs(c.diff))}
                      {" · "}
                      {c.pct === null ? "new" : pctFmt(c.pct)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className={styles.sectionHead}>Small and frequent</h2>
            <p className={styles.sectionSub}>
              Outgoings repeated 5 or more times in this range
            </p>
            {frequent.length === 0 ? (
              <p className={styles.emptySection}>
                Nothing repeated 5 times or more.
              </p>
            ) : (
              <ul className={styles.list}>
                {frequent.map((g) => (
                  <li key={g.name.toLowerCase()} className={styles.freqRow}>
                    <span className={styles.freqCount}>{g.count}×</span>
                    <span className={styles.freqMain}>
                      <span className={styles.freqName}>{g.name}</span>
                      <span className={styles.freqAvg}>
                        avg {gbp.format(g.total / g.count)}
                      </span>
                    </span>
                    <span className={styles.freqTotal}>
                      {gbp.format(g.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
