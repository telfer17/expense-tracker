"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ukToday } from "@/lib/month";
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
  status: "saving" | "saved" | "error";
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export default function EntryForm({
  userId,
  initialCategories,
  edit,
  onClose,
}: {
  userId: string;
  initialCategories: Category[];
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

  async function resolveCategoryId(
    supabase: SupabaseClient,
    name: string,
    knownId: string | null
  ): Promise<string> {
    if (knownId) return knownId;

    const { data: created, error } = await supabase
      .from("categories")
      .insert({ user_id: userId, name })
      .select("id, name")
      .single();

    if (created) {
      setCategories((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      return created.id;
    }

    // The name may already exist (e.g. created in another tab). Escape the
    // ilike wildcards so % and _ in a name match literally.
    const { data: existing } = await supabase
      .from("categories")
      .select("id, name")
      .ilike("name", name.replace(/[\\%_]/g, "\\$&"))
      .maybeSingle();
    if (!existing) throw error;
    return existing.id;
  }

  async function sync(entry: PendingEntry) {
    updateEntry(entry.tempId, { status: "saving" });
    const supabase = createClient();
    try {
      const categoryId = await resolveCategoryId(
        supabase,
        entry.categoryName,
        entry.categoryId
      );
      updateEntry(entry.tempId, { categoryId });

      const { error } = await supabase.from("entries").insert({
        user_id: userId,
        amount: entry.amount,
        direction: entry.direction,
        category_id: categoryId,
        entry_date: entry.entryDate,
        note: entry.note || null,
        is_recurring: entry.isRecurring,
      });
      if (error) throw error;

      updateEntry(entry.tempId, { status: "saved" });
    } catch {
      updateEntry(entry.tempId, { status: "error" });
    }
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    setEditError(null);
    const supabase = createClient();
    try {
      const match = currentMatch();
      const categoryId = await resolveCategoryId(
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
    void sync(entry);

    // Reset for the next entry, keeping the last-used date for back-filling.
    setAmount("");
    setDirection("out");
    setCatQuery("");
    setSelectedCat(null);
    setNote("");
    setIsRecurring(false);
    amountRef.current?.focus();
  }

  return (
    <>
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
          {pending.map((e) => (
            <li
              key={e.tempId}
              className={e.status === "error" ? styles.recentError : styles.recentItem}
            >
              <span className={styles.recentText}>
                {e.direction === "out" ? "−" : "+"}
                {gbp.format(e.amount)} · {e.categoryName}
                {e.note && ` · ${e.note}`}
              </span>
              {e.status === "saving" && <span className={styles.status}>Saving…</span>}
              {e.status === "saved" && (
                <span className={styles.statusSaved}>Saved ✓</span>
              )}
              {e.status === "error" && (
                <button
                  type="button"
                  className={styles.retry}
                  onClick={() => void sync(e)}
                >
                  Failed — retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
