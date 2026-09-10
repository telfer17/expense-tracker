"use client";

import { useState } from "react";
import type { Direction } from "@/lib/types";
import styles from "./NoteGroups.module.css";

export type NoteGroupEntry = {
  id: string;
  date: string;
  amount: number;
  direction: Direction;
};

// One row per distinct note (case-insensitive, trimmed), built server-side
// on the category detail page. Entries arrive newest first.
export type NoteGroup = {
  key: string;
  name: string;
  count: number;
  // The group's most common amount, or the latest one when they all vary.
  typicalAmount: number;
  typicalDirection: Direction;
  latestDate: string;
  totalNet: number; // in minus out across the group, for the active range
  entries: NoteGroupEntry[];
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function shortDate(iso: string): string {
  const d = parseIso(iso);
  return d
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : iso;
}

function fullDate(iso: string): string {
  const d = parseIso(iso);
  return d
    ? d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : iso;
}

function signed(amount: number, negative: boolean): string {
  return `${negative ? "−" : "+"}${gbp.format(amount)}`;
}

export default function NoteGroups({ groups }: { groups: NoteGroup[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <ul className={styles.list}>
      {groups.map((g) => {
        const open = openKey === g.key;
        return (
          <li key={g.key} className={styles.item}>
            <button
              type="button"
              className={styles.rowBtn}
              aria-expanded={open}
              onClick={() => setOpenKey(open ? null : g.key)}
            >
              <span className={styles.main}>
                <span className={styles.name}>{g.name}</span>
                <span className={styles.meta}>
                  {g.count === 1 ? "1 entry" : `${g.count} entries`} · last{" "}
                  {shortDate(g.latestDate)}
                </span>
              </span>
              <span className={styles.figures}>
                <span
                  className={
                    g.typicalDirection === "in"
                      ? `${styles.typical} ${styles.amountIn}`
                      : styles.typical
                  }
                >
                  {signed(g.typicalAmount, g.typicalDirection === "out")}
                </span>
                <span className={styles.total}>
                  {signed(Math.abs(g.totalNet), g.totalNet < 0)} total
                </span>
              </span>
              <span
                className={open ? styles.chevronOpen : styles.chevron}
                aria-hidden="true"
              >
                ›
              </span>
            </button>
            {open && (
              <ul className={styles.entries}>
                {g.entries.map((e) => (
                  <li key={e.id} className={styles.entryRow}>
                    <span>{fullDate(e.date)}</span>
                    <span
                      className={
                        e.direction === "in" ? styles.amountIn : undefined
                      }
                    >
                      {signed(e.amount, e.direction === "out")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
