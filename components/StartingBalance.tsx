"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ukToday } from "@/lib/month";
import styles from "./StartingBalance.module.css";

// Settings control for the running-balance anchor: the user's actual bank
// balance as of a given date. Both stored on the single user_settings row.
export default function StartingBalance({
  userId,
  initialBalance,
  initialDate,
}: {
  userId: string;
  initialBalance: number | null;
  initialDate: string | null;
}) {
  const router = useRouter();
  const [balance, setBalance] = useState(
    initialBalance === null ? "" : initialBalance.toFixed(2)
  );
  const [date, setDate] = useState(initialDate ?? ukToday());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Overdrafts are real: a leading minus is allowed.
  const balanceValid = /^-?\d+([.,]\d{1,2})?$/.test(balance.trim());
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save(clear: boolean) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    const { error: saveError } = await createClient()
      .from("user_settings")
      .upsert({
        user_id: userId,
        starting_balance: clear
          ? null
          : Math.round(Number(balance.trim().replace(",", ".")) * 100) / 100,
        starting_balance_date: clear ? null : date,
      });
    setBusy(false);
    if (saveError) {
      setError("Couldn't save. Try again.");
      return;
    }
    if (clear) setBalance("");
    setMsg(clear ? "Running balance turned off." : "Saved.");
    router.refresh();
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Running balance</h2>
      <p className={styles.hint}>
        Enter your actual bank balance as of a date, and the ledger shows a
        running balance against each entry from there on.
      </p>
      <div className={styles.fields}>
        <input
          className={styles.input}
          type="text"
          inputMode="decimal"
          placeholder="Balance, e.g. 1234.56"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          aria-label="Bank balance"
        />
        <input
          className={styles.input}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Balance date"
        />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveBtn}
          disabled={busy || !balanceValid || !dateValid}
          onClick={() => void save(false)}
        >
          Save balance
        </button>
        {initialBalance !== null && (
          <button
            type="button"
            className={styles.clearBtn}
            disabled={busy}
            onClick={() => void save(true)}
          >
            Turn off
          </button>
        )}
      </div>
      {msg && <p className={styles.msg}>{msg}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
