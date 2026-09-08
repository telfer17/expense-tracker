import { createClient } from "@/lib/supabase/server";
import EntryForm from "@/components/EntryForm";

export default async function AddPage() {
  const supabase = await createClient();

  const [{ data: claims }, { data: categories }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  return (
    <EntryForm
      userId={claims!.claims.sub}
      initialCategories={categories ?? []}
    />
  );
}
