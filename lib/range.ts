// Date-range filtering (All time / last N months / custom), driven by the
// range/from/to search params so views are bookmarkable. Relative ranges
// count back from today to the day, not from a calendar month boundary.
import { ukToday } from "./month";
import { formatDate } from "./periods";

export type RangePreset = "all" | "3m" | "6m" | "1y" | "custom";

export type RangeView = {
  preset: RangePreset;
  from: string | null; // query lower bound, inclusive; null = unbounded
  to: string | null; // query upper bound, inclusive; null = unbounded
  label: string; // "Last 6 months", "1 Jan – 5 Mar 2026", …
};

const MONTHS_BACK: Record<string, { months: number; label: string }> = {
  "3m": { months: 3, label: "Last 3 months" },
  "6m": { months: 6, label: "Last 6 months" },
  "1y": { months: 12, label: "Last year" },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `date` minus `months` calendar months, day clamped to the target month's
// length (31 May − 3 months → 29/28 Feb).
function shiftMonthsBack(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(y, m - months, 0).getDate();
  const dt = new Date(y, m - 1 - months, Math.min(d, lastDay));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Resolve the range/from/to search params (which may be missing or invalid)
// into a range view, or null when no valid range is selected — callers decide
// what null means ("all time" on the category page, month/period view on
// entries).
export function resolveRange(
  rawRange: string | undefined,
  rawFrom: string | undefined,
  rawTo: string | undefined,
  today: string = ukToday()
): RangeView | null {
  if (rawRange === "all") {
    return { preset: "all", from: null, to: null, label: "All time" };
  }
  const rel = rawRange ? MONTHS_BACK[rawRange] : undefined;
  if (rel) {
    return {
      preset: rawRange as RangePreset,
      from: shiftMonthsBack(today, rel.months),
      to: null,
      label: rel.label,
    };
  }
  if (rawRange === "custom") {
    let from = DATE_RE.test(rawFrom ?? "") ? rawFrom! : null;
    let to = DATE_RE.test(rawTo ?? "") ? rawTo! : null;
    if (from && to && from > to) [from, to] = [to, from];
    const label =
      from && to
        ? `${formatDate(from)} – ${formatDate(to)}`
        : from
          ? `From ${formatDate(from)}`
          : to
            ? `Until ${formatDate(to)}`
            : "Custom range";
    return { preset: "custom", from, to, label };
  }
  return null;
}
