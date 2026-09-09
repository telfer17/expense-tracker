"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./CategoriesManager.module.css";

type CategoryRow = {
  id: string;
  name: string;
  count: number;
};

export default function CategoriesManager({
  categories,
}: {
  categories: CategoryRow[];
}) {
  const router = useRouter();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  async function rename(cat: CategoryRow, newName: string) {
    const name = newName.trim();
    if (!name || name === cat.name) {
      router.refresh();
      return;
    }
    const { error } = await createClient()
      .from("categories")
      .update({ name })
      .eq("id", cat.id);
    if (error) {
      alert(`Couldn't rename — a category called "${name}" may already exist.`);
    }
    router.refresh();
  }

  async function handleDelete(cat: CategoryRow) {
    if (cat.count > 0) {
      setReassignFor(cat.id);
      setTarget("");
      return;
    }
    if (!confirm(`Delete "${cat.name}"?`)) return;
    const { error } = await createClient()
      .from("categories")
      .delete()
      .eq("id", cat.id);
    if (error) alert("Couldn't delete the category.");
    router.refresh();
  }

  async function reassignAndDelete(cat: CategoryRow) {
    if (!target) return;
    setBusy(true);
    const supabase = createClient();

    const { error: moveError } = await supabase
      .from("entries")
      .update({ category_id: target })
      .eq("category_id", cat.id);
    if (moveError) {
      alert("Couldn't move the entries. Nothing was deleted.");
      setBusy(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("categories")
      .delete()
      .eq("id", cat.id);
    if (deleteError) {
      alert("Entries were moved, but the category couldn't be deleted.");
    }
    setBusy(false);
    setReassignFor(null);
    router.refresh();
  }

  return (
    <ul className={styles.list}>
      {categories.length === 0 && (
        <li className={styles.empty}>No categories yet.</li>
      )}
      {categories.map((cat) => {
        const others = categories.filter((c) => c.id !== cat.id);
        return (
          <li key={cat.id} className={styles.item}>
            <div className={styles.row}>
              {renamingId === cat.id ? (
                <input
                  className={styles.name}
                  type="text"
                  defaultValue={cat.name}
                  autoFocus
                  aria-label={`Rename ${cat.name}`}
                  onBlur={(e) => {
                    setRenamingId(null);
                    void rename(cat, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.value = cat.name;
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <Link href={`/categories/${cat.id}`} className={styles.nameLink}>
                  {cat.name}
                </Link>
              )}
              <span className={styles.count}>
                {cat.count} {cat.count === 1 ? "entry" : "entries"}
              </span>
              <button
                type="button"
                className={styles.renameBtn}
                onClick={() => setRenamingId(cat.id)}
              >
                Rename
              </button>
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => void handleDelete(cat)}
              >
                Delete
              </button>
            </div>

            {reassignFor === cat.id && (
              <div className={styles.reassign}>
                {others.length === 0 ? (
                  <p className={styles.reassignHint}>
                    This category has entries and there is no other category to
                    move them to. Add another category first.
                  </p>
                ) : (
                  <>
                    <p className={styles.reassignHint}>
                      Move its {cat.count}{" "}
                      {cat.count === 1 ? "entry" : "entries"} to:
                    </p>
                    <select
                      className={styles.select}
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      aria-label="Reassign entries to"
                    >
                      <option value="">Pick a category…</option>
                      {others.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <div className={styles.reassignActions}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    disabled={busy}
                    onClick={() => setReassignFor(null)}
                  >
                    Cancel
                  </button>
                  {others.length > 0 && (
                    <button
                      type="button"
                      className={styles.confirmBtn}
                      disabled={!target || busy}
                      onClick={() => void reassignAndDelete(cat)}
                    >
                      Move &amp; delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
