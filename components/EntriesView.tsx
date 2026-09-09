"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addMonths, monthLabel, monthRange } from "@/lib/month";
import type { Category, Entry } from "@/lib/types";
import EntryForm from "./EntryForm";
import styles from "./EntriesView.module.css";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

type RecurringFilter = "all" | "recurring" | "nonrecurring";
type DirectionFilter = "" | "in" | "out";

export default function EntriesView({
  month,
  entries,
  categories,
  userId,
}: {
  month: string;
  entries: Entry[];
  categories: Category[];
  userId: string;
}) {
  const router = useRouter();
  const [filterCat, setFilterCat] = useState("");
  const [filterRec, setFilterRec] = useState<RecurringFilter>("all");
  const [filterDir, setFilterDir] = useState<DirectionFilter>("");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

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

  async function copyRecurring() {
    setCopying(true);
    setCopyMsg(null);
    const supabase = createClient();
    const prev = addMonths(month, -1);
    const { start, end } = monthRange(prev);

    const { data: recs, error } = await supabase
      .from("entries")
      .select("amount, direction, category_id, entry_date, note")
      .eq("is_recurring", true)
      .gte("entry_date", start)
      .lte("entry_date", end);

    if (error) {
      setCopyMsg("Couldn't load last month's entries.");
      setCopying(false);
      return;
    }
    if (!recs || recs.length === 0) {
      setCopyMsg(`No recurring entries in ${monthLabel(prev)}.`);
      setCopying(false);
      return;
    }

    const existing = entries.filter((e) => e.is_recurring).length;
    let msg = `Copy ${recs.length} recurring ${
      recs.length === 1 ? "entry" : "entries"
    } from ${monthLabel(prev)} into ${monthLabel(month)}?`;
    if (existing > 0) {
      msg = `${monthLabel(month)} already has ${existing} recurring ${
        existing === 1 ? "entry" : "entries"
      }.\n\n${msg}`;
    }
    if (!confirm(msg)) {
      setCopying(false);
      return;
    }

    const { days } = monthRange(month);
    const rows = recs.map((r) => ({
      user_id: userId,
      amount: r.amount,
      direction: r.direction,
      category_id: r.category_id,
      entry_date: `${month}-${String(
        Math.min(Number(r.entry_date.slice(8, 10)), days)
      ).padStart(2, "0")}`,
      note: r.note,
      is_recurring: true,
    }));

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
      <div className={styles.monthNav}>
        <Link
          href={`/entries?month=${addMonths(month, -1)}`}
          className={styles.monthArrow}
          aria-label="Previous month"
        >
          ‹
        </Link>
        <h1 className={styles.monthTitle}>{monthLabel(month)}</h1>
        <Link
          href={`/entries?month=${addMonths(month, 1)}`}
          className={styles.monthArrow}
          aria-label="Next month"
        >
          ›
        </Link>
      </div>

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

      {filtered.length === 0 ? (
        <p className={styles.empty}>No entries.</p>
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
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className={styles.copyBtn}
        disabled={copying}
        onClick={() => void copyRecurring()}
      >
        Copy recurring from last month
      </button>
      {copyMsg && <p className={styles.copyMsg}>{copyMsg}</p>}

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
