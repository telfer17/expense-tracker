"use client";

import type { Category } from "@/lib/types";
import styles from "./EntryForm.module.css";

// The category input + chip list used by the entry form, shared with the
// statement import review. Selection state lives in the parent: `query` is
// the free text, `selected` a chip the user tapped (null once they type).
export default function CategoryPicker({
  categories,
  query,
  selected,
  onQueryChange,
  onPick,
  ariaLabel = "Category",
}: {
  categories: Category[];
  query: string;
  selected: Category | null;
  onQueryChange: (query: string) => void;
  onPick: (category: Category) => void;
  ariaLabel?: string;
}) {
  const trimmedQuery = query.trim();
  const exactMatch = categories.find(
    (c) => c.name.toLowerCase() === trimmedQuery.toLowerCase()
  );
  const chips =
    trimmedQuery && !exactMatch
      ? categories.filter((c) =>
          c.name.toLowerCase().includes(trimmedQuery.toLowerCase())
        )
      : categories;

  return (
    <div className={styles.field}>
      <input
        className={styles.input}
        type="text"
        placeholder="Category"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        aria-label={ariaLabel}
      />
      <div className={styles.chips}>
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={
              (selected?.id ?? exactMatch?.id) === c.id
                ? styles.chipActive
                : styles.chip
            }
            onClick={() => onPick(c)}
          >
            {c.name}
          </button>
        ))}
        {trimmedQuery && !exactMatch && (
          <span className={styles.newChip}>+ &ldquo;{trimmedQuery}&rdquo;</span>
        )}
      </div>
    </div>
  );
}
