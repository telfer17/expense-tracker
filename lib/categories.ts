import type { Category, CategoryPick } from "./types";

// The selection an entry is saved with: the picked chips plus whatever is
// still typed in the box — an existing category if the name matches one,
// otherwise a new category to create — so "type a name and hit Save"
// keeps working without tapping the "+ name" chip first.
export function withTypedCategory(
  selected: CategoryPick[],
  query: string,
  categories: Category[]
): CategoryPick[] {
  const name = query.trim();
  if (!name) return selected;
  const lower = name.toLowerCase();
  const match = categories.find((c) => c.name.toLowerCase() === lower);
  if (match) {
    if (selected.some((s) => s.id === match.id)) return selected;
    return [...selected, { id: match.id, name: match.name }];
  }
  if (selected.some((s) => s.id === null && s.name.toLowerCase() === lower)) {
    return selected;
  }
  return [...selected, { id: null, name }];
}

// Escape ilike wildcards so % and _ in a category name match literally.
export function ilikeLiteral(name: string): string {
  return name.replace(/[\\%_]/g, "\\$&");
}
