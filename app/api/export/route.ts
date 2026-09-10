import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ukToday } from "@/lib/month";

// A full backup must never serve a cached copy.
export const dynamic = "force-dynamic";

// RFC 4180: quote a field if it contains a comma, quote, or newline;
// double any quotes inside it.
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

type ExportRow = {
  entry_date: string;
  note: string | null;
  amount: number;
  direction: string;
  is_recurring: boolean;
  categories: { name: string } | { name: string }[] | null;
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Every entry, no filters — paged past PostgREST's 1000-row cap. The id
  // tiebreak keeps the ordering deterministic across page boundaries.
  const PAGE = 1000;
  const rows: ExportRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("entries")
      .select("entry_date, note, amount, direction, is_recurring, categories(name)")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json(
        { error: "Couldn't export entries. Try again." },
        { status: 500 }
      );
    }
    rows.push(...((data as ExportRow[]) ?? []));
    if (!data || data.length < PAGE) break;
  }

  const lines = ["date,description,amount,direction,category,recurring"];
  for (const r of rows) {
    const category = Array.isArray(r.categories)
      ? r.categories[0]
      : r.categories;
    lines.push(
      [
        r.entry_date,
        csvField(r.note ?? ""),
        Number(r.amount).toFixed(2),
        r.direction,
        csvField(category?.name ?? ""),
        r.is_recurring ? "yes" : "no",
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expense-tracker-${ukToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
