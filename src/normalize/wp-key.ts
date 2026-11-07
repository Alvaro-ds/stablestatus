import { createHash } from "node:crypto";

import type { ParsedRow } from "../esma/parse.js";

/**
 * Thrown when two non-duplicate rows produce the same wpKey.
 * This should never happen with real ESMA data; if it does, the data
 * quality team must investigate before the pipeline can proceed.
 */
export class WpKeyCollisionError extends Error {
  constructor(
    public readonly wpKey: string,
    public readonly rowA: ParsedRow,
    public readonly rowB: ParsedRow
  ) {
    super(
      `wpKey collision "${wpKey}" produced by rows ${rowA.rowIndex} and ${rowB.rowIndex}. ` +
        `Rows are not exact duplicates — add a distinguishing field or file a data quality report.`
    );
    this.name = "WpKeyCollisionError";
  }
}

/**
 * Generates a stable, content-based wpKey.
 *
 * Key = lei + ":" + first 12 hex chars of sha256(wpUrlOrType|comments|offerDateRaw).
 *
 * Using content fields (not row position) means inserting or reordering rows
 * in the ESMA register does not rename existing white papers, which would
 * otherwise generate false withdrawals in B4.
 */
export function generateWpKey(
  lei: string,
  wpUrlOrType: string,
  wpComments: string,
  wpOfferDateRaw: string
): string {
  const input = `${wpUrlOrType}|${wpComments.trim()}|${wpOfferDateRaw.trim()}`;
  const hash = createHash("sha256").update(input, "utf8").digest("hex").slice(0, 12);
  return `${lei}:${hash}`;
}
