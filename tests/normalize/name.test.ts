import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseEsmaCsv } from "../../src/esma/parse.js";
import { computeSha256 } from "../../src/esma/store.js";
import { normalizeEmtwp } from "../../src/normalize/index.js";
import { normalizeDisplayName } from "../../src/normalize/name.js";

describe("normalizeDisplayName", () => {
  it("keeps single-line names, trimming extra spaces", () => {
    expect(normalizeDisplayName("  Monerium   ehf ")).toEqual({
      displayName: "Monerium ehf",
      quality: [],
    });
  });

  it("uses the first non-empty line and flags repeated lines", () => {
    expect(normalizeDisplayName("\r\nA B.V.\r\nA  B.V.\n")).toEqual({
      displayName: "A B.V.",
      quality: ["name_repeated_lines"],
    });
  });

  it("does not flag different lines", () => {
    expect(normalizeDisplayName("A B.V.\nB B.V.").quality).toEqual([]);
  });
});

describe("Qivalis in the real ESMA file of 2026-11-11", () => {
  it("keeps the raw name and adds displayName with name_repeated_lines", () => {
    const buf = readFileSync(
      join(import.meta.dirname, "..", "fixtures", "esma", "EMTWP_2026-11-11.csv")
    );
    const parsed = parseEsmaCsv(buf, "EMTWP");
    const { issuers } = normalizeEmtwp(
      parsed,
      {
        url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
        fetchedAt: "2026-11-11T14:19:31.574Z",
        sha256: computeSha256(buf),
        sizeBytes: buf.length,
        rowCount: parsed.rows.length,
        retrieval: "file",
      },
      "2026-11-11",
      new Date("2026-11-11T14:19:31.574Z")
    );
    const qivalis = issuers.find((i) => i.lei === "724500LOOWQMIDXTS391");

    expect(qivalis?.name.split(/\r?\n/).filter((l) => l.trim())).toEqual([
      "Qivalis B.V.",
      "Qivalis B.V.",
      "Qivalis B.V.",
    ]);
    expect(qivalis?.displayName).toBe("Qivalis B.V.");
    expect(qivalis?.quality).toContain("name_repeated_lines");
  });
});
