import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { monthLabel } from "@/lib/month";
import { buildPeriods, daysBetween, periodFor, resolveView } from "@/lib/periods";
import { resolveRange } from "@/lib/range";
import { likePattern } from "@/lib/search";
import EntriesView from "@/components/EntriesView";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    period?: string;
    cat?: string;
    range?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}) {
  const {
    month: rawMonth,
    period: rawPeriod,
    cat,
    range,
    from,
    to,
    q = "",
  } = await searchParams;

  // A valid range param switches the page from the month/period selector to
  // range mode; month/period params are kept in the URL so clearing the
  // range returns to the same view.
  const rangeView = resolveRange(range, from, to);

  const supabase = await createClient();
  const [
    { data: claims },
    { data: settingsRow },
    { data: markerRows },
    { data: earliestRows },
    { data: categories },
  ] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("user_settings")
      .select("period_mode, starting_balance, starting_balance_date")
      .maybeSingle(),
    supabase.from("periods").select("start_date").order("start_date"),
    supabase.from("entries").select("entry_date").order("entry_date").limit(1),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  // Calendar months unless the user has switched to salary periods.
  const salaryMode = settingsRow?.period_mode === "salary";
  const hasPeriods = (markerRows ?? []).length > 0;
  const periods = salaryMode
    ? buildPeriods(
        (markerRows ?? []).map((r) => r.start_date),
        earliestRows?.[0]?.entry_date ?? null
      )
    : [];
  const view = resolveView(periods, rawPeriod, rawMonth);

  let query = supabase
    .from("entries")
    .select(
      "id, amount, direction, category_id, entry_date, note, is_recurring, import_batch"
    )
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (rangeView) {
    if (rangeView.from) query = query.gte("entry_date", rangeView.from);
    if (rangeView.to) query = query.lte("entry_date", rangeView.to);
  } else {
    query = query.gte("entry_date", view.start);
    if (view.end) query = query.lte("entry_date", view.end);
  }
  if (q) query = query.ilike("note", likePattern(q));
  const { data: entries, error: entriesError } = await query;

  // Fail loudly — a silently empty screen hides real problems (e.g. an
  // unapplied migration).
  if (entriesError) {
    throw new Error(`Couldn't load entries: ${entriesError.message}`);
  }

  // If this period is empty but entries exist elsewhere, point at the
  // period holding the nearest ones so the screen is never a dead end.
  let emptyHint: { label: string; href: string } | null = null;
  const qSuffix = q ? `&q=${encodeURIComponent(q)}` : "";
  if (!rangeView && (entries ?? []).length === 0 && earliestRows?.[0]) {
    // The probes carry the note filter too, so with a search active the
    // hint points at the nearest *matching* entries.
    let beforeQuery = supabase
      .from("entries")
      .select("entry_date")
      .lt("entry_date", view.start)
      .order("entry_date", { ascending: false })
      .limit(1);
    if (q) beforeQuery = beforeQuery.ilike("note", likePattern(q));
    let afterQuery = view.end
      ? supabase
          .from("entries")
          .select("entry_date")
          .gt("entry_date", view.end)
          .order("entry_date")
          .limit(1)
      : null;
    if (afterQuery && q) afterQuery = afterQuery.ilike("note", likePattern(q));
    const [{ data: beforeRows }, afterResult] = await Promise.all([
      beforeQuery,
      afterQuery ?? Promise.resolve({ data: null }),
    ]);
    const before = beforeRows?.[0]?.entry_date ?? null;
    const after = afterResult.data?.[0]?.entry_date ?? null;
    let nearest: string | null = null;
    if (before && after) {
      nearest =
        daysBetween(before, view.start) <= daysBetween(view.end!, after)
          ? before
          : after;
    } else {
      nearest = before ?? after;
    }
    if (nearest) {
      if (salaryMode && periods.length > 0) {
        const p = periodFor(periods, nearest);
        if (p) {
          emptyHint = {
            label: p.label,
            href: `/entries?period=${p.start}${qSuffix}`,
          };
        }
      } else {
        const m = nearest.slice(0, 7);
        emptyHint = {
          label: monthLabel(m),
          href: `/entries?month=${m}${qSuffix}`,
        };
      }
    }
  }

  const initialCat = (categories ?? []).some((c) => c.id === cat) ? cat! : "";

  // Running balance: only meaningful over the unfiltered ledger, so it's
  // computed for the plain month/period view and never in range or search
  // mode. `start` is the balance immediately before this view's first
  // counted entry: the anchor balance plus the net of everything between
  // the anchor date and the view start.
  let runningBalance: { start: number; startDate: string } | null = null;
  const sbDate: string | null = settingsRow?.starting_balance_date ?? null;
  if (
    settingsRow?.starting_balance !== null &&
    settingsRow?.starting_balance !== undefined &&
    sbDate &&
    !rangeView &&
    !q
  ) {
    let prefixNet = 0;
    if (sbDate < view.start) {
      // Aggregated in the database — fetching rows would silently truncate
      // at PostgREST's 1,000-row limit and anchor the balance wrong.
      const { data: prefixSum, error: prefixError } = await supabase.rpc(
        "entries_net_before",
        { p_from: sbDate, p_to: view.start }
      );
      // Fail loudly, like entriesError above — a swallowed failure here
      // would render a wrong balance instead of none.
      if (prefixError) {
        throw new Error(
          `Couldn't compute the running balance: ${prefixError.message}`
        );
      }
      prefixNet = Number(prefixSum ?? 0);
    }
    runningBalance = {
      start: Number(settingsRow.starting_balance) + prefixNet,
      startDate: sbDate,
    };
  }

  // Search params each control must preserve when it rewrites the URL:
  // the range control owns range/from/to, the search box owns q; each
  // keeps the other's params (and month/period/cat) intact.
  const baseParams: Record<string, string> = {};
  if (rawMonth) baseParams.month = rawMonth;
  if (rawPeriod) baseParams.period = rawPeriod;
  if (cat) baseParams.cat = cat;
  const rangeOthers = { ...baseParams };
  if (q) rangeOthers.q = q;
  const searchOthers = { ...baseParams };
  if (range) searchOthers.range = range;
  if (from) searchOthers.from = from;
  if (to) searchOthers.to = to;

  return (
    <EntriesView
      view={view}
      mode={salaryMode ? "salary" : "month"}
      hasPeriods={hasPeriods}
      emptyHint={emptyHint}
      entries={entries ?? []}
      categories={categories ?? []}
      userId={userId}
      initialCat={initialCat}
      range={rangeView}
      rangeOthers={rangeOthers}
      searchQuery={q}
      searchOthers={searchOthers}
      runningBalance={runningBalance}
    />
  );
}
