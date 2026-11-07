/**
 * Returns true when the raw value is a non-empty, non-date placeholder (e.g. "n/a").
 * Used by the pipeline to add a "date_placeholder" quality flag to the entity.
 */
export function isDatePlaceholder(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed !== "" && !/^\d/.test(trimmed);
}

/** Converts an ESMA date string (dd/mm/yyyy) to ISO YYYY-MM-DD, or null if empty/non-date. */
export function parseEsmaDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Values like "n/a" are legitimate placeholders — treat as missing date.
  // Only throw when the value starts with a digit, indicating it should be a date
  // but has an unexpected format (e.g. ESMA changes the layout).
  if (!/^\d/.test(trimmed)) return null;

  const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`Invalid ESMA date format: "${raw}"`);

  return `${m[3]}-${m[2]}-${m[1]}`;
}
