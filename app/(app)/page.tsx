import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ukToday } from "@/lib/month";
import { fetchAllRows } from "@/lib/paged";
import { buildPeriods, daysBetween, resolveView, viewHref } from "@/lib/periods";
import EntryForm, { type QuickAddItem } from "@/components/EntryForm";

export default async function AddPage() {
  const supabase = await createClient();
  const [
    { data: claims },
    { data: settingsRow },
    { data: categories },
    { data: markerRows },
    { data: earliestRows },
    { data: recentRows },
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
    supabase
      .from("entries")
      .select("note, category_id, direction")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
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

  // Paged so a >1,000-entry period doesn't silently understate the totals.
  const periodEntries = await fetchAllRows<{
    amount: number;
    direction: string;
  }>("period totals", (from, to) => {
    let query = supabase
      .from("entries")
      .select("amount, direction")
      .gte("entry_date", view.start)
      .order("id")
      .range(from, to);
    if (view.end) query = query.lte("entry_date", view.end);
    return query;
  });

  const totals = { in: 0, out: 0 };
  for (const e of periodEntries) {
    if (e.direction === "in") totals.in += Number(e.amount);
    else totals.out += Number(e.amount);
  }

  // The 5 most recent distinct entries (by note + category) as one-tap
  // prefills. Labelled by note, falling back to the category name.
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const seen = new Set<string>();
  const quickAdd: QuickAddItem[] = [];
  for (const r of recentRows ?? []) {
    const note = (r.note ?? "").trim();
    const label =
      note || (r.category_id ? catName.get(r.category_id) ?? "" : "");
    if (!label) continue;
    const key = `${note.toLowerCase()}|${r.category_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    quickAdd.push({
      label,
      note,
      categoryId: r.category_id,
      direction: r.direction,
    });
    if (quickAdd.length === 5) break;
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
      quickAdd={quickAdd}
    />
  );
}
