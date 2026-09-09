import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ukToday } from "@/lib/month";
import { buildPeriods, daysBetween, resolveView, viewHref } from "@/lib/periods";
import EntryForm from "@/components/EntryForm";

export default async function AddPage() {
  const supabase = await createClient();
  const [
    { data: claims },
    { data: settingsRow },
    { data: categories },
    { data: markerRows },
    { data: earliestRows },
  ] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("user_settings").select("period_mode").maybeSingle(),
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("periods").select("start_date").order("start_date"),
    supabase
      .from("entries")
      .select("entry_date")
      .order("entry_date")
      .limit(1),
  ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const salaryMode = settingsRow?.period_mode === "salary";
  const periods = salaryMode
    ? buildPeriods(
        (markerRows ?? []).map((r) => r.start_date),
        earliestRows?.[0]?.entry_date ?? null
      )
    : [];
  const view = resolveView(periods, undefined, undefined);

  let query = supabase
    .from("entries")
    .select("amount, direction")
    .gte("entry_date", view.start);
  if (view.end) query = query.lte("entry_date", view.end);
  const { data: periodEntries } = await query;

  const totals = { in: 0, out: 0 };
  for (const e of periodEntries ?? []) {
    if (e.direction === "in") totals.in += Number(e.amount);
    else totals.out += Number(e.amount);
  }

  let periodNote: string | null = null;
  if (salaryMode && view.mode === "period") {
    const days = daysBetween(view.start, ukToday());
    if (days > 40) {
      periodNote = `This period has run ${days} days — did you miss marking a new one?`;
    }
  }

  return (
    <EntryForm
      userId={userId}
      initialCategories={categories ?? []}
      periodTotals={{
        label: view.label,
        start: view.start,
        end: view.end,
        href: viewHref(view),
        ...totals,
      }}
      periodNote={periodNote}
    />
  );
}
