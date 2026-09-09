import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  cleanDescription,
  normalizeDate,
  parseCsv,
  type ParsedTransaction,
} from "@/lib/statement-import";

const MAX_BYTES = 10 * 1024 * 1024;

const PROMPT = `This is a UK bank statement. Extract every transaction on it.

Return ONLY a JSON array — no preamble, no explanation, no markdown code fences. Each element must be an object with exactly these keys:
- "date": the transaction date. Dates on the statement are UK format (DD/MM/YYYY, day first); convert them to ISO YYYY-MM-DD.
- "description": the transaction description as printed, cleaned of extra whitespace.
- "amount": the amount as a positive number with no currency symbol.
- "direction": "in" if money was paid into the account (credit), "out" if it left the account (debit).

Include every transaction row. Do not include balance lines, brought-forward totals, or summary rows. If the statement has no transactions, return [].`;

function parseModelResponse(text: string): ParsedTransaction[] | null {
  let raw = text.trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) raw = fenced[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Last resort: the outermost array, in case of stray text around it.
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end <= start) return null;
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;

  const rows: ParsedTransaction[] = [];
  for (const r of parsed) {
    if (!r || typeof r !== "object") continue;
    const { date, description, amount, direction } = r as Record<
      string,
      unknown
    >;
    const isoDate = normalizeDate(date);
    const desc = typeof description === "string" ? description.trim() : "";
    const amt = typeof amount === "number" ? amount : Number(amount);
    if (
      !isoDate ||
      !desc ||
      !Number.isFinite(amt) ||
      amt <= 0 ||
      (direction !== "in" && direction !== "out")
    ) {
      continue;
    }
    rows.push({
      date: isoDate,
      description: cleanDescription(desc),
      rawDescription: desc,
      amount: Math.round(amt * 100) / 100,
      direction,
    });
  }
  return rows;
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File is too large — the limit is 10MB." },
      { status: 400 }
    );
  }

  const name = file.name.toLowerCase();

  if (name.endsWith(".csv")) {
    const result = parseCsv(await file.text());
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json({
      transactions: result.transactions,
      source: "csv",
    });
  }

  if (!name.endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Only PDF and CSV files are supported." },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "PDF import isn't configured on this server (missing API key)." },
      { status: 500 }
    );
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const client = new Anthropic();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data,
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The server's Anthropic API key was rejected." },
        { status: 500 }
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "The parsing service is busy — try again in a minute." },
        { status: 503 }
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: "The parsing service returned an error. Try again." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't reach the parsing service. Try again." },
      { status: 502 }
    );
  }

  if (response.stop_reason === "max_tokens") {
    return NextResponse.json(
      { error: "The statement is too long to parse in one go." },
      { status: 422 }
    );
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const transactions = parseModelResponse(text);
  if (transactions === null) {
    return NextResponse.json(
      { error: "Couldn't read transactions from that PDF. Try again." },
      { status: 422 }
    );
  }

  return NextResponse.json({ transactions, source: "pdf" });
}
