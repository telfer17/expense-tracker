import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DuplicatesView, {
  type DuplicateEntry,
  type DuplicateGroup,
} from "@/components/DuplicatesView";

// Maintenance tool: groups entries sharing date + amount + direction so
// stray double-recordings (e.g. a manual entry later re-imported from a
// statement) can be deleted by hand. Linked from the Categories page, not
// the main nav.
export default async function DuplicatesPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  // Every entry, paged past PostgREST's 1000-row cap (same pattern as the
  // export route). The created_at/id tiebreaks keep the ordering
  // deterministic across page boundaries.
  const PAGE = 1000;
  const rows: {
    id: string;
    amount: number;
    direction: "in" | "out";
    entry_date: string;
    note: string | null;
    import_batch: string | null;
    categories: { name: string } | { name: string }[] | null;
  }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("entries")
      .select(
        "id, amount, direction, entry_date, note, import_batch, categories(name)"
      )
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(`Couldn't load entries: ${error.message}`);
    }
    rows.push(...((data as typeof rows) ?? []));
    if (!data || data.length < PAGE) break;
  }

  // Group by date + amount (in pence, avoiding float keys) + direction;
  // only groups with more than one entry are duplicates worth showing.
  // Entries arrive newest-first, so group order is already newest-first.
  const byKey = new Map<string, DuplicateGroup>();
  for (const e of rows) {
    const amount = Number(e.amount);
    const key = `${e.entry_date}|${Math.round(amount * 100)}|${e.direction}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        date: e.entry_date,
        amount,
        direction: e.direction,
        entries: [],
      };
      byKey.set(key, group);
    }
    const category = Array.isArray(e.categories)
      ? e.categories[0]
      : e.categories;
    const entry: DuplicateEntry = {
      id: e.id,
      note: e.note,
      category: category?.name ?? null,
      imported: e.import_batch !== null,
    };
    group.entries.push(entry);
  }
  const groups = [...byKey.values()].filter((g) => g.entries.length > 1);

  return <DuplicatesView initialGroups={groups} />;
}
