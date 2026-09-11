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
  const [{ data: claims }, { data, error }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("entries")
      .select(
        "id, amount, direction, entry_date, note, import_batch, categories(name)"
      )
      .order("entry_date", { ascending: false }),
  ]);

  if (!claims?.claims?.sub) redirect("/login");
  if (error) {
    throw new Error(`Couldn't load entries: ${error.message}`);
  }

  // Group by date + amount (in pence, avoiding float keys) + direction;
  // only groups with more than one entry are duplicates worth showing.
  // Entries arrive newest-first, so group order is already newest-first.
  const byKey = new Map<string, DuplicateGroup>();
  for (const e of data ?? []) {
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
