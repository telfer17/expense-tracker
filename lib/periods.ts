// Financial periods are defined by the periods table (a list of start
// dates): each period runs from its start date to the day before the next
// period's start date; the newest runs to today. With no periods at all,
// every screen falls back to calendar months via the same view shape, so
// this module is the only place that does period/month date maths.
import { addMonths, monthLabel, monthRange, ukToday } from "./month";

export type Period = {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive; for the open (current) period, today
  open: boolean; // the running period — query it without an upper bound
  label: string;
};

// What a screen needs to show one period (or, with no markers, one month):
// its range, label, and the neighbouring keys for navigation.
export type PeriodView = {
  mode: "period" | "month";
  key: string; // period start date, or YYYY-MM in month mode
  label: string;
  start: string; // query lower bound, inclusive
  end: string | null; // query upper bound, inclusive; null = open-ended
  prevKey: string | null;
  nextKey: string | null;
  prev: { start: string; end: string; label: string } | null; // for copy-recurring
};

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000
  );
}

function dayMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// "21 Jul 2026"
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// "21 Jul – 19 Aug 2026", or "21 Aug 2026 – present" for the open period.
export function formatPeriodRange(p: Period): string {
  if (p.open) return `${formatDate(p.start)} – present`;
  return rangeLabel(p.start, p.end);
}

function rangeLabel(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return sameYear
    ? `${dayMonth(start)} – ${dayMonth(end)} ${end.slice(0, 4)}`
    : `${dayMonth(start)} ${start.slice(0, 4)} – ${dayMonth(end)} ${end.slice(0, 4)}`;
}

// startDates: the periods table's start_date values (any order, dupes ok).
// earliestEntry: the user's earliest entry date, for the implicit period
// before the first start (pass null to skip it). Returns periods
// newest-first; empty array = no periods, so callers fall back to calendar
// months (resolveView does this for you).
export function buildPeriods(
  markers: string[],
  earliestEntry: string | null,
  today: string = ukToday()
): Period[] {
  const starts = [...new Set(markers)].sort();
  if (starts.length === 0) return [];

  const periods: Period[] = [];
  let preCount = 0;
  if (earliestEntry && earliestEntry < starts[0]) {
    periods.push({
      start: earliestEntry,
      end: shiftDays(starts[0], -1),
      open: false,
      label: "",
    });
    preCount = 1;
  }
  for (let i = 0; i < starts.length; i++) {
    const last = i === starts.length - 1;
    periods.push({
      start: starts[i],
      end: last
        ? today > starts[i]
          ? today
          : starts[i]
        : shiftDays(starts[i + 1], -1),
      open: last,
      label: "",
    });
  }

  // Periods are named for the calendar month they end in; the pre-marker
  // period is always labelled by its range, and so are any periods that
  // would otherwise share a name.
  const base = periods.map((p, i) =>
    i < preCount ? null : monthLabel(p.end.slice(0, 7))
  );
  const counts = new Map<string, number>();
  for (const b of base) if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
  periods.forEach((p, i) => {
    const b = base[i];
    p.label = b && counts.get(b) === 1 ? b : rangeLabel(p.start, p.end);
  });

  return periods.reverse();
}

// The period containing a date (periods newest-first), or null.
export function periodFor(periods: Period[], date: string): Period | null {
  for (const p of periods) {
    if (date >= p.start && (p.open || date <= p.end)) return p;
  }
  return null;
}

export function viewHref(view: Pick<PeriodView, "mode" | "key">): string {
  return view.mode === "month"
    ? `/entries?month=${view.key}`
    : `/entries?period=${view.key}`;
}

// Resolve which period (or fallback month) a screen should show.
// rawPeriod/rawMonth come straight from search params and may be invalid.
export function resolveView(
  periods: Period[],
  rawPeriod: string | undefined,
  rawMonth: string | undefined,
  today: string = ukToday()
): PeriodView {
  if (periods.length === 0) {
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth ?? "")
      ? rawMonth!
      : today.slice(0, 7);
    const { start, end } = monthRange(month);
    const prevMonth = addMonths(month, -1);
    const prevRange = monthRange(prevMonth);
    return {
      mode: "month",
      key: month,
      label: monthLabel(month),
      start,
      end,
      prevKey: prevMonth,
      nextKey: addMonths(month, 1),
      prev: {
        start: prevRange.start,
        end: prevRange.end,
        label: monthLabel(prevMonth),
      },
    };
  }

  let idx = periods.findIndex((p) => p.start === rawPeriod);
  if (idx === -1) idx = 0; // default: the current (newest) period
  const p = periods[idx];
  const older = periods[idx + 1] ?? null;
  const newer = idx > 0 ? periods[idx - 1] : null;
  return {
    mode: "period",
    key: p.start,
    label: p.label,
    start: p.start,
    end: p.open ? null : p.end,
    prevKey: older?.start ?? null,
    nextKey: newer?.start ?? null,
    prev: older
      ? { start: older.start, end: older.end, label: older.label }
      : null,
  };
}
