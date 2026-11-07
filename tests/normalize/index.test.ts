import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEsmaCsv } from "../../src/esma/parse.js";
import { computeSha256 } from "../../src/esma/store.js";
import { normalizeEmtwp } from "../../src/normalize/index.js";
import type { SourceSnapshot } from "../../src/model/index.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(import.meta.dirname, "..", "fixtures", "esma", "EMTWP_2026-10-30.csv");
const fixtureBuf = readFileSync(FIXTURE_PATH);
const parseResult = parseEsmaCsv(fixtureBuf, "EMTWP");

const snapshot: SourceSnapshot = {
  url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  fetchedAt: "2026-10-30T05:00:00Z",
  sha256: computeSha256(fixtureBuf),
  sizeBytes: fixtureBuf.length,
  rowCount: parseResult.rows.length,
  retrieval: "file",
};

const NOW = new Date("2026-11-07T00:00:00Z");
const DATE = "2026-11-07";

function getResult() {
  return normalizeEmtwp(parseResult, snapshot, DATE, NOW);
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — counts", () => {
  it("produces 25 issuers", () => {
    expect(getResult().issuers).toHaveLength(25);
  });

  it("produces 48 whitepapers (50 rows − 2 exact duplicates)", () => {
    expect(getResult().whitepapers).toHaveLength(48);
  });

  it("all whitepaper wpKeys are unique", () => {
    const { whitepapers } = getResult();
    const keys = new Set(whitepapers.map((w) => w.wpKey));
    expect(keys.size).toBe(whitepapers.length);
  });

  it("all issuer LEIs are unique", () => {
    const { issuers } = getResult();
    const leis = new Set(issuers.map((i) => i.lei));
    expect(leis.size).toBe(issuers.length);
  });
});

// ---------------------------------------------------------------------------
// GR8.money — DTI/FFG swap
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — GR8.money DTI/FFG swap", () => {
  const GR8_LEI = "6488GKH17O8XT1326F66";

  it("both GR8.money whitepapers are flagged dti_ffg_swapped", () => {
    const { whitepapers } = getResult();
    const gr8 = whitepapers.filter((w) => w.lei === GR8_LEI);
    expect(gr8).toHaveLength(2);
    gr8.forEach((w) => expect(w.quality).toContain("dti_ffg_swapped"));
  });

  it("GR8 row 1: DTI is 9JDH8QBV2, FFG is 5X779H3M3 (after swap)", () => {
    const { whitepapers } = getResult();
    const gr8 = whitepapers
      .filter((w) => w.lei === GR8_LEI)
      .sort((a, b) => a.provenance.rowIndex - b.provenance.rowIndex);
    expect(gr8[0]!.dtis).toEqual(["9JDH8QBV2"]);
    expect(gr8[0]!.ffg).toBe("5X779H3M3");
  });
});

// ---------------------------------------------------------------------------
// AIEU — duplicate row fused
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — AIEU duplicate row", () => {
  const AIEU_LEI = "254900VUR90QF0G3T387";

  it("AIEU has 2 whitepapers (rows 29/30 merged → 1)", () => {
    const { whitepapers } = getResult();
    expect(whitepapers.filter((w) => w.lei === AIEU_LEI)).toHaveLength(2);
  });

  it("the surviving duplicate row is marked duplicate_row", () => {
    const { whitepapers } = getResult();
    const aieu = whitepapers.filter((w) => w.lei === AIEU_LEI);
    // row 29 survived (rows 29/30 were exact dups); row 27 is different
    const dup = aieu.find((w) => w.provenance.rowIndex === 29);
    expect(dup).toBeDefined();
    expect(dup!.quality).toContain("duplicate_row");
  });
});

// ---------------------------------------------------------------------------
// Quantoz — authorisation_date_missing
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — Quantoz authorisation_date_missing", () => {
  const QUANTOZ_LEI = "7245008P1HPUPVM7XL94";

  it("Quantoz has 6 whitepapers", () => {
    const { whitepapers } = getResult();
    expect(whitepapers.filter((w) => w.lei === QUANTOZ_LEI)).toHaveLength(6);
  });

  it("exactly 3 Quantoz whitepapers have authorisation_date_missing status", () => {
    const { whitepapers } = getResult();
    const missing = whitepapers.filter(
      (w) => w.lei === QUANTOZ_LEI && w.registerStatus === "authorisation_date_missing"
    );
    expect(missing).toHaveLength(3);
  });

  it("Quantoz issuer is authorised (3 whitepapers have an auth date)", () => {
    const { issuers } = getResult();
    const quantoz = issuers.find((i) => i.lei === QUANTOZ_LEI);
    expect(quantoz!.registerStatus).toBe("authorised");
  });
});

