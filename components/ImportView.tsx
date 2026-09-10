"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { computeFingerprint } from "@/lib/fingerprint";
import type { Category, Direction } from "@/lib/types";
import CategoryPicker from "./CategoryPicker";
import formStyles from "./EntryForm.module.css";
import styles from "./ImportView.module.css";

// Must stay in sync with /api/import — kept under Vercel's 4.5MB body limit.
const MAX_BYTES = 4 * 1024 * 1024;

const PAGE_SIZE = 50;

type ReviewRow = {
  id: string;
  include: boolean;
  date: string;
  description: string;
  rawDescription: string;
  amount: string;
  direction: Direction;
  catQuery: string;
  selectedCat: Category | null;
  // Computed at parse time from the ORIGINAL date/amount/raw description,
  // and stored as-is on import even if the row is edited — it identifies
  // the source statement row, so a re-import of the same statement still
  // matches. Null when the raw description is empty (never matches).
  fingerprint: string | null;
  duplicate: boolean;
  guessed: boolean;
};

// Mirrors how importRows resolves the category on save.
function rowCategoryName(r: ReviewRow): string {
  return r.selectedCat?.name ?? r.catQuery.trim();
}

function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3])
  ).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// Category-guess matching key: lowercase, letters only (digits and
// punctuation become spaces), whitespace collapsed — so "ASDA STORES 4425"
// and "Asda Stores 1102" both become "asda stores" regardless of store or
// card number.
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Exact normalised match first, then a word-boundary prefix either way —
// "asda superstore" matches a stored "asda superstore harrogate".
function guessCategory(
  key: string,
  byKey: Map<string, Category>
): Category | null {
  if (!key) return null;
  const exact = byKey.get(key);
  if (exact) return exact;
  for (const [k, cat] of byKey) {
    if (k.startsWith(key + " ") || key.startsWith(k + " ")) return cat;
  }
  return null;
}

