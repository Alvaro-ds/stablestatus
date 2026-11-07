import { describe, it, expect } from "vitest";

import { dedupeRows } from "../../src/normalize/dedupe.js";
import type { ParsedRow } from "../../src/esma/parse.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(rowIndex: number, rowSha256: string, fields: Record<string, string> = {}): ParsedRow {
  return { rowIndex, rowSha256, fields };
}

// ---------------------------------------------------------------------------
// dedupeRows
// ---------------------------------------------------------------------------

describe("dedupeRows", () => {
  it("returns all rows unchanged when there are no duplicates", () => {
    const rows = [row(1, "aaa"), row(2, "bbb"), row(3, "ccc")];
    const result = dedupeRows(rows);
    expect(result).toHaveLength(3);
    result.forEach((r) => expect(r.fields["_quality"]).toBeUndefined());
  });

  it("removes the duplicate keeping the first occurrence", () => {
    const rows = [row(1, "aaa"), row(2, "aaa"), row(3, "bbb")];
    const result = dedupeRows(rows);
    expect(result).toHaveLength(2);
    expect(result[0]!.rowIndex).toBe(1);
    expect(result[1]!.rowIndex).toBe(3);
  });

  it("marks the survivor with quality duplicate_row", () => {
    const rows = [row(1, "aaa"), row(2, "aaa")];
    const result = dedupeRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.rowSha256).toBe("aaa");
    // the _quality key communicates to the caller that a duplicate was removed
    expect(result[0]!.fields["_quality"]).toContain("duplicate_row");
  });

  it("handles multiple distinct duplicate groups", () => {
    const rows = [
      row(1, "aaa"),
      row(2, "aaa"), // dup of 1
      row(3, "bbb"),
      row(4, "bbb"), // dup of 3
      row(5, "ccc"),
    ];
    const result = dedupeRows(rows);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.rowIndex)).toEqual([1, 3, 5]);
  });

  it("matches AIEU fixture — 3 rows where rows 2 and 3 are identical", () => {
    const rows = [
      row(27, "cb234669"), // different content
      row(29, "5d5565ab"), // duplicate pair
      row(30, "5d5565ab"), // duplicate pair
    ];
    const result = dedupeRows(rows);
    expect(result).toHaveLength(2);
    expect(result[0]!.rowIndex).toBe(27);
    expect(result[1]!.rowIndex).toBe(29);
    expect(result[1]!.fields["_quality"]).toContain("duplicate_row");
  });

  it("matches StablR fixture — 2 identical rows → 1 survivor", () => {
    const rows = [row(33, "792f40f3"), row(34, "792f40f3")];
    const result = dedupeRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.rowIndex).toBe(33);
  });
});
