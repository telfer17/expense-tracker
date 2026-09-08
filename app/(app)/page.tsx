import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentMonth, monthRange } from "@/lib/month";
import EntryForm from "@/components/EntryForm";

export default async function AddPage() {
  const supabase = await createClient();
  const { start, end } = monthRange(currentMonth());

  const [{ data: claims }, { data: categories }, { data: monthEntries }] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase.from("categories").select("id, name").order("name"),
      supabase
        .from("entries")
        .select("amount, direction")
        .gte("entry_date", start)
        .lte("entry_date", end),
    ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const totals = { in: 0, out: 0 };
  for (const e of monthEntries ?? []) {
    if (e.direction === "in") totals.in += Number(e.amount);
    else totals.out += Number(e.amount);
  }

  return (
    <EntryForm
      userId={userId}
      initialCategories={categories ?? []}
      monthTotals={totals}
    />
  );
}
