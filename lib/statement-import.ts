import { parse as parseCsvText } from "csv-parse/sync";
import type { Direction } from "./types";

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  description: string; // cleaned, editable in the review screen
  rawDescription: string; // exactly as parsed — stage 2's duplicate
  // fingerprint must use this, never `description`, so cleaning-rule
  // changes can't break matching against already-imported entries.
  amount: number; // positive
  direction: Direction;
};

// The account holder's own name — stripped from descriptions wherever it
// appears, since transfers to/from your own accounts carry it as noise
// ("DAVID TELFER SENT FROM REVOLUT" → "Revolut"). Change it here.
export const OWN_NAME = "DAVID TELFER";

// Everything cleanDescription matches against, in rule order. Add entries
// here — the logic below never hardcodes a pattern. All matching is
// case-insensitive.
export const DESCRIPTION_CLEANING = {
  // 1. Leading transaction-type prefixes, stripped repeatedly (so
  //    "Direct Debit Card Transaction …" loses both). Longest match wins.
  prefixes: [
    "Card Transaction",
    "Automated Credit",
    "OnLine Transaction",
    "Direct Debit",
    "Standing Order",
    "Bank Giro Credit",
    "Faster Payment",
    "Debit",
    "Credit",
  ],
  // 2 (the 4-digit card number after a prefix) is a fixed shape, handled
  //   inline in cleanDescription.
  // 3. Embedded dates: 19MAY26 and 19/05/26.
  datePatterns: [
    /\b\d{1,2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}\b/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{2}\b/g,
  ],
  // 4. Bank reference noise: mobile-payment marker, "FP" + digits, and long
  //    alphanumeric reference codes (10+ chars mixing letters and digits).
  referencePatterns: [
    /\bVIA MOBILE\s*-\s*PYMT\b/gi,
    /\bFP\s+\d+\b/gi,
    /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{10,}\b/gi,
  ],
  // 4b. Short all-caps bank marker tokens (card/point-of-sale/ATM markers,
  //     giro, cheque, transfer), stripped wherever they appear as
  //     standalone words.
  noiseTokens: ["CD", "CDS", "POS", "ATM", "BGC", "CHQ", "TFR"],
  // 4c. Transfer boilerplate phrases, stripped wherever they appear
  //     (before title casing). Pairs with OWN_NAME above.
  boilerplatePhrases: ["SENT FROM", "RECEIVED FROM"],
  // 5. Trailing 2-letter country codes, optionally preceded by a UK
  //    town/city. Deliberately short and obvious, not exhaustive.
  countryCodes: ["GB", "US", "IE"],
  towns: [
    "LONDON",
    "MANCHESTER",
    "BIRMINGHAM",
    "LEEDS",
    "LIVERPOOL",
    "BRISTOL",
    "GLASGOW",
    "EDINBURGH",
    "CARDIFF",
    "BELFAST",
    "SOUTHAMPTON",
    "PORTSMOUTH",
    "BOURNEMOUTH",
    "POOLE",
    "NOTTINGHAM",
    "SHEFFIELD",
    "NEWCASTLE",
    "BRIGHTON",
    "YORK",
    "BATH",
  ],
  // 6. Trailing company suffixes, stripped repeatedly ("… UK LTD" loses both).
  companySuffixes: ["LTD", "LIMITED", "PLC", "LLP", "UK"],
  // 7. Title-casing preserves all-caps words of 3 letters or fewer as
  //    acronyms (CD, PLC) — except these ordinary words, which would look
  //    silly in caps ("Round UP TO 0607").
  shortWords: ["A", "AN", "AND", "AT", "BY", "FOR", "IN", "OF", "ON", "OUT", "THE", "TO", "UP"],
};

const C = DESCRIPTION_CLEANING;
const prefixRe = new RegExp(
  `^\\s*(?:${[...C.prefixes]
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b[\\s:]*`,
  "i"
);
const townCountryRe = new RegExp(
  `(?:\\b(?:${C.towns.join("|")})\\s+)?\\b(?:${C.countryCodes.join("|")})\\s*$`,
  "i"
);
const companySuffixRe = new RegExp(
  `\\s*\\b(?:${C.companySuffixes.join("|")})\\.?\\s*$`,
  "i"
);
const noiseTokenRe = new RegExp(`\\b(?:${C.noiseTokens.join("|")})\\b`, "gi");
const boilerplateRe = new RegExp(
  `\\b(?:${C.boilerplatePhrases.join("|")})\\b`,
  "gi"
);
const ownNameRe = new RegExp(`\\b${OWN_NAME.trim().replace(/\s+/g, "\\s+")}\\b`, "gi");

function toTitleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => {
      if (/^[A-Z]{1,3}$/.test(w) && !C.shortWords.includes(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

export function cleanDescription(raw: string): string {
  let s = raw.trim();

  // 1. Leading transaction-type prefixes.
  let hadPrefix = false;
  for (let next = s.replace(prefixRe, ""); next !== s; next = s.replace(prefixRe, "")) {
    s = next;
    hadPrefix = true;
  }

  // 2. A 4-digit card number directly after the prefix.
  if (hadPrefix) s = s.replace(/^\d{4}\b\s*/, "");

  // 3. Embedded dates.
  for (const re of C.datePatterns) s = s.replace(re, " ");

  // 4. Bank reference noise.
  for (const re of C.referencePatterns) s = s.replace(re, " ");

  // 4b/4c. Bank marker tokens, transfer boilerplate, and the account
  //        holder's own name, wherever they appear.
  s = s.replace(noiseTokenRe, " ");
  s = s.replace(boilerplateRe, " ");
  s = s.replace(ownNameRe, " ");

  // 5. Trailing country code, plus a recognised town before it.
  s = s.trim().replace(townCountryRe, "");

  // 6. Trailing company suffixes.
  for (
    let next = s.trimEnd().replace(companySuffixRe, "");
    next !== s;
    next = s.trimEnd().replace(companySuffixRe, "")
  ) {
    s = next;
  }

  // 7. Collapse whitespace and title-case; empty means we cleaned away a
  //    description that was all noise — fall back to the raw text.
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return raw.trim();
  return toTitleCase(s);
}

export function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();

  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Fall back to UK day-first if the source uses the statement's format.
  const uk = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (uk) {
    [d, m, y] = [Number(uk[1]), Number(uk[2]), Number(uk[3])];
  } else {
    return null;
  }

  if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Statement artefact rows that aren't transactions. Balance lines match
// exactly (a real description could contain the word "balance"); the
// forward markers match anywhere since banks pad them with dates/figures.
const ARTEFACT_EXACT = new Set(["BALANCE", "OPENING BALANCE", "CLOSING BALANCE"]);
const ARTEFACT_CONTAINS = ["BROUGHT FORWARD", "CARRIED FORWARD"];

function isArtefact(description: string): boolean {
  const upper = description.toUpperCase();
  return (
    ARTEFACT_EXACT.has(upper) ||
    ARTEFACT_CONTAINS.some((a) => upper.includes(a))
  );
}

// Strip currency symbols, commas, whitespace, and anything else that isn't
// part of the number; returns a positive amount or null.
function parseAmount(cell: string): number | null {
  const cleaned = cell.replace(/[^0-9.-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n === 0) return null;
  return Math.round(Math.abs(n) * 100) / 100;
}

export function parseCsv(
  text: string
): { transactions: ParsedTransaction[] } | { error: string } {
  let records: string[][];
  try {
    records = parseCsvText(text, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });
  } catch {
    return { error: "Couldn't read that file as CSV." };
  }

  // Find the header row (tolerating junk lines above it) and map columns.
  let headerIndex = -1;
  let cols = { date: -1, description: -1, paidIn: -1, withdrawn: -1 };
  for (let i = 0; i < Math.min(records.length, 10); i++) {
    const cells = records[i].map((c) => c.toLowerCase());
    const found = {
      date: cells.findIndex((c) => c.includes("date")),
      description: cells.findIndex((c) => c.includes("description")),
      paidIn: cells.findIndex(
        (c) => c.includes("paid in") || c.includes("credit")
      ),
      withdrawn: cells.findIndex(
        (c) => c.includes("withdrawn") || c.includes("debit")
      ),
    };
    if (
      Object.values(found).every((idx) => idx !== -1) &&
      found.paidIn !== found.withdrawn
    ) {
      headerIndex = i;
      cols = found;
      break;
    }
  }
  if (headerIndex === -1) {
    return {
      error:
        'Couldn\'t find the expected columns. The CSV needs a header row with "Date", "Description", a paid-in column ("Paid In" or "Credit") and a withdrawn column ("Withdrawn" or "Debit").',
    };
  }

  const transactions: ParsedTransaction[] = [];
  for (const row of records.slice(headerIndex + 1)) {
    const date = normalizeDate(row[cols.date] ?? "");
    const description = (row[cols.description] ?? "").trim();
    const paidIn = parseAmount(row[cols.paidIn] ?? "");
    const withdrawn = parseAmount(row[cols.withdrawn] ?? "");

    if (!date || !description || isArtefact(description)) continue;
    // Exactly one of the two amount columns must have a value.
    if ((paidIn === null) === (withdrawn === null)) continue;

    transactions.push({
      date,
      description: cleanDescription(description),
      rawDescription: description,
      amount: (paidIn ?? withdrawn)!,
      direction: paidIn !== null ? "in" : "out",
    });
  }
  return { transactions };
}
