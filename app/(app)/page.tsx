import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EntryForm from "@/components/EntryForm";

export default async function AddPage() {
  const supabase = await createClient();

  const [{ data: claims }, { data: categories }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  return <EntryForm userId={userId} initialCategories={categories ?? []} />;
}
