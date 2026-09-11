import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { monthLabel, monthRange } from "@/lib/month";
import { fetchAllRows } from "@/lib/paged";
import { buildPeriods, periodFor } from "@/lib/periods";
import { resolveRange, type RangeView } from "@/lib/range";
import { likePattern } from "@/lib/search";
import RangeFilter from "@/components/RangeFilter";
import SearchBox from "@/components/SearchBox";
import NoteGroups, {
  type NoteGroup,
  type NoteGroupEntry,
} from "@/components/NoteGroups";
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
    view?: string;
  }>;
}) {
  const { id } = await params;
  const { range, from, to, q = "", view } = await searchParams;
  const grouped = view === "grouped";

  // No valid range param means the current default: everything.
  const rv: RangeView = resolveRange(range, from, to) ?? {
    preset: "all",
    from: null,
    to: null,
    label: "All time",
  };

  // The search box owns q and must keep the range and view params intact.
  const searchOthers: Record<string, string> = {};
  if (range) searchOthers.range = range;
  if (from) searchOthers.from = from;
  if (to) searchOthers.to = to;
  if (grouped) searchOthers.view = "grouped";

  // Entries/Grouped toggle links carry every active filter along.
  const toggleParams = new URLSearchParams();
  if (range) toggleParams.set("range", range);
  if (from) toggleParams.set("from", from);
  if (to) toggleParams.set("to", to);
  if (q) toggleParams.set("q", q);
  const entriesHref = toggleParams.size
    ? `/categories/${id}?${toggleParams}`
    : `/categories/${id}`;
  toggleParams.set("view", "grouped");
  const groupedHref = `/categories/${id}?${toggleParams}`;

  const supabase = await createClient();
  // Paged: the default view is all-time, and a big category's totals and
  // groups would otherwise silently truncate at PostgREST's 1,000-row cap.
  const entriesPromise = fetchAllRows<{
    id: string;
    note: string | null;
    amount: number;
    direction: "in" | "out";
    entry_date: string;
  }>("entries", (from, to) => {
    let entriesQuery = supabase
      .from("entries")
      .select("id, note, amount, direction, entry_date")
      .eq("category_id", id)
      .order("entry_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (rv.from) entriesQuery = entriesQuery.gte("entry_date", rv.from);
    if (rv.to) entriesQuery = entriesQuery.lte("entry_date", rv.to);
    if (q) entriesQuery = entriesQuery.ilike("note", likePattern(q));
    return entriesQuery;
  });

  const [
    { data: category },
    { data: settingsRow },
    entries,
    { data: markerRows },
    { data: earliestRows },
  ] = await Promise.all([
    supabase.from("categories").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("user_settings").select("period_mode").maybeSingle(),
    entriesPromise,
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

  // Grouped view: collapse entries by note, case-insensitively and trimmed.
  // Entries arrive newest first, so each group's first entry is its latest
  // and the map's insertion order is already most-recent-first.
  let noteGroups: NoteGroup[] = [];
  if (grouped) {
    const byNote = new Map<string, { name: string; list: NoteGroupEntry[] }>();
    for (const e of entries ?? []) {
      const name = (e.note ?? "").trim();
      const key = name.toLowerCase();
      let g = byNote.get(key);
      if (!g) {
        g = { name: name || "No note", list: [] };
        byNote.set(key, g);
      }
      g.list.push({
        id: e.id,
        date: e.entry_date,
        amount: Number(e.amount),
        direction: e.direction,
      });
    }
    noteGroups = [...byNote.entries()].map(([key, g]) => {
      const freq = new Map<string, number>();
      for (const en of g.list) {
        const k = en.amount.toFixed(2);
        freq.set(k, (freq.get(k) ?? 0) + 1);
      }
      // Most common amount; scanning newest-first with a strict > means
      // ties — including the all-distinct case — fall to the latest entry.
      let best = g.list[0];
      let bestCount = freq.get(best.amount.toFixed(2))!;
      for (const en of g.list) {
        const c = freq.get(en.amount.toFixed(2))!;
        if (c > bestCount) {
          best = en;
          bestCount = c;
        }
      }
      return {
        key,
        name: g.name,
        count: g.list.length,
        typicalAmount: best.amount,
        typicalDirection: best.direction,
        latestDate: g.list[0].date,
        totalNet: g.list.reduce(
          (s, en) => s + (en.direction === "in" ? en.amount : -en.amount),
          0
        ),
        entries: g.list,
      };
    });
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

      <div className={styles.viewToggle} role="group" aria-label="View">
        <Link
          href={entriesHref}
          className={grouped ? styles.viewLink : styles.viewActive}
        >
          Entries
        </Link>
        <Link
          href={groupedHref}
          className={grouped ? styles.viewActive : styles.viewLink}
        >
          Grouped
        </Link>
      </div>

      <RangeFilter
        basePath={`/categories/${category.id}`}
        preset={rv.preset}
        from={rv.from}
        to={rv.to}
        others={{
          ...(q ? { q } : {}),
          ...(grouped ? { view: "grouped" } : {}),
        }}
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

      {grouped ? (
        noteGroups.length === 0 ? (
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
              {noteGroups.length} {category.name.toLowerCase()}
            </p>
            <NoteGroups groups={noteGroups} />
          </>
        )
      ) : groupList.length === 0 ? (
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
