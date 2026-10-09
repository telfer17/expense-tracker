export type Category = {
  id: string;
  name: string;
};

// A category chosen in a picker: an existing one, or (id null) a name
// typed inline that will be created when the entry is saved.
export type CategoryPick = {
  id: string | null;
  name: string;
};

export type Direction = "in" | "out";

export type Entry = {
  id: string;
  amount: number;
  direction: Direction;
  // Every category tagged on the entry (via entry_categories). Empty for
  // an uncategorised entry, which only a statement import can create.
  category_ids: string[];
  entry_date: string;
  note: string | null;
  is_recurring: boolean;
  // Null for manually created entries; set when a statement import made it.
  import_batch: string | null;
};

// Shape of the entry_categories embed PostgREST returns on an entry.
export type EntryCategoryRow = { category_id: string };

export function categoryIdsOf(
  embed: EntryCategoryRow[] | EntryCategoryRow | null | undefined
): string[] {
  if (!embed) return [];
  return (Array.isArray(embed) ? embed : [embed]).map((r) => r.category_id);
}

// Names of an entry's categories in alphabetical order, for display.
export function categoryNames(
  ids: string[],
  nameById: Map<string, string>
): string[] {
  return ids
    .map((id) => nameById.get(id))
    .filter((n): n is string => n !== undefined)
    .sort((a, b) => a.localeCompare(b));
}
