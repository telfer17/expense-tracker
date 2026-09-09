"use client";

import { useRouter } from "next/navigation";
import type { RangePreset } from "@/lib/range";
import styles from "./RangeFilter.module.css";

const OPTIONS: { key: RangePreset; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "1y", label: "1 year" },
  { key: "custom", label: "Custom" },
];

// Row of range buttons; Custom reveals from/to date inputs. All state lives
// in the URL (range/from/to search params) so views are bookmarkable and the
// back button works. `others` are the current page's other search params,
// preserved across range changes.
export default function RangeFilter({
  basePath,
  preset,
  from,
  to,
  others = {},
  offLabel,
  defaultPreset,
}: {
  basePath: string;
  preset: RangePreset | null; // null = no range selected (offLabel active)
  from: string | null;
  to: string | null;
  others?: Record<string, string>;
  offLabel?: string; // extra first option that clears the range entirely
  defaultPreset?: RangePreset; // preset the page shows with no range param
}) {
  const router = useRouter();

  function url(
    nextPreset: RangePreset | null,
    nextFrom: string | null,
    nextTo: string | null
  ): string {
    const sp = new URLSearchParams(others);
    if (nextPreset && nextPreset !== defaultPreset) sp.set("range", nextPreset);
    if (nextPreset === "custom") {
      if (nextFrom) sp.set("from", nextFrom);
      if (nextTo) sp.set("to", nextTo);
    }
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.row} role="group" aria-label="Date range">
        {offLabel && (
          <button
            type="button"
            className={preset === null ? styles.btnActive : styles.btn}
            aria-pressed={preset === null}
            onClick={() => router.push(url(null, null, null))}
          >
            {offLabel}
          </button>
        )}
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            className={preset === o.key ? styles.btnActive : styles.btn}
            aria-pressed={preset === o.key}
            onClick={() => router.push(url(o.key, from, to))}
          >
            {o.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className={styles.customRow}>
          <label className={styles.customField}>
            From
            <input
              type="date"
              className={styles.dateInput}
              value={from ?? ""}
              max={to ?? undefined}
              onChange={(e) =>
                router.replace(url("custom", e.target.value || null, to))
              }
            />
          </label>
          <label className={styles.customField}>
            To
            <input
              type="date"
              className={styles.dateInput}
              value={to ?? ""}
              min={from ?? undefined}
              onChange={(e) =>
                router.replace(url("custom", from, e.target.value || null))
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
