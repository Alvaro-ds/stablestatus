import type { ParsedRow } from "../esma/parse.js";

/**
 * Removes exact row duplicates (same rowSha256).
 * The first occurrence is kept and marked with fields["_quality"] = "duplicate_row"
 * when at least one duplicate was removed. Downstream code reads and strips this key.
 */
export function dedupeRows(rows: ParsedRow[]): ParsedRow[] {
  // First pass: find which sha256 values appear more than once.
  const seen = new Set<string>();
  const hasDupes = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.rowSha256)) {
      hasDupes.add(row.rowSha256);
    } else {
      seen.add(row.rowSha256);
    }
  }

  // Second pass: keep first occurrence only; mark survivors of a duplicate group.
  const kept = new Set<string>();
  const result: ParsedRow[] = [];
  for (const row of rows) {
    if (kept.has(row.rowSha256)) continue;
    kept.add(row.rowSha256);
    if (hasDupes.has(row.rowSha256)) {
      result.push({ ...row, fields: { ...row.fields, _quality: "duplicate_row" } });
    } else {
      result.push(row);
    }
  }
  return result;
}
