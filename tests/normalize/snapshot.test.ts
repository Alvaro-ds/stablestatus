import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEsmaCsv } from "../../src/esma/parse.js";
import { computeSha256 } from "../../src/esma/store.js";
import { normalizeEmtwp } from "../../src/normalize/index.js";
import type { SourceSnapshot } from "../../src/model/index.js";

const FIXTURE_PATH = join(import.meta.dirname, "..", "fixtures", "esma", "EMTWP_2026-10-30.csv");
const fixtureBuf = readFileSync(FIXTURE_PATH);
const parseResult = parseEsmaCsv(fixtureBuf, "EMTWP");

const snapshot: SourceSnapshot = {
  url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  fetchedAt: "2026-10-30T05:00:00Z",
  sha256: computeSha256(fixtureBuf),
  sizeBytes: fixtureBuf.length,
  rowCount: parseResult.rows.length,
};

const NOW = new Date("2026-11-07T00:00:00Z");
const DATE = "2026-11-07";

describe("normalizeEmtwp — reviewable snapshot", () => {
  it("matches file snapshot", async () => {
    const result = normalizeEmtwp(parseResult, snapshot, DATE, NOW);
    const snapshotPath = join(
      import.meta.dirname,
      "..",
      "__snapshots__",
      "emtwp-2026-10-30.normalized.json"
    );
    await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(snapshotPath);
  });
});