// ---------------------------------------------------------------------------
// Bridge Building — 8 DTIs
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — Bridge Building 8 DTIs", () => {
  const BB_LEI = "254900MVWQXMF77YZP65";

  it("Bridge Building has 8 DTIs extracted from embedded-newline field", () => {
    const { whitepapers } = getResult();
    const bb = whitepapers.find((w) => w.lei === BB_LEI);
    expect(bb!.dtis).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Monerium — no empty DTIs from double-pipe
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — Monerium double-pipe", () => {
  const MONERIUM_LEI = "2549003QDNZWASSSCY31";

  it("Monerium DTIs contain no empty strings", () => {
    const { whitepapers } = getResult();
    const mon = whitepapers.find((w) => w.lei === MONERIUM_LEI);
    expect(mon!.dtis.every((t) => t.length === 9)).toBe(true);
  });

  it("Monerium has 7 DTIs", () => {
    const { whitepapers } = getResult();
    const mon = whitepapers.find((w) => w.lei === MONERIUM_LEI);
    expect(mon!.dtis).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// EMT_NO_WP — 2 issuers
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — EMT_NO_WP", () => {
  it("exactly 2 whitepapers have wpType EMT_NO_WP", () => {
    const { whitepapers } = getResult();
    expect(whitepapers.filter((w) => w.wpType === "EMT_NO_WP")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// DNB errata — both spellings → NL-DNB
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — DNB authority errata", () => {
  it("all Dutch-supervised issuers have authorityCode NL-DNB", () => {
    const { issuers } = getResult();
    const dutch = issuers.filter(
      (i) =>
        i.authorityRaw === "De Nederlandsche Bank (DNB)" ||
        i.authorityRaw === "De Nederlansche Bank (DNB)"
    );
    expect(dutch.length).toBeGreaterThan(0);
    dutch.forEach((i) => expect(i.authorityCode).toBe("NL-DNB"));
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — idempotency", () => {
  it("two runs with the same input produce byte-identical JSON", () => {
    const r1 = getResult();
    const r2 = getResult();
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

// ---------------------------------------------------------------------------
// New fields: wpOfferDate, wpLastUpdate, exemptions, entityType
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — new whitepaper fields", () => {
  const ALLUNITY_LEI = "3912007G8L8CD3HFIV26";

  it("AllUnity EURAU wpOfferDate is 2025-06-20", () => {
    const { whitepapers } = getResult();
    const eurau = whitepapers.find((w) => w.lei === ALLUNITY_LEI && w.tickerHint === "EURAU");
    expect(eurau!.wpOfferDate).toBe("2025-06-20");
  });

  it("AllUnity EURAU wpLastUpdate is 2026-02-13", () => {
    const { whitepapers } = getResult();
    const eurau = whitepapers.find((w) => w.lei === ALLUNITY_LEI && w.tickerHint === "EURAU");
    expect(eurau!.wpLastUpdate).toBe("2026-02-13");
  });

  it("wpLastUpdate is null when wp_lastupdate is empty (AllUnity SEKAU)", () => {
    const { whitepapers } = getResult();
    const sekau = whitepapers.find((w) => w.lei === ALLUNITY_LEI && w.tickerHint === "SEKAU");
    expect(sekau!.wpLastUpdate).toBeNull();
  });
});

describe("normalizeEmtwp — new issuer fields", () => {
  const PAYMENTCORP_LEI = "315700IJDQF91J9C8B68";
  const ALLUNITY_LEI = "3912007G8L8CD3HFIV26";
  const AIEU_LEI = "254900VUR90QF0G3T387";

  it("Payment Corp exemption48_4 and exemption48_5 are true (YES)", () => {
    const { issuers } = getResult();
    const pc = issuers.find((i) => i.lei === PAYMENTCORP_LEI);
    expect(pc!.exemption48_4).toBe(true);
    expect(pc!.exemption48_5).toBe(true);
  });

  it("AllUnity exemption48_4 and exemption48_5 are false (No)", () => {
    const { issuers } = getResult();
    const au = issuers.find((i) => i.lei === ALLUNITY_LEI);
    expect(au!.exemption48_4).toBe(false);
    expect(au!.exemption48_5).toBe(false);
  });

  it("Payment Corp entityType is set", () => {
    const { issuers } = getResult();
    const pc = issuers.find((i) => i.lei === PAYMENTCORP_LEI);
    expect(pc!.entityType).toBeTruthy();
  });

  it("AIEU whitepapers with ac_authorisationEndDate=n/a are flagged date_placeholder", () => {
    const { whitepapers } = getResult();
    const aieu = whitepapers.filter((w) => w.lei === AIEU_LEI);
    // All AIEU rows have ac_authorisationEndDate = "n/a"
    aieu.forEach((w) => expect(w.quality).toContain("date_placeholder"));
  });
});

// ---------------------------------------------------------------------------
// wpKey stability — content-based, not position-based
// ---------------------------------------------------------------------------

describe("normalizeEmtwp — wpKey stability", () => {
  const ALLUNITY_LEI = "3912007G8L8CD3HFIV26";

  it("reordering rows does not change any wpKey", () => {
    const rows = parseResult.rows;
    const target = rows.find((r) => r.fields["ae_lei"] === ALLUNITY_LEI)!;
    const reordered = [...rows.filter((r) => r !== target), target];
    const reorderedResult = normalizeEmtwp(
      { rows: reordered, artNonEmpty: false },
      snapshot,
      DATE,
      NOW
    );
    const originalKeys = getResult()
      .whitepapers.map((w) => w.wpKey)
      .sort();
    const reorderedKeys = reorderedResult.whitepapers.map((w) => w.wpKey).sort();
    expect(reorderedKeys).toEqual(originalKeys);
  });

  it("changing wp_comments on one row changes only that row's wpKey", () => {
    const rows = parseResult.rows;
    const target = rows.find(
      (r) => r.fields["ae_lei"] === ALLUNITY_LEI && r.fields["wp_comments"] === "EURAU"
    )!;
    const modified = rows.map((r) =>
      r === target ? { ...r, fields: { ...r.fields, wp_comments: "MODIFIED" } } : r
    );
    const originalResult = getResult();
    const modifiedResult = normalizeEmtwp(
      { rows: modified, artNonEmpty: false },
      snapshot,
      DATE,
      NOW
    );

    const originalKeys = new Set(originalResult.whitepapers.map((w) => w.wpKey));
    const modifiedKeys = new Set(modifiedResult.whitepapers.map((w) => w.wpKey));

    const added = [...modifiedKeys].filter((k) => !originalKeys.has(k));
    const removed = [...originalKeys].filter((k) => !modifiedKeys.has(k));
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(1);
  });
});