export default function ImportView({
  categories,
  userId,
}: {
  categories: Category[];
  userId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{
    batchId: string;
    count: number;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [bulkCatId, setBulkCatId] = useState("");

  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((prev) =>
      prev ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev
    );
  }

  function setAllInclude(include: boolean) {
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, include })) : prev));
  }

  function assignCategoryToUncategorized() {
    const cat = categories.find((c) => c.id === bulkCatId);
    if (!cat) return;
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.include && !rowCategoryName(r)
              ? { ...r, catQuery: cat.name, selectedCat: cat, guessed: false }
              : r
          )
        : prev
    );
  }

  function goToPage(p: number) {
    setPage(p);
    window.scrollTo({ top: 0 });
  }

  async function parse() {
    if (!file || parsing) return;
    setParsing(true);
    setError(null);
    setRows(null);
    setImported(null);
    setUndone(false);
    setExpandedId(null);
    setPage(0);
    setBulkCatId("");

    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.error ?? "Something went wrong. Try again.");
        return;
      }

      const transactions: {
        date: string;
        description: string;
        rawDescription: string;
        amount: number;
        direction: Direction;
      }[] = json?.transactions ?? [];

      // Fingerprint every row, look up which already exist, and build the
      // category-guess map from past entries. All of this degrades to "no
      // duplicates, no guesses" if anything fails (e.g. the fingerprint
      // migration hasn't run yet) — the review screen still works.
      let fingerprints: (string | null)[] = transactions.map(() => null);
      const existing = new Set<string>();
      const guessByKey = new Map<string, Category>();
      try {
        const supabase = createClient();

        fingerprints = await Promise.all(
          transactions.map((t) =>
            Number.isFinite(t.amount) && t.amount > 0
              ? computeFingerprint(t.date, t.amount, t.rawDescription)
              : null
          )
        );

        // Chunked so 200+ hashes don't blow past URL length limits.
        const unique = [
          ...new Set(fingerprints.filter((f): f is string => f !== null)),
        ];
        for (let i = 0; i < unique.length; i += 100) {
          const { data } = await supabase
            .from("entries")
            .select("fingerprint")
            .in("fingerprint", unique.slice(i, i + 100));
          for (const e of data ?? []) {
            if (e.fingerprint) existing.add(e.fingerprint);
          }
        }

        // Most recent entry per normalised note wins the guess.
        const catById = new Map(categories.map((c) => [c.id, c]));
        const { data: history } = await supabase
          .from("entries")
          .select("note, category_id")
          .not("category_id", "is", null)
          .not("note", "is", null)
          .order("entry_date", { ascending: false })
          .limit(2000);
        for (const h of history ?? []) {
          const key = normalizeForMatch(h.note);
          const cat = catById.get(h.category_id);
          if (key && cat && !guessByKey.has(key)) guessByKey.set(key, cat);
        }
      } catch {
        // Parsed rows are still worth showing without dupes/guesses.
      }

      setRows(
        transactions.map((t, i) => {
          const fingerprint = fingerprints[i];
          const duplicate = fingerprint !== null && existing.has(fingerprint);
          const guess = guessCategory(
            normalizeForMatch(t.description),
            guessByKey
          );
          return {
            id: crypto.randomUUID(),
            include: !duplicate,
            date: t.date,
            description: t.description,
            rawDescription: t.rawDescription,
            // Blank out bad amounts so importRows' validation flags them.
            amount:
              Number.isFinite(t.amount) && t.amount > 0
                ? t.amount.toFixed(2)
                : "",
            direction: t.direction,
            catQuery: guess?.name ?? "",
            selectedCat: guess,
            fingerprint,
            duplicate,
            guessed: guess !== null,
          };
        })
      );
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setParsing(false);
    }
  }

  function onPickFile(f: File | null) {
    setError(null);
    if (f) {
      const name = f.name.toLowerCase();
      if (!name.endsWith(".pdf") && !name.endsWith(".csv")) {
        setFile(null);
        setError("Only PDF and CSV files are supported.");
        return;
      }
      if (f.size > MAX_BYTES) {
        setFile(null);
        setError(
          "File is too large — the limit is 4MB. Try a CSV export instead; those are far smaller."
        );
        return;
      }
    }
    setFile(f);
  }

  async function importRows() {
    if (!rows || importing) return;
    const included = rows.filter((r) => r.include);
    if (included.length === 0) return;

    for (const r of included) {
      const label = r.description.trim() || r.rawDescription;
      const invalidAmount =
        !/^\d+([.,]\d{1,2})?$/.test(r.amount.trim()) ||
        !(Number(r.amount.trim().replace(",", ".")) > 0);
      const invalidDate = !/^\d{4}-\d{2}-\d{2}$/.test(r.date);
      if (invalidAmount || invalidDate) {
        // Jump to the offending row so the error isn't on a hidden page.
        const idx = rows.findIndex((x) => x.id === r.id);
        if (idx >= 0) goToPage(Math.floor(idx / PAGE_SIZE));
        setExpandedId(r.id);
        setError(
          `"${label}" has an invalid ${invalidAmount ? "amount" : "date"}.`
        );
        return;
      }
    }

    setImporting(true);
    setError(null);
    const supabase = createClient();

    try {
      // Resolve category names to ids, creating missing ones once each.
      const idByName = new Map(
        categories.map((c) => [c.name.toLowerCase(), c.id])
      );
      for (const r of included) {
        const name = rowCategoryName(r);
        if (!name || idByName.has(name.toLowerCase())) continue;

        const { data: created, error: createError } = await supabase
          .from("categories")
          .insert({ user_id: userId, name })
          .select("id")
          .single();
        if (created) {
          idByName.set(name.toLowerCase(), created.id);
          continue;
        }
        // The name may already exist (e.g. created in another tab).
        const { data: existing } = await supabase
          .from("categories")
          .select("id")
          .ilike("name", name.replace(/[\\%_]/g, "\\$&"))
          .maybeSingle();
        if (!existing) throw createError;
        idByName.set(name.toLowerCase(), existing.id);
      }

      const batchId = crypto.randomUUID();
      const payload = included.map((r) => {
        const name = rowCategoryName(r);
        return {
          user_id: userId,
          amount:
            Math.round(Number(r.amount.trim().replace(",", ".")) * 100) / 100,
          direction: r.direction,
          category_id: name ? idByName.get(name.toLowerCase()) ?? null : null,
          entry_date: r.date,
          note: r.description.trim() || r.rawDescription,
          is_recurring: false,
          import_batch: batchId,
          fingerprint: r.fingerprint,
        };
      });

      const { error: insertError } = await supabase
        .from("entries")
        .insert(payload);
      if (insertError) throw insertError;

      setImported({ batchId, count: included.length });
      setRows(null);
      setExpandedId(null);
      setPage(0);
    } catch {
      setError("Import failed — no entries were created.");
    } finally {
      setImporting(false);
    }
  }

  async function undoImport() {
    if (!imported || undoing) return;
    if (
      !confirm(
        `Delete all ${imported.count} ${
          imported.count === 1 ? "entry" : "entries"
        } from this import?`
      )
    ) {
      return;
    }
    setUndoing(true);
    setError(null);
    const { error: deleteError } = await createClient()
      .from("entries")
      .delete()
      .eq("import_batch", imported.batchId);
    if (deleteError) {
      setError("Couldn't undo the import. Try again.");
      setUndoing(false);
      return;
    }
    setUndone(true);
    setUndoing(false);
  }

  const isPdf = file?.name.toLowerCase().endsWith(".pdf") ?? false;
  const includedCount = rows?.filter((r) => r.include).length ?? 0;
  const needCategoryCount =
    rows?.filter((r) => r.include && !rowCategoryName(r)).length ?? 0;
  const duplicateCount = rows?.filter((r) => r.duplicate).length ?? 0;
  const categorisedCount =
    rows?.filter((r) => rowCategoryName(r)).length ?? 0;
  const pageCount = rows ? Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows
    ? rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    : [];

  return (
    <div className={styles.view}>
      <h1 className={styles.title}>Import statement</h1>

      <input
        className={styles.file}
        type="file"
        accept=".pdf,.csv,application/pdf,text/csv"
        aria-label="Bank statement (PDF or CSV)"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className={formStyles.save}
        disabled={!file || parsing}
        onClick={() => void parse()}
      >
        {parsing ? "Parsing…" : "Parse statement"}
      </button>
      {parsing && isPdf && (
        <p className={styles.hint}>Reading the PDF — this can take a minute.</p>
      )}
      {error && <p className={formStyles.formError}>{error}</p>}

      {imported &&
        (undone ? (
          <p className={styles.count}>
            Import undone — {imported.count}{" "}
            {imported.count === 1 ? "entry" : "entries"} deleted.
          </p>
        ) : (
          <div className={styles.confirm}>
            <p className={styles.count}>
              Imported {imported.count}{" "}
              {imported.count === 1 ? "entry" : "entries"}.
            </p>
            <button
              type="button"
              className={styles.undoBtn}
              disabled={undoing}
              onClick={() => void undoImport()}
            >
              {undoing ? "Undoing…" : "Undo this import"}
            </button>
          </div>
        ))}

      {rows && (
        <>
          <p className={styles.count}>
            Parsed {rows.length} transaction{rows.length === 1 ? "" : "s"} —{" "}
            {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"}{" "}
            unticked, {categorisedCount} categorised
          </p>

          <div className={styles.bulkBar}>
            <p className={styles.bulkCounts}>
              <strong>{includedCount}</strong> of {rows.length} included ·{" "}
              {needCategoryCount === 0 ? (
                "all have a category"
              ) : (
                <>
                  <strong>{needCategoryCount}</strong> need a category
                </>
              )}
            </p>
            <div className={styles.bulkActions}>
              <button
                type="button"
                className={styles.bulkBtn}
                disabled={includedCount === rows.length}
                onClick={() => setAllInclude(true)}
              >
                Include all
              </button>
              <button
                type="button"
                className={styles.bulkBtn}
                disabled={includedCount === 0}
                onClick={() => setAllInclude(false)}
              >
                Exclude all
              </button>
            </div>
            <div className={styles.bulkAssign}>
              <select
                className={styles.bulkSelect}
                value={bulkCatId}
                onChange={(e) => setBulkCatId(e.target.value)}
                aria-label="Category to assign to uncategorised rows"
              >
                <option value="">Choose a category…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.bulkBtn}
                disabled={!bulkCatId || needCategoryCount === 0}
                onClick={assignCategoryToUncategorized}
              >
                Set for {needCategoryCount}
              </button>
            </div>
          </div>

          <ul className={styles.rows}>
            {pageRows.map((r) => {
              const expanded = expandedId === r.id;
              const catName = rowCategoryName(r);
              return (
                <li
                  key={r.id}
                  className={r.include ? styles.row : styles.rowExcluded}
                >
                  <div className={styles.summary}>
                    <input
                      type="checkbox"
                      className={styles.includeBox}
                      checked={r.include}
                      onChange={(e) =>
                        updateRow(r.id, { include: e.target.checked })
                      }
                      aria-label="Include this transaction"
                    />
                    <button
                      type="button"
                      className={styles.summaryBtn}
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                    >
                      <span className={styles.sumDate}>
                        {shortDate(r.date)}
                      </span>
                      <span className={styles.sumDesc}>
                        {r.description.trim() || r.rawDescription}
                      </span>
                      {r.duplicate && (
                        <span className={styles.dupBadge}>
                          Already recorded
                        </span>
                      )}
                      <span
                        className={
                          catName
                            ? r.guessed
                              ? styles.sumCatGuessed
                              : styles.sumCat
                            : styles.sumNoCat
                        }
                        title={
                          r.guessed
                            ? "Guessed from a similar past entry"
                            : undefined
                        }
                      >
                        {catName || "No category"}
                      </span>
                      <span
                        className={
                          r.direction === "in"
                            ? styles.sumAmountIn
                            : styles.sumAmount
                        }
                      >
                        {r.amount ? (
                          <>
                            <span className={styles.sign}>
                              {r.direction === "in" ? "+" : "−"}
                            </span>
                            {r.amount}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </button>
                  </div>

                  {expanded && (
                    <div className={styles.expanded}>
                      <input
                        className={formStyles.input}
                        type="date"
                        value={r.date}
                        onChange={(e) =>
                          updateRow(r.id, { date: e.target.value })
                        }
                        aria-label="Date"
                      />

                      <div className={styles.descField}>
                        <input
                          className={formStyles.input}
                          type="text"
                          value={r.description}
                          onChange={(e) =>
                            updateRow(r.id, { description: e.target.value })
                          }
                          aria-label="Description"
                        />
                        <p className={styles.rawDesc}>{r.rawDescription}</p>
                      </div>

                      <div className={styles.rowMid}>
                        <input
                          className={formStyles.input}
                          type="text"
                          inputMode="decimal"
                          value={r.amount}
                          onChange={(e) =>
                            updateRow(r.id, { amount: e.target.value })
                          }
                          aria-label="Amount"
                        />
                        <div
                          className={formStyles.toggle}
                          role="group"
                          aria-label="Direction"
                        >
                          <button
                            type="button"
                            className={
                              r.direction === "out"
                                ? formStyles.toggleActive
                                : formStyles.toggleBtn
                            }
                            onClick={() =>
                              updateRow(r.id, { direction: "out" })
                            }
                          >
                            Out
                          </button>
                          <button
                            type="button"
                            className={
                              r.direction === "in"
                                ? formStyles.toggleActive
                                : formStyles.toggleBtn
                            }
                            onClick={() => updateRow(r.id, { direction: "in" })}
                          >
                            In
                          </button>
                        </div>
                      </div>

                      <CategoryPicker
                        categories={categories}
                        query={r.catQuery}
                        selected={r.selectedCat}
                        onQueryChange={(q) =>
                          updateRow(r.id, {
                            catQuery: q,
                            selectedCat: null,
                            guessed: false,
                          })
                        }
                        onPick={(c) =>
                          updateRow(r.id, {
                            catQuery: c.name,
                            selectedCat: c,
                            guessed: false,
                          })
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {pageCount > 1 && (
            <nav className={styles.pager} aria-label="Transaction pages">
              <button
                type="button"
                className={styles.bulkBtn}
                disabled={safePage === 0}
                onClick={() => goToPage(safePage - 1)}
              >
                ‹ Prev
              </button>
              <span className={styles.pagerInfo}>
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                className={styles.bulkBtn}
                disabled={safePage === pageCount - 1}
                onClick={() => goToPage(safePage + 1)}
              >
                Next ›
              </button>
            </nav>
          )}

          <button
            type="button"
            className={formStyles.save}
            disabled={importing || includedCount === 0}
            onClick={() => void importRows()}
          >
            {importing
              ? "Importing…"
              : `Import ${includedCount} ${
                  includedCount === 1 ? "entry" : "entries"
                }`}
          </button>
        </>
      )}
    </div>
  );
}
