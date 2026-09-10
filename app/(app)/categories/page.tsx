import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CategoriesManager from "@/components/CategoriesManager";
import StartingBalance from "@/components/StartingBalance";
import { logout } from "./actions";
import styles from "./categories.module.css";

export default async function CategoriesPage() {
  const supabase = await createClient();
  const [{ data: claims }, { data, error }, { data: settingsRow }] =
    await Promise.all([
      supabase.auth.getClaims(),
      supabase
        .from("categories")
        .select("id, name, entries(count)")
        .order("name"),
      supabase
        .from("user_settings")
        .select("starting_balance, starting_balance_date")
        .maybeSingle(),
    ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  if (error) {
    throw new Error(`Couldn't load categories: ${error.message}`);
  }

  const categories = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    count: c.entries[0]?.count ?? 0,
  }));

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Categories</h1>
      <CategoriesManager categories={categories} />
      <StartingBalance
        userId={userId}
        initialBalance={
          settingsRow?.starting_balance === null ||
          settingsRow?.starting_balance === undefined
            ? null
            : Number(settingsRow.starting_balance)
        }
        initialDate={settingsRow?.starting_balance_date ?? null}
      />
      <a href="/api/export" className={styles.export} download>
        Download all entries (CSV)
      </a>
      <form action={logout}>
        <button type="submit" className={styles.logout}>
          Log out
        </button>
      </form>
    </div>
  );
}
