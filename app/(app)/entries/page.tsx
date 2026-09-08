import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentMonth, monthRange } from "@/lib/month";
import EntriesView from "@/components/EntriesView";

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: raw } = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw ?? "")
    ? raw!
    : currentMonth();
  const { start, end } = monthRange(month);

  const supabase = await createClient();
  const [{ data: claims }, { data: entries }, { data: categories }] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase
        .from("entries")
        .select("id, amount, direction, category_id, entry_date, note, is_recurring")
        .gte("entry_date", start)
        .lte("entry_date", end)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("categories").select("id, name").order("name"),
    ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  return (
    <EntriesView
      month={month}
      entries={entries ?? []}
      categories={categories ?? []}
      userId={userId}
    />
  );
}
