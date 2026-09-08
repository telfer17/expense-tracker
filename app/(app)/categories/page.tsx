import { createClient } from "@/lib/supabase/server";
import CategoriesManager from "@/components/CategoriesManager";
import { logout } from "./actions";
import styles from "./categories.module.css";

export default async function CategoriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, entries(count)")
    .order("name");

  const categories = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    count: c.entries[0]?.count ?? 0,
  }));

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Categories</h1>
      <CategoriesManager categories={categories} />
      <form action={logout}>
        <button type="submit" className={styles.logout}>
          Log out
        </button>
      </form>
    </div>
  );
}
