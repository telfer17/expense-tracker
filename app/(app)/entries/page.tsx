import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { monthLabel } from "@/lib/month";
import { buildPeriods, daysBetween, periodFor, resolveView } from "@/lib/periods";
import EntriesView from "@/components/EntriesView";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; period?: string; cat?: string }>;
}) {
  const { month: rawMonth, period: rawPeriod, cat } = await searchParams;

  const supabase = await createClient();
  const [
    { data: claims },
    { data: settingsRow },
    { data: markerRows },
    { data: earliestRows },
    { data: categories },
  ] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("user_settings").select("period_mode").maybeSingle(),
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
    .select("id, amount, direction, category_id, entry_date, note, is_recurring")
    .gte("entry_date", view.start)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (view.end) query = query.lte("entry_date", view.end);
  const { data: entries, error: entriesError } = await query;

  // Fail loudly — a silently empty screen hides real problems (e.g. an
  // unapplied migration).
  if (entriesError) {
    throw new Error(`Couldn't load entries: ${entriesError.message}`);
  }

  // If this period is empty but entries exist elsewhere, point at the
  // period holding the nearest ones so the screen is never a dead end.
  let emptyHint: { label: string; href: string } | null = null;
  if ((entries ?? []).length === 0 && earliestRows?.[0]) {
    const [{ data: beforeRows }, afterResult] = await Promise.all([
      supabase
        .from("entries")
        .select("entry_date")
        .lt("entry_date", view.start)
        .order("entry_date", { ascending: false })
        .limit(1),
      view.end
        ? supabase
            .from("entries")
            .select("entry_date")
            .gt("entry_date", view.end)
            .order("entry_date")
            .limit(1)
        : Promise.resolve({ data: null }),
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
          emptyHint = { label: p.label, href: `/entries?period=${p.start}` };
        }
      } else {
        const m = nearest.slice(0, 7);
        emptyHint = { label: monthLabel(m), href: `/entries?month=${m}` };
      }
    }
  }

  const initialCat = (categories ?? []).some((c) => c.id === cat) ? cat! : "";

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
    />
  );
}
