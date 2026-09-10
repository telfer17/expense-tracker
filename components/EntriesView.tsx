"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addMonths, monthRange } from "@/lib/month";
import { viewHref, type PeriodView } from "@/lib/periods";
import type { RangeView } from "@/lib/range";
import type { Category, Entry } from "@/lib/types";
import EntryForm from "./EntryForm";
import RangeFilter from "./RangeFilter";
import SearchBox from "./SearchBox";
import styles from "./EntriesView.module.css";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

type RecurringFilter = "all" | "recurring" | "nonrecurring";
type DirectionFilter = "" | "in" | "out";

export default function EntriesView({
  view,
  mode,
  hasPeriods,
  emptyHint,
  entries,
  categories,
  userId,
  initialCat = "",
  range = null,
  rangeOthers = {},
  searchQuery = "",
  searchOthers = {},
  runningBalance = null,
}: {
  view: PeriodView;
  mode: "month" | "salary";
  hasPeriods: boolean;
  emptyHint: { label: string; href: string } | null;
  entries: Entry[];
  categories: Category[];
  userId: string;
  initialCat?: string;
  range?: RangeView | null; // set = range mode: entries span the whole range
  rangeOthers?: Record<string, string>;
  searchQuery?: string; // active note search; entries are already filtered
  searchOthers?: Record<string, string>;
  // Balance just before this view's first counted entry, plus the anchor
  // date; entries dated before it get no balance. Null = feature off, or
  // the server view is filtered (range/search).
  runningBalance?: { start: number; startDate: string } | null;
}) {
  const router = useRouter();
  const [filterCat, setFilterCat] = useState(initialCat);
  const [filterRec, setFilterRec] = useState<RecurringFilter>("all");
  const [filterDir, setFilterDir] = useState<DirectionFilter>("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  const catName = new Map(categories.map((c) => [c.id, c.name]));

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  // Category and recurring narrow the totals; the direction filter does not —
  // In/Out/Net always show both sides so they work as navigation.
  const totalsBase = entries.filter((e) => {
    if (filterCat && e.category_id !== filterCat) return false;
    if (filterRec === "recurring" && !e.is_recurring) return false;
    if (filterRec === "nonrecurring" && e.is_recurring) return false;
    return true;
  });

  const filtered = totalsBase.filter(
    (e) => !filterDir || e.direction === filterDir
  );

  const inSum = totalsBase
    .filter((e) => e.direction === "in")
    .reduce((s, e) => s + Number(e.amount), 0);
  const outSum = totalsBase
    .filter((e) => e.direction === "out")
    .reduce((s, e) => s + Number(e.amount), 0);

  // A running balance over a filtered subset would be wrong numbers, so it
  // hides whenever any client-side filter narrows the list. Entries render
  // newest-first; walking them backwards is oldest-first date order (the
  // server sorts by entry_date then created_at).
  let balanceById: Map<string, number> | null = null;
  if (runningBalance && !filterCat && filterRec === "all" && !filterDir) {
    balanceById = new Map();
    let bal = runningBalance.start;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.entry_date < runningBalance.startDate) continue;
      bal += e.direction === "in" ? Number(e.amount) : -Number(e.amount);
      balanceById.set(e.id, bal);
    }
  }

  async function setMode(next: "month" | "salary") {
    if (next === mode || switchingMode) return;
    setSwitchingMode(true);
    setModeError(null);
    const { error } = await createClient()
      .from("user_settings")
      .upsert({ user_id: userId, period_mode: next });
    setSwitchingMode(false);
    if (error) {
      setModeError("Couldn't save the view setting.");
      return;
    }
    router.push("/entries");
    router.refresh();
  }

  async function copyRecurring() {
    const prev = view.prev;
    if (!prev) return;
    setCopying(true);
    setCopyMsg(null);
    const supabase = createClient();

    const { data: recs, error } = await supabase
      .from("entries")
      .select("amount, direction, category_id, entry_date, note")
      .eq("is_recurring", true)
      .gte("entry_date", prev.start)
      .lte("entry_date", prev.end);

    if (error) {
      setCopyMsg("Couldn't load the previous period's entries.");
      setCopying(false);
      return;
    }
    if (!recs || recs.length === 0) {
      setCopyMsg(`No recurring entries in ${prev.label}.`);
      setCopying(false);
      return;
    }

    const existing = entries.filter((e) => e.is_recurring).length;
    let msg = `Copy ${recs.length} recurring ${
      recs.length === 1 ? "entry" : "entries"
    } from ${prev.label} into ${view.label}?`;
    if (existing > 0) {
      msg = `${view.label} already has ${existing} recurring ${
        existing === 1 ? "entry" : "entries"
      }.\n\n${msg}`;
    }
    if (!confirm(msg)) {
      setCopying(false);
      return;
    }

    // Each copy lands one calendar month after the original, day clamped —
    // in month mode this is exactly the old prev-month behaviour.
    const rows = recs.map((r) => {
      const targetMonth = addMonths(r.entry_date.slice(0, 7), 1);
      const day = Math.min(
        Number(r.entry_date.slice(8, 10)),
        monthRange(targetMonth).days
      );
      return {
        user_id: userId,
        amount: r.amount,
        direction: r.direction,
        category_id: r.category_id,
        entry_date: `${targetMonth}-${String(day).padStart(2, "0")}`,
        note: r.note,
        is_recurring: true,
      };
    });

    const { error: insertError } = await supabase.from("entries").insert(rows);
    setCopyMsg(
      insertError
        ? "Copy failed — nothing was created."
        : `Created ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`
    );
    setCopying(false);
    router.refresh();
  }

  return (
    <div className={styles.view}>
      {range ? (
        <h1 className={styles.monthTitle}>{range.label}</h1>
      ) : (
      <div className={styles.monthNav}>
        {view.prevKey ? (
          <Link
            href={viewHref({ mode: view.mode, key: view.prevKey })}
            className={styles.monthArrow}
            aria-label={view.mode === "month" ? "Previous month" : "Previous period"}
          >
            ‹
          </Link>
        ) : (
          <span className={`${styles.monthArrow} ${styles.monthArrowDisabled}`}>
            ‹
          </span>
        )}
        <h1 className={styles.monthTitle}>{view.label}</h1>
        {view.nextKey ? (
          <Link
            href={viewHref({ mode: view.mode, key: view.nextKey })}
            className={styles.monthArrow}
            aria-label={view.mode === "month" ? "Next month" : "Next period"}
          >
            ›
          </Link>
        ) : (
          <span className={`${styles.monthArrow} ${styles.monthArrowDisabled}`}>
            ›
          </span>
        )}
      </div>
      )}

      {!range && (
      <div className={styles.modeToggle} role="group" aria-label="Grouping mode">
        <button
          type="button"
          className={mode === "month" ? styles.modeActive : styles.modeBtn}
          aria-pressed={mode === "month"}
          disabled={switchingMode}
          onClick={() => void setMode("month")}
        >
          Calendar month
        </button>
        <button
          type="button"
          className={mode === "salary" ? styles.modeActive : styles.modeBtn}
          aria-pressed={mode === "salary"}
          disabled={switchingMode}
          onClick={() => void setMode("salary")}
        >
          Salary period
        </button>
      </div>
      )}
      {modeError && <p className={styles.modeNote}>{modeError}</p>}
      {!range && mode === "salary" && !hasPeriods && (
        <p className={styles.modeNote}>
          No periods defined yet — add one on the{" "}
          <Link href="/periods" className={styles.emptyLink}>
            Periods
          </Link>{" "}
          page (start with a payday). Showing calendar months until then.
        </p>
      )}

      <RangeFilter
        basePath="/entries"
        preset={range?.preset ?? null}
        from={range?.from ?? null}
        to={range?.to ?? null}
        others={rangeOthers}
        offLabel={view.mode === "month" ? "Months" : "Periods"}
      />

      <div className={styles.totals}>
        <button
          type="button"
          className={
            filterDir === "in"
              ? `${styles.total} ${styles.totalActive}`
              : styles.total
          }
          aria-pressed={filterDir === "in"}
          onClick={() => setFilterDir((d) => (d === "in" ? "" : "in"))}
        >
          <span className={styles.totalLabel}>In</span>
          <span className={styles.totalIn}>{gbp.format(inSum)}</span>
        </button>
        <button
          type="button"
          className={
            filterDir === "out"
              ? `${styles.total} ${styles.totalActive}`
              : styles.total
          }
          aria-pressed={filterDir === "out"}
          onClick={() => setFilterDir((d) => (d === "out" ? "" : "out"))}
        >
          <span className={styles.totalLabel}>Out</span>
          <span>{gbp.format(outSum)}</span>
        </button>
        <button
          type="button"
          className={
            filterDir === ""
              ? `${styles.total} ${styles.totalActive}`
              : styles.total
          }
          aria-pressed={filterDir === ""}
          onClick={() => setFilterDir("")}
        >
          <span className={styles.totalLabel}>Net</span>
          <span>{gbp.format(inSum - outSum)}</span>
        </button>
      </div>

      <div className={styles.filters}>
        <select
          className={styles.select}
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={filterRec}
          onChange={(e) => setFilterRec(e.target.value as RecurringFilter)}
          aria-label="Filter by recurring"
        >
          <option value="all">All</option>
          <option value="recurring">Recurring only</option>
          <option value="nonrecurring">Non-recurring only</option>
        </select>
      </div>

      <SearchBox
        basePath="/entries"
        others={searchOthers}
        initialQuery={searchQuery}
        matched={searchQuery ? filtered.length : null}
      />

      {filterCat && (
        <Link href={`/categories/${filterCat}`} className={styles.catLink}>
          {catName.get(filterCat)} ›
        </Link>
      )}

      {filtered.length === 0 ? (
        <p className={styles.empty}>
          No entries.
          {emptyHint && (
            <>
              {" "}
              The nearest are in{" "}
              <Link href={emptyHint.href} className={styles.emptyLink}>
                {emptyHint.label}
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <ul className={styles.list}>
          {filtered.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={styles.entry}
                onClick={() => setEditing(e)}
              >
                <span className={styles.entryLeft}>
                  <span className={styles.entryCat}>
                    {catName.get(e.category_id) ?? "—"}
                  </span>
                  {e.note && <span className={styles.entryNote}>{e.note}</span>}
                </span>
                <span className={styles.entryRight}>
                  <span
                    className={
                      e.direction === "in" ? styles.amountIn : styles.amountOut
                    }
                  >
                    {e.direction === "in" ? "+" : "−"}
                    {gbp.format(Number(e.amount))}
                  </span>
                  <span className={styles.entryDate}>
                    {new Date(`${e.entry_date}T00:00:00`).toLocaleDateString(
                      "en-GB",
                      { day: "numeric", month: "short" }
                    )}
                    {balanceById?.has(e.id) && (
                      <span className={styles.entryBalance}>
                        {" · "}
                        {gbp.format(balanceById.get(e.id)!)}
                      </span>
                    )}
                  </span>
                </span>
                <span className={styles.entryChevron} aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!range && (
        <>
          <button
            type="button"
            className={styles.copyBtn}
            disabled={copying || !view.prev}
            onClick={() => void copyRecurring()}
          >
            Copy recurring from {view.prev?.label ?? "previous period"}
          </button>
          {copyMsg && <p className={styles.copyMsg}>{copyMsg}</p>}
        </>
      )}

      {editing && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-entry-title"
        >
          <div className={styles.overlayInner}>
            <h2 id="edit-entry-title" className={styles.overlayTitle}>
              Edit entry
            </h2>
            <EntryForm
              userId={userId}
              initialCategories={categories}
              edit={editing}
              onClose={(changed) => {
                setEditing(null);
                if (changed) router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
