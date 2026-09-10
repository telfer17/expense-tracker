// Duplicate-detection fingerprints for entries. A fingerprint identifies
// the source transaction by date + amount + normalised description, so a
// re-imported statement row can be matched against what's already stored.
//
// Imported entries MUST be fingerprinted from the raw statement
// description, never the cleaned one — cleaning rules change over time and
// must not break matching. Manual entries fingerprint their note. An empty
// description yields null, which is stored as null and never matches.

function normalizeForFingerprint(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function computeFingerprint(
  entryDate: string,
  amount: number,
  rawDescription: string
): Promise<string | null> {
  const desc = normalizeForFingerprint(rawDescription);
  if (!desc) return null;
  const input = `${entryDate}|${amount.toFixed(2)}|${desc}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
