"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { monthLabel, ukToday } from "@/lib/month";
import type { Category, Direction, Entry } from "@/lib/types";
import styles from "./EntryForm.module.css";

type PendingEntry = {
  tempId: string;
  amount: number;
  direction: Direction;
  categoryId: string | null;
  categoryName: string;
  entryDate: string;
  note: string;
  isRecurring: boolean;
  status: "saving" | "saved" | "error" | "undoing" | "undoFailed";
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export default function EntryForm({
  userId,
  initialCategories,
  monthTotals,
  edit,
  onClose,
}: {
  userId: string;
  initialCategories: Category[];
  monthTotals?: { month: string; in: number; out: number };
  edit?: Entry;
  onClose?: (changed: boolean) => void;
}) {
  const editCat = edit
    ? initialCategories.find((c) => c.id === edit.category_id) ?? null
    : null;

  const [categories, setCategories] = useState(initialCategories);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [direction, setDirection] = useState<Direction>(edit?.direction ?? "out");
  const [catQuery, setCatQuery] = useState(editCat?.name ?? "");
  const [selectedCat, setSelectedCat] = useState<Category | null>(editCat);
  const [entryDate, setEntryDate] = useState(edit?.entry_date ?? ukToday);
  const [note, setNote] = useState(edit?.note ?? "");
  const [isRecurring, setIsRecurring] = useState(edit?.is_recurring ?? false);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // Per pending entry: the in-flight save (resolves to the DB id), and the id
  // of a category the save created inline, so undo can clean it up.
  const syncPromises = useRef(new Map<string, Promise<string>>());
  const createdCategoryIds = useRef(new Map<string, string>());

  const parsedAmount = Number(amount.trim().replace(",", "."));
  const amountValid =
    /^\d+([.,]\d{1,2})?$/.test(amount.trim()) && parsedAmount > 0;

  const trimmedQuery = catQuery.trim();
  const exactMatch = categories.find(
    (c) => c.name.toLowerCase() === trimmedQuery.toLowerCase()
  );
  const chips =
    trimmedQuery && !exactMatch
      ? categories.filter((c) =>
          c.name.toLowerCase().includes(trimmedQuery.toLowerCase())
        )
      : categories;

  const canSave = amountValid && trimmedQuery.length > 0;

  function currentMatch(): Category | null {
    if (
      selectedCat &&
      selectedCat.name.toLowerCase() === trimmedQuery.toLowerCase()
    ) {
      return selectedCat;
    }
    return exactMatch ?? null;
  }

  function pickCategory(c: Category) {
    setSelectedCat(c);
    setCatQuery(c.name);
  }

  function updateEntry(tempId: string, patch: Partial<PendingEntry>) {
    setPending((prev) =>
      prev.map((e) => (e.tempId === tempId ? { ...e, ...patch } : e))
    );
  }

  async function resolveCategory(
    supabase: SupabaseClient,
    name: string,
    knownId: string | null
  ): Promise<{ id: string; created: boolean }> {
    if (knownId) return { id: knownId, created: false };

    const { data: created, error } = await supabase
      .from("categories")
      .insert({ user_id: userId, name })
      .select("id, name")
      .single();

    if (created) {
      setCategories((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      return { id: created.id, created: true };
    }

    // The name may already exist (e.g. created in another tab). Escape the
    // ilike wildcards so % and _ in a name match literally.
    const { data: existing } = await supabase
      .from("categories")
      .select("id, name")
      .ilike("name", name.replace(/[\\%_]/g, "\\$&"))
      .maybeSingle();
    if (!existing) throw error;
    return { id: existing.id, created: false };
  }

  async function doSync(entry: PendingEntry): Promise<string> {
    const supabase = createClient();
    let categoryId = entry.categoryId;

    if (!categoryId) {
      const resolved = await resolveCategory(supabase, entry.categoryName, null);
      categoryId = resolved.id;
      if (resolved.created) {
        createdCategoryIds.current.set(entry.tempId, resolved.id);
      }
      updateEntry(entry.tempId, { categoryId });
    }

    const insertEntry = (catId: string) =>
      supabase
        .from("entries")
        .insert({
          user_id: userId,
          amount: entry.amount,
          direction: entry.direction,
          category_id: catId,
          entry_date: entry.entryDate,
          note: entry.note || null,
          is_recurring: entry.isRecurring,
        })
        .select("id")
        .single();

    let { data, error } = await insertEntry(categoryId);

    // FK violation: the cached category id points at a category that has
    // since been deleted (e.g. by an undo's cleanup racing this save).
    // Re-resolve by name — recreating the category if needed — and retry.
    if (error?.code === "23503") {
      const resolved = await resolveCategory(supabase, entry.categoryName, null);
      categoryId = resolved.id;
      if (resolved.created) {
        createdCategoryIds.current.set(entry.tempId, resolved.id);
      }
      updateEntry(entry.tempId, { categoryId });
      ({ data, error } = await insertEntry(categoryId));
    }

    if (error || !data) throw error;
    return data.id;
  }

  function sync(entry: PendingEntry) {
    updateEntry(entry.tempId, { status: "saving" });
    const promise = doSync(entry);
    syncPromises.current.set(entry.tempId, promise);
    promise
      .then(() => {
        // Don't flip back to "saved" if an undo is already waiting on us.
        setPending((prev) =>
          prev.map((e) =>
            e.tempId === entry.tempId && e.status !== "undoing"
              ? { ...e, status: "saved" }
              : e
          )
        );
      })
      .catch(() => updateEntry(entry.tempId, { status: "error" }));
  }

  async function undo(entry: PendingEntry) {
    updateEntry(entry.tempId, { status: "undoing" });

    let dbId: string;
    try {
      dbId = await syncPromises.current.get(entry.tempId)!;
    } catch {
      // The save itself failed; sync's handler shows "Failed — retry".
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.from("entries").delete().eq("id", dbId);
    if (error) {
      updateEntry(entry.tempId, { status: "undoFailed" });
      return;
    }

    // If this save created the category and it's now unused, remove it too.
    // No advisory count — the FK's "on delete restrict" makes the delete
    // itself the atomic "only if unreferenced" check: it fails if any entry
    // references the category, including one committing concurrently.
    const catId = createdCategoryIds.current.get(entry.tempId);
    if (catId) {
      // Let saves already in flight land first, so a category they're about
      // to use is kept rather than deleted out from under them.
      await Promise.allSettled([...syncPromises.current.values()]);
      const { error: catError } = await supabase
        .from("categories")
        .delete()
        .eq("id", catId);
      if (!catError) {
        setCategories((prev) => prev.filter((c) => c.id !== catId));
      }
    }

    syncPromises.current.delete(entry.tempId);
    createdCategoryIds.current.delete(entry.tempId);
    setPending((prev) => prev.filter((e) => e.tempId !== entry.tempId));
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    setEditError(null);
    const supabase = createClient();
    try {
      const match = currentMatch();
      const { id: categoryId } = await resolveCategory(
        supabase,
        match?.name ?? trimmedQuery,
        match?.id ?? null
      );
      const { error } = await supabase
        .from("entries")
        .update({
          amount: Math.round(parsedAmount * 100) / 100,
          direction,
          category_id: categoryId,
          entry_date: entryDate,
          note: note.trim() || null,
          is_recurring: isRecurring,
        })
        .eq("id", edit.id);
      if (error) throw error;
      onClose?.(true);
    } catch {
      setEditError("Couldn't save. Try again.");
      setBusy(false);
    }
  }

  async function deleteEntry() {
    if (!edit || !confirm("Delete this entry?")) return;
    setBusy(true);
    setEditError(null);
    const { error } = await createClient()
      .from("entries")
      .delete()
      .eq("id", edit.id);
    if (error) {
      setEditError("Couldn't delete. Try again.");
      setBusy(false);
      return;
    }
    onClose?.(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || busy) return;

    if (edit) {
      void saveEdit();
      return;
    }

    const match = currentMatch();
    const entry: PendingEntry = {
      tempId: crypto.randomUUID(),
      amount: Math.round(parsedAmount * 100) / 100,
      direction,
      categoryId: match?.id ?? null,
      categoryName: match?.name ?? trimmedQuery,
      entryDate,
      note: note.trim(),
      isRecurring,
      status: "saving",
    };

    setPending((prev) => [entry, ...prev]);
    sync(entry);

    // Reset for the next entry, keeping the last-used date for back-filling.
    setAmount("");
    setDirection("out");
    setCatQuery("");
    setSelectedCat(null);
    setNote("");
    setIsRecurring(false);
    amountRef.current?.focus();
  }

  // Optimistic strip totals: server figures plus this session's pending
  // entries that exist (or will exist) in the DB, minus ones being undone.
  // The month comes with the server totals so filter, link, and figures
  // always describe the same month.
  let stripIn = monthTotals?.in ?? 0;
  let stripOut = monthTotals?.out ?? 0;
  if (monthTotals) {
    for (const e of pending) {
      const counts =
        e.status === "saving" || e.status === "saved" || e.status === "undoFailed";
      if (!counts || !e.entryDate.startsWith(monthTotals.month)) continue;
      if (e.direction === "in") stripIn += e.amount;
      else stripOut += e.amount;
    }
  }
  const stripNet = stripIn - stripOut;

  return (
    <>
      {!edit && monthTotals && (
        <Link href={`/entries?month=${monthTotals.month}`} className={styles.strip}>
          <span className={styles.stripMonth}>
            {monthLabel(monthTotals.month)}
          </span>
          <span className={styles.stripFigures}>
            <span className={styles.stripItem}>
              <span className={styles.stripLabel}>In</span>
              {gbp.format(stripIn)}
            </span>
            <span className={styles.stripItem}>
              <span className={styles.stripLabel}>Out</span>
              {gbp.format(stripOut)}
            </span>
            <span
              className={
                stripNet > 0 ? styles.stripNetPositive : styles.stripNetValue
              }
            >
              <span className={styles.stripLabel}>Net</span>
              {gbp.format(stripNet)}
            </span>
          </span>
          <span className={styles.stripChevron} aria-hidden="true">
            ›
          </span>
        </Link>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <input
          ref={amountRef}
          className={styles.amount}
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus={!edit}
          enterKeyHint="done"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
        />

        <div className={styles.toggle} role="group" aria-label="Direction">
          <button
            type="button"
            className={direction === "out" ? styles.toggleActive : styles.toggleBtn}
            onClick={() => setDirection("out")}
          >
            Out
          </button>
          <button
            type="button"
            className={direction === "in" ? styles.toggleActive : styles.toggleBtn}
            onClick={() => setDirection("in")}
          >
            In
          </button>
        </div>

        <div className={styles.field}>
          <input
            className={styles.input}
            type="text"
            placeholder="Category"
            value={catQuery}
            onChange={(e) => {
              setCatQuery(e.target.value);
              setSelectedCat(null);
            }}
            aria-label="Category"
          />
          <div className={styles.chips}>
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className={
                  (selectedCat?.id ?? exactMatch?.id) === c.id
                    ? styles.chipActive
                    : styles.chip
                }
                onClick={() => pickCategory(c)}
              >
                {c.name}
              </button>
            ))}
            {trimmedQuery && !exactMatch && (
              <span className={styles.newChip}>+ &ldquo;{trimmedQuery}&rdquo;</span>
            )}
          </div>
        </div>

        <div className={styles.row}>
          <input
            className={styles.input}
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            aria-label="Date"
          />
          <label className={styles.recurring}>
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
            />
            Recurring
          </label>
        </div>

        <input
          className={styles.input}
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
        />

        {editError && <p className={styles.formError}>{editError}</p>}

        <button type="submit" className={styles.save} disabled={!canSave || busy}>
          Save
        </button>

        {edit && (
          <div className={styles.editActions}>
            <button
              type="button"
              className={styles.cancel}
              disabled={busy}
              onClick={() => onClose?.(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.delete}
              disabled={busy}
              onClick={() => void deleteEntry()}
            >
              Delete
            </button>
          </div>
        )}
      </form>

      {!edit && pending.length > 0 && (
        <ul className={styles.recent}>
          {pending.map((e, i) => {
            const undoable =
              i === 0 && (e.status === "saved" || e.status === "saving");
            return (
              <li
                key={e.tempId}
                className={
                  e.status === "error" || e.status === "undoFailed"
                    ? styles.recentError
                    : styles.recentItem
                }
              >
                <span className={styles.recentText}>
                  {e.direction === "out" ? "−" : "+"}
                  {gbp.format(e.amount)} · {e.categoryName}
                  {e.note && ` · ${e.note}`}
                </span>
                <span className={styles.rowEnd}>
                  {e.status === "saving" && (
                    <span className={styles.status}>Saving…</span>
                  )}
                  {e.status === "saved" && (
                    <span className={styles.statusSaved}>Saved ✓</span>
                  )}
                  {e.status === "undoing" && (
                    <span className={styles.status}>Undoing…</span>
                  )}
                  {undoable && (
                    <>
                      <span className={styles.status}>·</span>
                      <button
                        type="button"
                        className={styles.undo}
                        onClick={() => void undo(e)}
                      >
                        Undo
                      </button>
                    </>
                  )}
                  {(e.status === "error" || e.status === "undoFailed") && (
                    <button
                      type="button"
                      className={styles.retry}
                      onClick={() =>
                        e.status === "error" ? sync(e) : void undo(e)
                      }
                    >
                      Failed — retry
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
