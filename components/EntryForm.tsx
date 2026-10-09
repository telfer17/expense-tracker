"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ilikeLiteral, withTypedCategory } from "@/lib/categories";
import { computeFingerprint } from "@/lib/fingerprint";
import { addDays, ukToday } from "@/lib/month";
import {
  categoryIdsOf,
  type Category,
  type CategoryPick,
  type Direction,
  type Entry,
} from "@/lib/types";
import CategoryPicker from "./CategoryPicker";
import styles from "./EntryForm.module.css";
import overlayStyles from "./EntriesView.module.css";

// A recent distinct entry offered as a one-tap prefill on the add screen.
export type QuickAddItem = {
  label: string;
  note: string;
  categoryIds: string[];
  direction: Direction;
};

type PendingEntry = {
  tempId: string;
  amount: number;
  direction: Direction;
  // Ids fill in as inline-created categories are resolved by the save.
  categories: CategoryPick[];
  entryDate: string;
  note: string;
  isRecurring: boolean;
  status: "saving" | "saved" | "error" | "undoing" | "undoFailed";
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function pickNames(picks: CategoryPick[]): string {
  return picks.map((p) => p.name).join(", ");
}

export default function EntryForm({
  userId,
  initialCategories,
  periodTotals,
  periodNote,
  quickAdd,
  edit,
  onClose,
}: {
  userId: string;
  initialCategories: Category[];
  periodTotals?: {
    label: string;
    start: string;
    end: string | null;
    href: string;
    in: number;
    out: number;
  };
  periodNote?: string | null;
  quickAdd?: QuickAddItem[];
  edit?: Entry;
  onClose?: (changed: boolean) => void;
}) {
  const editCats: CategoryPick[] = edit
    ? initialCategories
        .filter((c) => edit.category_ids.includes(c.id))
        .map((c) => ({ id: c.id, name: c.name }))
    : [];

  const [categories, setCategories] = useState(initialCategories);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [direction, setDirection] = useState<Direction>(edit?.direction ?? "out");
  const [catQuery, setCatQuery] = useState("");
  const [selectedCats, setSelectedCats] = useState<CategoryPick[]>(editCats);
  const [entryDate, setEntryDate] = useState(edit?.entry_date ?? ukToday);
  const [note, setNote] = useState(edit?.note ?? "");
  const [isRecurring, setIsRecurring] = useState(edit?.is_recurring ?? false);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<{
    amount: number;
    category: string;
    date: string;
    note: string | null;
  } | null>(null);
  // A saved session entry being edited in the overlay: its local row plus
  // the DB id its save resolved to.
  const [pendingEdit, setPendingEdit] = useState<{
    tempId: string;
    dbId: string;
  } | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // Per pending entry: the in-flight save (resolves to the DB id), and the
  // ids of categories the save created inline, so undo can clean them up.
  const syncPromises = useRef(new Map<string, Promise<string>>());
  const createdCategoryIds = useRef(new Map<string, string[]>());

  const parsedAmount = Number(amount.trim().replace(",", "."));
  const amountValid =
    /^\d+([.,]\d{1,2})?$/.test(amount.trim()) && parsedAmount > 0;

  // What a save would use right now: the chips plus any typed name.
  const effectiveCats = withTypedCategory(selectedCats, catQuery, categories);
  const canSave = amountValid && effectiveCats.length > 0;

  // Duplicate warning: same amount + any shared category within the last
  // 7 days, debounced so it doesn't query on every keystroke. Recurring is
  // out on both sides — those legitimately repeat. A warning only, never
  // a block.
  const dupCatIds = effectiveCats
    .map((c) => c.id)
    .filter((id): id is string => id !== null)
    .sort();
  const dupCatKey = dupCatIds.join(",");
  const dupAmount = amountValid ? Math.round(parsedAmount * 100) / 100 : null;
  useEffect(() => {
    setDupWarning(null);
    if (edit || dupAmount === null || !dupCatKey || isRecurring) return;
    const ids = dupCatKey.split(",");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await createClient()
        .from("entries")
        .select("entry_date, note, entry_categories!inner(category_id)")
        .in("entry_categories.category_id", ids)
        .eq("amount", dupAmount)
        .eq("is_recurring", false)
        .gte("entry_date", addDays(entryDate, -7))
        .lte("entry_date", entryDate)
        .order("entry_date", { ascending: false })
        .limit(1);
      if (!cancelled && data?.[0]) {
        const shared = new Set(categoryIdsOf(data[0].entry_categories));
        const names = categories
          .filter((c) => shared.has(c.id))
          .map((c) => c.name);
        setDupWarning({
          amount: dupAmount,
          category: names.join(", "),
          date: data[0].entry_date,
          note: data[0].note,
        });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [edit, dupAmount, dupCatKey, isRecurring, entryDate, categories]);

  useEffect(() => {
    if (!pendingEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingEdit(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingEdit]);

  function applyQuickAdd(item: QuickAddItem) {
    setSelectedCats(
      categories
        .filter((c) => item.categoryIds.includes(c.id))
        .map((c) => ({ id: c.id, name: c.name }))
    );
    setCatQuery("");
    setNote(item.note);
    setDirection(item.direction);
    // The amount is always typed fresh.
    amountRef.current?.focus();
  }

  function updateEntry(tempId: string, patch: Partial<PendingEntry>) {
    setPending((prev) =>
      prev.map((e) => (e.tempId === tempId ? { ...e, ...patch } : e))
    );
  }

  async function resolveCategory(
    supabase: SupabaseClient,
    name: string
  ): Promise<{ id: string; created: boolean }> {
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

    // The name may already exist (e.g. created in another tab).
    const { data: existing } = await supabase
      .from("categories")
      .select("id, name")
      .ilike("name", ilikeLiteral(name))
      .maybeSingle();
    if (!existing) throw error;
    return { id: existing.id, created: false };
  }

  // Resolve every pick to an id, creating the inline ones. Returns the
  // picks with ids filled in (deduplicated) and the ids this call created.
  async function resolveCategories(
    supabase: SupabaseClient,
    picks: CategoryPick[]
  ): Promise<{ picks: CategoryPick[]; createdIds: string[] }> {
    const resolved: CategoryPick[] = [];
    const createdIds: string[] = [];
    for (const p of picks) {
      let id = p.id;
      if (!id) {
        const r = await resolveCategory(supabase, p.name);
        id = r.id;
        if (r.created) createdIds.push(id);
      }
      if (!resolved.some((r) => r.id === id)) resolved.push({ id, name: p.name });
    }
    return { picks: resolved, createdIds };
  }

  // Attach categories to a saved entry row.
  function linkCategories(
    supabase: SupabaseClient,
    entryId: string,
    ids: string[]
  ) {
    return supabase.from("entry_categories").insert(
      ids.map((category_id) => ({
        entry_id: entryId,
        category_id,
        user_id: userId,
      }))
    );
  }

  async function doSync(entry: PendingEntry): Promise<string> {
    const supabase = createClient();

    // Manual entries fingerprint their note (null when it's empty — never
    // matches), so a statement row covering the same transaction can be
    // flagged as a duplicate on import.
    const fingerprint = await computeFingerprint(
      entry.entryDate,
      entry.amount,
      entry.note
    );

    const attempt = async (
      picks: CategoryPick[]
    ): Promise<{ id: string } | { error: { code?: string } | null }> => {
      const resolved = await resolveCategories(supabase, picks);
      if (resolved.createdIds.length) {
        const prev = createdCategoryIds.current.get(entry.tempId) ?? [];
        createdCategoryIds.current.set(entry.tempId, [
          ...prev,
          ...resolved.createdIds,
        ]);
      }
      updateEntry(entry.tempId, { categories: resolved.picks });
      const ids = resolved.picks.map((p) => p.id!);

      const { data, error } = await supabase
        .from("entries")
        .insert({
          user_id: userId,
          amount: entry.amount,
          direction: entry.direction,
          // Legacy single-category column, kept until the join-table
          // backfill is verified: always one of the entry's categories.
          category_id: ids[0] ?? null,
          entry_date: entry.entryDate,
          note: entry.note || null,
          is_recurring: entry.isRecurring,
          fingerprint,
        })
        .select("id")
        .single();
      if (error || !data) return { error };

      const { error: linkError } = await linkCategories(supabase, data.id, ids);
      if (linkError) {
        // Never leave a half-saved entry behind; the row offers a retry.
        await supabase.from("entries").delete().eq("id", data.id);
        return { error: linkError };
      }
      return { id: data.id };
    };

    let result = await attempt(entry.categories);

    // FK violation: a cached category id points at a category that has
    // since been deleted (e.g. by an undo's cleanup racing this save).
    // Re-resolve every category by name — recreating as needed — and retry.
    if ("error" in result && result.error?.code === "23503") {
      result = await attempt(
        entry.categories.map((c) => ({ id: null, name: c.name }))
      );
    }

    if ("error" in result) throw result.error;
    return result.id;
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

    // If this save created categories that are now unused, remove them
    // too. No advisory count — the FKs' "on delete restrict" makes the
    // delete itself the atomic "only if unreferenced" check: it fails if
    // any entry references the category, including one committing
    // concurrently.
    const catIds = createdCategoryIds.current.get(entry.tempId) ?? [];
    if (catIds.length) {
      // Let saves already in flight land first, so a category they're about
      // to use is kept rather than deleted out from under them.
      await Promise.allSettled([...syncPromises.current.values()]);
      for (const catId of catIds) {
        const { error: catError } = await supabase
          .from("categories")
          .delete()
          .eq("id", catId);
        if (!catError) {
          setCategories((prev) => prev.filter((c) => c.id !== catId));
        }
      }
    }

    syncPromises.current.delete(entry.tempId);
    createdCategoryIds.current.delete(entry.tempId);
    setPending((prev) => prev.filter((e) => e.tempId !== entry.tempId));
  }

  // Session entries are editable in place once their save has an id.
  async function editPending(entry: PendingEntry) {
    const promise = syncPromises.current.get(entry.tempId);
    if (!promise) return;
    let dbId: string;
    try {
      dbId = await promise;
    } catch {
      return; // the save failed; the row already offers retry
    }
    setPendingEdit({ tempId: entry.tempId, dbId });
  }

  // After an overlay edit, re-read the entry so the session row (and the
  // optimistic strip totals) reflect what's actually stored now.
  async function refreshPending(tempId: string, dbId: string) {
    const { data, error } = await createClient()
      .from("entries")
      .select(
        "amount, direction, entry_date, note, is_recurring, entry_categories(category_id, categories(name))"
      )
      .eq("id", dbId)
      .maybeSingle();
    // A failed read proves nothing — keep the row and its optimistic
    // totals rather than treating it as deleted.
    if (error) return;
    if (!data) {
      // Deleted from the edit overlay.
      syncPromises.current.delete(tempId);
      createdCategoryIds.current.delete(tempId);
      setPending((prev) => prev.filter((e) => e.tempId !== tempId));
      return;
    }
    const links = Array.isArray(data.entry_categories)
      ? data.entry_categories
      : data.entry_categories
        ? [data.entry_categories]
        : [];
    const cats: CategoryPick[] = links
      .map((l) => {
        const cat = Array.isArray(l.categories) ? l.categories[0] : l.categories;
        return { id: l.category_id as string, name: cat?.name ?? "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    updateEntry(tempId, {
      amount: Number(data.amount),
      direction: data.direction,
      categories: cats,
      entryDate: data.entry_date,
      note: data.note ?? "",
      isRecurring: data.is_recurring,
    });
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    setEditError(null);
    const supabase = createClient();
    try {
      const { picks } = await resolveCategories(supabase, effectiveCats);
      const ids = picks.map((p) => p.id!);
      // Manual entries keep their fingerprint in step with edits. Imported
      // entries (import_batch set) keep their original untouched — theirs
      // was computed from the raw statement description, which this form
      // doesn't have, and recomputing from the note would corrupt matching.
      const amount = Math.round(parsedAmount * 100) / 100;
      const fingerprintPatch =
        edit.import_batch === null
          ? { fingerprint: await computeFingerprint(entryDate, amount, note.trim()) }
          : {};
      const { error } = await supabase
        .from("entries")
        .update({
          amount,
          direction,
          category_id: ids[0],
          entry_date: entryDate,
          note: note.trim() || null,
          is_recurring: isRecurring,
          ...fingerprintPatch,
        })
        .eq("id", edit.id);
      if (error) throw error;

      // Add first, then remove, so a failure midway can't leave the entry
      // with no categories.
      const { error: addError } = await supabase
        .from("entry_categories")
        .upsert(
          ids.map((category_id) => ({
            entry_id: edit.id,
            category_id,
            user_id: userId,
          })),
          { onConflict: "entry_id,category_id", ignoreDuplicates: true }
        );
      if (addError) throw addError;
      const { error: removeError } = await supabase
        .from("entry_categories")
        .delete()
        .eq("entry_id", edit.id)
        .not("category_id", "in", `(${ids.join(",")})`);
      if (removeError) throw removeError;

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

    const entry: PendingEntry = {
      tempId: crypto.randomUUID(),
      amount: Math.round(parsedAmount * 100) / 100,
      direction,
      categories: effectiveCats,
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
    setSelectedCats([]);
    setNote("");
    setIsRecurring(false);
    amountRef.current?.focus();
  }

  // Optimistic strip totals: server figures plus this session's pending
  // entries that exist (or will exist) in the DB, minus ones being undone.
  // The period range comes with the server totals so filter, link, and
  // figures always describe the same period.
  let stripIn = periodTotals?.in ?? 0;
  let stripOut = periodTotals?.out ?? 0;
  if (periodTotals) {
    for (const e of pending) {
      const counts =
        e.status === "saving" || e.status === "saved" || e.status === "undoFailed";
      const inRange =
        e.entryDate >= periodTotals.start &&
        (!periodTotals.end || e.entryDate <= periodTotals.end);
      if (!counts || !inRange) continue;
      if (e.direction === "in") stripIn += e.amount;
      else stripOut += e.amount;
    }
  }
  const stripNet = stripIn - stripOut;

  const editingPending = pendingEdit
    ? pending.find((p) => p.tempId === pendingEdit.tempId) ?? null
    : null;

  return (
    <>
      {!edit && periodTotals && (
        <Link href={periodTotals.href} className={styles.strip}>
          <span className={styles.stripMonth}>{periodTotals.label}</span>
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

      {!edit && periodNote && (
        <p className={styles.periodNote}>
          {periodNote} <Link href="/entries">Review entries</Link>
        </p>
      )}

      {!edit && quickAdd && quickAdd.length > 0 && (
        <div
          className={styles.quickChips}
          role="group"
          aria-label="Quick add from recent entries"
        >
          {quickAdd.map((item, i) => (
            <button
              key={i}
              type="button"
              className={styles.quickChip}
              onClick={() => applyQuickAdd(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
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

        <CategoryPicker
          categories={categories}
          query={catQuery}
          selected={selectedCats}
          onQueryChange={setCatQuery}
          onSelectedChange={setSelectedCats}
        />

        <div className={styles.row}>
          <input
            className={styles.input}
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            aria-label="Date"
          />
        </div>

        <div className={styles.row}>
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

        {!edit && dupWarning && (
          <p className={styles.dupNote}>
            You added {gbp.format(dupWarning.amount)} to {dupWarning.category}{" "}
            on{" "}
            {new Date(`${dupWarning.date}T00:00:00`).toLocaleDateString(
              "en-GB",
              { day: "numeric", month: "short" }
            )}
            {dupWarning.note ? ` — “${dupWarning.note}”` : ""}
          </p>
        )}

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
                <button
                  type="button"
                  className={styles.recentText}
                  onClick={() => void editPending(e)}
                  aria-label="Edit this entry"
                >
                  <span className={styles.sign}>
                    {e.direction === "out" ? "−" : "+"}
                  </span>
                  {gbp.format(e.amount)} · {pickNames(e.categories)}
                  {e.note && ` · ${e.note}`}
                </button>
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

      {!edit && pendingEdit && editingPending && (
        <div
          className={overlayStyles.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-session-entry-title"
        >
          <div className={overlayStyles.overlayInner}>
            <h2
              id="edit-session-entry-title"
              className={overlayStyles.overlayTitle}
            >
              Edit entry
            </h2>
            <EntryForm
              userId={userId}
              initialCategories={categories}
              edit={{
                id: pendingEdit.dbId,
                amount: editingPending.amount,
                direction: editingPending.direction,
                category_ids: editingPending.categories
                  .map((c) => c.id)
                  .filter((id): id is string => id !== null),
                entry_date: editingPending.entryDate,
                note: editingPending.note || null,
                is_recurring: editingPending.isRecurring,
                import_batch: null,
              }}
              onClose={(changed) => {
                const pe = pendingEdit;
                setPendingEdit(null);
                if (changed && pe) void refreshPending(pe.tempId, pe.dbId);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
