/**
 * ESMA sometimes puts several lines in ae_lei_name (e.g. Qivalis: the same name three times).
 * `name` keeps the raw value; displayName is the first non-empty line without extra spaces.
 */
export function normalizeDisplayName(raw: string): { displayName: string; quality: string[] } {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "");
  const displayName = lines[0] ?? "";
  const repeated = lines.length > 1 && lines.every((l) => l === displayName);
  return { displayName, quality: repeated ? ["name_repeated_lines"] : [] };
}
