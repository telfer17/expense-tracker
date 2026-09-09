"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (error) {
    // TEMP: surface the real cause of local login failures. Remove me.
    console.error("[login] signInWithPassword failed:", {
      status: error.status,
      message: error.message,
    });
    redirect("/login?error=1");
  }

  redirect("/");
}
