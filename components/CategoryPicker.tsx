"use client";

import type { Category, CategoryPick } from "@/lib/types";
import styles from "./EntryForm.module.css";

// Multi-select category input + chip list used by the entry form, shared
// with the statement import review. Selection state lives in the parent:
// `query` is the type-ahead text, `selected` the chosen categories (an
// inline-created one has id null until the entry is saved). Tapping a
// chip toggles it; tapping the dashed "+ name" chip adds the typed name.
export default function CategoryPicker({
  categories,
  query,
  selected,
  onQueryChange,
  onSelectedChange,
  ariaLabel = "Category",
}: {
  categories: Category[];
  query: string;
  selected: CategoryPick[];
  onQueryChange: (query: string) => void;
  onSelectedChange: (selected: CategoryPick[]) => void;
  ariaLabel?: string;
}) {
  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const exactMatch = categories.find((c) => c.name.toLowerCase() === lowerQuery);
  const selectedIds = new Set(
    selected.map((s) => s.id).filter((id): id is string => id !== null)
  );
  const pendingNew = selected.filter((s) => s.id === null);
  const pendingTaken = pendingNew.some((s) => s.name.toLowerCase() === lowerQuery);

  // Typing filters the list, but what's already selected stays visible so
  // the selection is always readable.
  const chips = trimmedQuery
    ? categories.filter(
        (c) => selectedIds.has(c.id) || c.name.toLowerCase().includes(lowerQuery)
      )
    : categories;

  function toggle(c: Category) {
    if (selectedIds.has(c.id)) {
      onSelectedChange(selected.filter((s) => s.id !== c.id));
    } else {
      onSelectedChange([...selected, { id: c.id, name: c.name }]);
      // A chip tapped while filtering is the answer to the filter.
      if (trimmedQuery) onQueryChange("");
    }
  }

  function addTyped() {
    if (!trimmedQuery) return;
    if (exactMatch) {
      if (!selectedIds.has(exactMatch.id)) {
        onSelectedChange([
          ...selected,
          { id: exactMatch.id, name: exactMatch.name },
        ]);
      }
    } else if (!pendingTaken) {
      onSelectedChange([...selected, { id: null, name: trimmedQuery }]);
    }
    onQueryChange("");
  }

  return (
    <div className={styles.field}>
      <input
        className={styles.input}
        type="text"
        placeholder={selected.length ? "Add another category" : "Category"}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        aria-label={ariaLabel}
      />
      <div className={styles.chips}>
        {pendingNew.map((s) => (
          <button
            key={`new:${s.name.toLowerCase()}`}
            type="button"
            className={styles.chipActive}
            aria-pressed={true}
            onClick={() =>
              onSelectedChange(
                selected.filter((o) => !(o.id === null && o.name === s.name))
              )
            }
          >
            {s.name}
          </button>
        ))}
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={selectedIds.has(c.id) ? styles.chipActive : styles.chip}
            aria-pressed={selectedIds.has(c.id)}
            onClick={() => toggle(c)}
          >
            {c.name}
          </button>
        ))}
        {trimmedQuery && !exactMatch && !pendingTaken && (
          <button
            type="button"
            className={styles.newChip}
            onClick={addTyped}
          >
            + &ldquo;{trimmedQuery}&rdquo;
          </button>
        )}
      </div>
    </div>
  );
}
