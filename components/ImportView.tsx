"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, Direction } from "@/lib/types";
import CategoryPicker from "./CategoryPicker";
import formStyles from "./EntryForm.module.css";
import styles from "./ImportView.module.css";

// Must stay in sync with /api/import — kept under Vercel's 4.5MB body limit.
const MAX_BYTES = 4 * 1024 * 1024;

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
};

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
  const [source, setSource] = useState<"pdf" | "csv">("pdf");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{
    batchId: string;
    count: number;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);

  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((prev) =>
      prev ? prev.map((r) => (r.id === id ? { ...r, ...patch } : r)) : prev
    );
  }

  async function parse() {
    if (!file || parsing) return;
    setParsing(true);
    setError(null);
    setRows(null);
    setImported(null);
    setUndone(false);

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

      setSource(json?.source === "csv" ? "csv" : "pdf");
      setRows(
        transactions.map((t) => ({
          id: crypto.randomUUID(),
          include: true,
          date: t.date,
          description: t.description,
          rawDescription: t.rawDescription,
          // Blank out bad amounts so importRows' validation flags them.
          amount:
            Number.isFinite(t.amount) && t.amount > 0
              ? t.amount.toFixed(2)
              : "",
          direction: t.direction,
          catQuery: "",
          selectedCat: null,
        }))
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
      if (
        !/^\d+([.,]\d{1,2})?$/.test(r.amount.trim()) ||
        !(Number(r.amount.trim().replace(",", ".")) > 0)
      ) {
        setError(`"${label}" has an invalid amount.`);
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
        setError(`"${label}" has an invalid date.`);
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
        const name = r.selectedCat?.name ?? r.catQuery.trim();
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
        const name = r.selectedCat?.name ?? r.catQuery.trim();
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
        };
      });

      const { error: insertError } = await supabase
        .from("entries")
        .insert(payload);
      if (insertError) throw insertError;

      setImported({ batchId, count: included.length });
      setRows(null);
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
            Parsed {rows.length} transaction{rows.length === 1 ? "" : "s"} from{" "}
            {source.toUpperCase()}
          </p>

          <ul className={styles.rows}>
            {rows.map((r) => (
              <li
                key={r.id}
                className={r.include ? styles.row : styles.rowExcluded}
              >
                <div className={styles.rowTop}>
                  <label className={styles.include}>
                    <input
                      type="checkbox"
                      checked={r.include}
                      onChange={(e) =>
                        updateRow(r.id, { include: e.target.checked })
                      }
                      aria-label="Include this transaction"
                    />
                    Include
                  </label>
                  <input
                    className={formStyles.input}
                    type="date"
                    value={r.date}
                    onChange={(e) => updateRow(r.id, { date: e.target.value })}
                    aria-label="Date"
                  />
                </div>

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
                    onChange={(e) => updateRow(r.id, { amount: e.target.value })}
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
                      onClick={() => updateRow(r.id, { direction: "out" })}
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
                    updateRow(r.id, { catQuery: q, selectedCat: null })
                  }
                  onPick={(c) =>
                    updateRow(r.id, { catQuery: c.name, selectedCat: c })
                  }
                />
              </li>
            ))}
          </ul>

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
