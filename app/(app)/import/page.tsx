import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ImportView from "@/components/ImportView";

export default async function ImportPage() {
  const supabase = await createClient();
  const [{ data: claims }, { data: categories }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  return <ImportView categories={categories ?? []} userId={userId} />;
}
