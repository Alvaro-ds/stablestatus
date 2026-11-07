export interface WpUrlResult {
  wpType: "url" | "EMT_NO_WP" | "EMT_CRIN";
  wpUrl: string | null;
}

/** Normalises wp_url: trims, lowercases the host, handles EMT_NO_WP / EMT_CRIN. */
export function normalizeWpUrl(raw: string): WpUrlResult {
  const trimmed = raw.trim();
  if (trimmed === "EMT_NO_WP") return { wpType: "EMT_NO_WP", wpUrl: null };
  if (trimmed === "EMT_CRIN") return { wpType: "EMT_CRIN", wpUrl: null };

  const url = new URL(trimmed);
  url.hostname = url.hostname.toLowerCase();
  return { wpType: "url", wpUrl: url.toString() };
}

/** Extracts a ticker hint from wp_comments using conservative pattern matching. */
export function extractTickerHint(comments: string): string | null {
  // Match 4-8 uppercase letters at the start, followed by whitespace, comma, or end of string.
  // Rejects 3-char prefixes like "EMT" and lowercase-starting prose.
  const m = comments.match(/^([A-Z]{4,8})(\s|,|$)/);
  return m ? (m[1] ?? null) : null;
}
