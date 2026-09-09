"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./PeriodsManager.module.css";

type PeriodRow = {
  id: string;
  start: string; // YYYY-MM-DD
  range: string; // "21 Jul – 19 Aug 2026" / "21 Aug 2026 – present"
  count: number;
};

export default function PeriodsManager({
  rows,
  implicit,
  userId,
}: {
  rows: PeriodRow[]; // newest first
  implicit: { label: string; count: number } | null;
  userId: string;
}) {
  const router = useRouter();
  const [newDate, setNewDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function entriesText(count: number) {
    return `${count} ${count === 1 ? "entry" : "entries"}`;
  }

  async function addPeriod() {
    if (!newDate || busy) return;
    setBusy(true);
    setError(null);
    const { error: insertError } = await createClient()
      .from("periods")
      .insert({ user_id: userId, start_date: newDate });
    setBusy(false);
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "A period already starts on that date."
          : "Couldn't add the period. Try again."
      );
      return;
    }
    setNewDate("");
    router.refresh();
  }

  async function saveEdit(row: PeriodRow) {
    if (!editDate || busy) return;
    if (editDate === row.start) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await createClient()
      .from("periods")
      .update({ start_date: editDate })
      .eq("id", row.id);
    setBusy(false);
    if (updateError) {
      setError(
        updateError.code === "23505"
          ? "A period already starts on that date."
          : "Couldn't update the period. Try again."
      );
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  async function deletePeriod(row: PeriodRow) {
    if (busy) return;
    if (
      !confirm(
        `Delete "${row.range}"? Its entries merge into the previous period.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const { error: deleteError } = await createClient()
      .from("periods")
      .delete()
      .eq("id", row.id);
    setBusy(false);
    if (deleteError) {
      setError("Couldn't delete the period. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className={styles.manager}>
      <div className={styles.addRow}>
        <input
          className={styles.dateInput}
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          aria-label="New period start date"
        />
        <button
          type="button"
          className={styles.addBtn}
          disabled={!newDate || busy}
          onClick={() => void addPeriod()}
        >
          Add period
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {rows.length === 0 ? (
        <p className={styles.empty}>
          No periods yet — add your first start date (usually a payday).
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.item}>
              {editingId === row.id ? (
                <div className={styles.row}>
                  <input
                    className={styles.dateInput}
                    type="date"
                    value={editDate}
                    autoFocus
                    onChange={(e) => setEditDate(e.target.value)}
                    aria-label="Period start date"
                  />
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    disabled={!editDate || busy}
                    onClick={() => void saveEdit(row)}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className={styles.row}>
                  <span className={styles.range}>
                    {row.range}
                    <span className={styles.count}>
                      {" "}
                      · {entriesText(row.count)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    disabled={busy}
                    onClick={() => {
                      setEditingId(row.id);
                      setEditDate(row.start);
                      setError(null);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    disabled={busy}
                    onClick={() => void deletePeriod(row)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
          {implicit && (
            <li className={`${styles.item} ${styles.implicit}`}>
              <span className={styles.range}>
                {implicit.label}
                <span className={styles.count}>
                  {" "}
                  · {entriesText(implicit.count)}
                </span>
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
