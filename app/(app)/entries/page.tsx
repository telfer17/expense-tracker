import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPeriods, resolveView } from "@/lib/periods";
import EntriesView from "@/components/EntriesView";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; period?: string; cat?: string }>;
}) {
  const { month: rawMonth, period: rawPeriod, cat } = await searchParams;

  const supabase = await createClient();
  const [{ data: claims }, { data: markerRows }, { data: earliestRows }, { data: categories }] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase
        .from("entries")
        .select("entry_date")
        .eq("starts_period", true)
        .order("entry_date"),
      supabase
        .from("entries")
        .select("entry_date")
        .order("entry_date")
        .limit(1),
      supabase.from("categories").select("id, name").order("name"),
    ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const periods = buildPeriods(
    (markerRows ?? []).map((r) => r.entry_date),
    earliestRows?.[0]?.entry_date ?? null
  );
  const view = resolveView(periods, rawPeriod, rawMonth);

  let query = supabase
    .from("entries")
    .select(
      "id, amount, direction, category_id, entry_date, note, is_recurring, starts_period"
    )
    .gte("entry_date", view.start)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (view.end) query = query.lte("entry_date", view.end);
  const { data: entries } = await query;

  const initialCat = (categories ?? []).some((c) => c.id === cat) ? cat! : "";

  return (
    <EntriesView
      view={view}
      entries={entries ?? []}
      categories={categories ?? []}
      userId={userId}
      initialCat={initialCat}
    />
  );
}
