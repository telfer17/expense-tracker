// Escape a user-typed term for use inside a Postgres ILIKE pattern, so
// literal %, _ and \ in the term don't act as wildcards.
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}
