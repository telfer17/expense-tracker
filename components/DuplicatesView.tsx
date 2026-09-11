"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Direction } from "@/lib/types";
import styles from "./DuplicatesView.module.css";

export type DuplicateEntry = {
  id: string;
  note: string | null;
  category: string | null;
  imported: boolean;
};

export type DuplicateGroup = {
  key: string;
  date: string; // YYYY-MM-DD
  amount: number;
  direction: Direction;
  entries: DuplicateEntry[];
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3])
  ).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function DuplicatesView({
  initialGroups,
}: {
  initialGroups: DuplicateGroup[];
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deleteEntry(group: DuplicateGroup, entry: DuplicateEntry) {
    if (deletingId) return;
    const label = entry.note || entry.category || "this entry";
    if (
      !confirm(
        `Delete "${label}" (${gbp.format(group.amount)} on ${longDate(
          group.date
        )})? The other ${
          group.entries.length === 2
            ? "entry in this group stays"
            : "entries in this group stay"
        }.`
      )
    ) {
      return;
    }

    setDeletingId(entry.id);
    setError(null);
    // Select the deleted row back — RLS can turn a delete into a silent
    // no-op, and local state must only drop the entry if it really went.
    const { data: deleted, error: deleteError } = await createClient()
      .from("entries")
      .delete()
      .eq("id", entry.id)
      .select("id");
    setDeletingId(null);
    if (deleteError || (deleted ?? []).length !== 1) {
      setError("Couldn't delete the entry. Try again.");
      return;
    }

    // A group that drops to one entry is no longer a duplicate — remove it.
    setGroups((prev) =>
      prev
        .map((g) =>
          g.key === group.key
            ? { ...g, entries: g.entries.filter((e) => e.id !== entry.id) }
            : g
        )
        .filter((g) => g.entries.length > 1)
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Duplicate finder</h1>
      <p className={styles.count}>
        {groups.length === 0
          ? "No possible duplicates — no two entries share a date, amount and direction."
          : `${groups.length} possible duplicate group${
              groups.length === 1 ? "" : "s"
            }`}
      </p>
      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.groups}>
        {groups.map((g) => (
          <li key={g.key} className={styles.group}>
            <p className={styles.groupHead}>
              <span className={styles.groupDate}>{longDate(g.date)}</span>
              <span
                className={
                  g.direction === "in" ? styles.amountIn : styles.amountOut
                }
              >
                {g.direction === "in" ? "+" : "−"}
                {gbp.format(g.amount)}
              </span>
              <span className={styles.groupSize}>
                {g.entries.length} entries
              </span>
            </p>
            <ul className={styles.entries}>
              {g.entries.map((e) => (
                <li key={e.id} className={styles.entry}>
                  <span className={styles.note}>
                    {e.note || <em className={styles.noNote}>No note</em>}
                  </span>
                  <span className={styles.category}>
                    {e.category ?? "No category"}
                  </span>
                  <span className={e.imported ? styles.imported : styles.manual}>
                    {e.imported ? "Imported" : "Manual"}
                  </span>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    disabled={deletingId !== null}
                    onClick={() => void deleteEntry(g, e)}
                  >
                    {deletingId === e.id ? "Deleting…" : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
