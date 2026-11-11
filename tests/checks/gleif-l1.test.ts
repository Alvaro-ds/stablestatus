import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildL1Evidence,
  deriveGleifDiscrepancies,
  deriveGleifSignals,
  deriveIssuerChecks,
  l1Result,
  normalizeName,
} from "../../src/checks/gleif-l1.js";
import { parseEsmaCsv } from "../../src/esma/parse.js";
import { computeSha256 } from "../../src/esma/store.js";
import { EvidenceSchema, IssuerChecksSchema } from "../../src/model/index.js";
import type { Issuer, SourceSnapshot } from "../../src/model/index.js";
import { normalizeEmtwp } from "../../src/normalize/index.js";
import { buildGleifUrl, parseGleifResponse } from "../../src/sources/gleif.js";
import type { GleifRecord } from "../../src/sources/gleif.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const gleifBuf = readFileSync(join(FIXTURES, "gleif", "2026-11-11.json"));
const records = parseGleifResponse(gleifBuf);
const byLei = new Map(records.map((r) => [r.lei, r]));

const esmaBuf = readFileSync(join(FIXTURES, "esma", "EMTWP_2026-10-30.csv"));
const esmaParse = parseEsmaCsv(esmaBuf, "EMTWP");
const esmaSnapshot: SourceSnapshot = {
  url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  fetchedAt: "2026-10-30T05:00:00Z",
  sha256: computeSha256(esmaBuf),
  sizeBytes: esmaBuf.length,
  rowCount: esmaParse.rows.length,
  retrieval: "file",
};
const issuers = normalizeEmtwp(
  esmaParse,
  esmaSnapshot,
  "2026-11-07",
  new Date("2026-11-07T00:00:00Z")
).issuers;

const snapshot = {
  sourceUrl: buildGleifUrl(records.map((r) => r.lei)),
  retrievedAt: "2026-11-11T16:00:00.000Z",
  contentSha256: computeSha256(gleifBuf),
};

function issuer(lei: string): Issuer {
  const found = issuers.find((i) => i.lei === lei);
  if (!found) throw new Error(`issuer ${lei} not in ESMA fixture`);
  return found;
}

function evidenceFor(lei: string) {
  return buildL1Evidence(lei, byLei.get(lei), snapshot);
}

const EURODOLLAR = "8945001XWFMRUTCAK575";
const MONERIUM = "2549003QDNZWASSSCY31";
const STABLR = "984500AA0OCA9CE0D796";

describe("L1 with the real GLEIF fixture", () => {
  it("Eurodollar ApS: lapsed LEI is inactive with a lei_lapsed warning", () => {
    const ev = evidenceFor(EURODOLLAR);
    expect(ev.result).toBe("inactive");
    expect(deriveGleifSignals(ev)).toEqual([
      expect.objectContaining({
        kind: "lei_lapsed",
        severity: "warning",
        field: "registration.status",
        value: "LAPSED",
      }),
    ]);
  });

  it("Monerium: name_mismatch between 'Monerium ehf' and 'Monerium hf.'", () => {
    const ev = evidenceFor(MONERIUM);
    expect(ev.result).toBe("confirmed");
    expect(deriveGleifDiscrepancies(issuer(MONERIUM), ev)).toEqual([
      expect.objectContaining({
        kind: "name_mismatch",
        esmaValue: "Monerium ehf",
        otherValue: "Monerium hf.",
        otherSourceType: "gleif",
      }),
    ]);
  });

  it("StablR: L1 confirmed, no signals from GLEIF", () => {
    const ev = evidenceFor(STABLR);
    expect(ev.result).toBe("confirmed");
    expect(deriveGleifSignals(ev)).toEqual([]);
    expect(deriveIssuerChecks(issuer(STABLR), ev, snapshot.retrievedAt).levelReached).toBe("L1");
  });

  it("stores registeredAs as nationalId and matches by LEI", () => {
    const ev = evidenceFor(MONERIUM);
    expect(ev.nationalId).toBe("5505121060");
    expect(ev.matchedBy).toBe("lei");
    expect(ev.viewUrl).toBe(`https://search.gleif.org/#/record/${MONERIUM}`);
    expect(EvidenceSchema.safeParse(ev).success).toBe(true);
  });

  it("every ESMA issuer yields schema-valid checks", () => {
    for (const i of issuers) {
      const checks = deriveIssuerChecks(i, evidenceFor(i.lei), snapshot.retrievedAt);
      expect(IssuerChecksSchema.safeParse(checks).success).toBe(true);
    }
  });
});

const ISSUED: GleifRecord = {
  lei: "984500AA0OCA9CE0D796",
  legalName: "STABLR LTD.",
  country: "MT",
  entityStatus: "ACTIVE",
  registeredAs: "C 104007",
  registrationStatus: "ISSUED",
  nextRenewalDate: "2027-03-27T10:32:16Z",
};

describe("l1Result", () => {
  it("not_found when GLEIF does not return the LEI", () => {
    expect(l1Result(undefined)).toBe("not_found");
    expect(buildL1Evidence(STABLR, undefined, snapshot).observed["registration.status"]).toBeNull();
  });

  it("inactive unless ISSUED, ACTIVE and name and country recorded", () => {
    expect(l1Result(ISSUED)).toBe("confirmed");
    expect(l1Result({ ...ISSUED, entityStatus: "INACTIVE" })).toBe("inactive");
    expect(l1Result({ ...ISSUED, registrationStatus: "PENDING_TRANSFER" })).toBe("inactive");
    expect(l1Result({ ...ISSUED, country: null })).toBe("inactive");
    expect(l1Result({ ...ISSUED, legalName: " " })).toBe("inactive");
  });
});

describe("deriveGleifSignals", () => {
  it.each(["RETIRED", "ANNULLED", "DUPLICATE", "MERGED"])("%s → lei_retired", (status) => {
    const ev = buildL1Evidence(STABLR, { ...ISSUED, registrationStatus: status }, snapshot);
    expect(deriveGleifSignals(ev).map((s) => [s.kind, s.severity, s.field])).toEqual([
      ["lei_retired", "critical", "registration.status"],
    ]);
  });

  it("entity.status other than ACTIVE → lei_retired", () => {
    const ev = buildL1Evidence(STABLR, { ...ISSUED, entityStatus: "INACTIVE" }, snapshot);
    expect(deriveGleifSignals(ev).map((s) => [s.kind, s.field, s.value])).toEqual([
      ["lei_retired", "entity.status", "INACTIVE"],
    ]);
  });

  it("no signals when not found", () => {
    expect(deriveGleifSignals(buildL1Evidence(STABLR, undefined, snapshot))).toEqual([]);
  });
});

describe("normalizeName and discrepancies", () => {
  it("normalises only case, whitespace and punctuation", () => {
    expect(normalizeName("Quantoz Payments B.V")).toBe(normalizeName("QUANTOZ PAYMENTS B.V."));
    expect(normalizeName("Monerium ehf")).not.toBe(normalizeName("Monerium hf."));
    expect(normalizeName("StablR Ltd")).not.toBe(normalizeName("StablR Limited"));
  });

  it("country_mismatch unless ESMA country is empty", () => {
    const ev = buildL1Evidence(
      STABLR,
      { ...ISSUED, legalName: "StablR Ltd", country: "IE" },
      snapshot
    );
    const base = issuer(STABLR);
    expect(deriveGleifDiscrepancies(base, ev).map((d) => d.kind)).toEqual(["country_mismatch"]);
    expect(deriveGleifDiscrepancies({ ...base, countryCode: null }, ev)).toEqual([]);
  });
});
