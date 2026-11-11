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
  stripLegalForms,
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

const esmaBuf = readFileSync(join(FIXTURES, "esma", "EMTWP_2026-11-11.csv"));
const esmaParse = parseEsmaCsv(esmaBuf, "EMTWP");
const esmaSnapshot: SourceSnapshot = {
  url: "https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv",
  fetchedAt: "2026-11-11T14:19:31.574Z",
  sha256: computeSha256(esmaBuf),
  sizeBytes: esmaBuf.length,
  rowCount: esmaParse.rows.length,
  retrieval: "file",
};
const issuers = normalizeEmtwp(
  esmaParse,
  esmaSnapshot,
  "2026-11-11",
  new Date("2026-11-11T14:19:31.574Z")
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
const NEWRAILS = "875500AX7AO0XVYSQD64";

describe("L1 with the real GLEIF fixture", () => {
  it("Eurodollar ApS: lapsed LEI is inactive with a lei_lapsed warning", () => {
    const ev = evidenceFor(EURODOLLAR);
    expect(ev.result).toBe("inactive");
    expect(deriveGleifSignals(ev)).toEqual([
      expect.objectContaining({
        kind: "lei_lapsed",
        severity: "warning",
        observed: { "registration.status": "LAPSED" },
      }),
    ]);
  });

  it("Monerium: name_format between 'Monerium ehf' and 'Monerium hf.'", () => {
    const ev = evidenceFor(MONERIUM);
    expect(ev.result).toBe("confirmed");
    expect(deriveGleifDiscrepancies(issuer(MONERIUM), ev)).toEqual([
      expect.objectContaining({
        kind: "name_format",
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
    expect(deriveGleifSignals(ev).map((s) => [s.kind, s.severity, s.observed])).toEqual([
      ["lei_retired", "critical", { "registration.status": status }],
    ]);
  });

  it("entity.status other than ACTIVE → lei_retired", () => {
    const ev = buildL1Evidence(STABLR, { ...ISSUED, entityStatus: "INACTIVE" }, snapshot);
    expect(deriveGleifSignals(ev).map((s) => [s.kind, s.observed])).toEqual([
      ["lei_retired", { "entity.status": "INACTIVE" }],
    ]);
  });

  it("Newrails/Ambr (real fixture): one lei_retired signal with both causes", () => {
    expect(deriveGleifSignals(evidenceFor(NEWRAILS))).toEqual([
      expect.objectContaining({
        kind: "lei_retired",
        severity: "critical",
        observed: { "registration.status": "DUPLICATE", "entity.status": "NULL" },
      }),
    ]);
  });

  it("no signals when not found", () => {
    expect(deriveGleifSignals(buildL1Evidence(STABLR, undefined, snapshot))).toEqual([]);
  });
});

describe("normalizeName and discrepancies", () => {
  it("normalises case, accents, whitespace and punctuation only", () => {
    expect(normalizeName("Quantoz Payments B.V")).toBe(normalizeName("QUANTOZ PAYMENTS B.V."));
    expect(normalizeName("Société Générale - Forge")).toBe(
      normalizeName("SOCIETE GENERALE - FORGE")
    );
    expect(normalizeName("Monerium ehf")).not.toBe(normalizeName("Monerium hf."));
    expect(normalizeName("StablR Ltd")).not.toBe(normalizeName("StablR Limited"));
  });

  it("strips only the closed list of legal forms, as whole words", () => {
    expect(stripLegalForms("BILLON sp. z o.o.")).toBe("BILLON");
    expect(stripLegalForms("UAB BLUE EMI LT")).toBe("BLUE EMI LT");
    expect(stripLegalForms("SEABANK SA")).toBe("SEABANK");
    expect(stripLegalForms("StablR Limited")).toBe("STABLR LIMITED");
  });

  it.each([
    [MONERIUM, "Monerium ehf", "Monerium hf."],
    ["254900VUR90QF0G3T387", "AIEU Services Limited S.A.", "AIEU Services Limited"],
    ["96950023SCR9X9F3L662", "CACEIS BANK SA", "CACEIS BANK"],
    ["724500GVWT7QULV8CR59", "Fiat Republic Netherlands", "Fiat Republic Netherlands B.V."],
  ])("%s → name_format (%s / %s)", (lei, esma, gleif) => {
    expect(deriveGleifDiscrepancies(issuer(lei), evidenceFor(lei))).toEqual([
      expect.objectContaining({ kind: "name_format", esmaValue: esma, otherValue: gleif }),
    ]);
  });

  it.each([NEWRAILS, "984500DB91E5A48E7F26", "2594008EL5UN8RIA8P23", "48510062OP64BYKPNO22"])(
    "%s → name_mismatch",
    (lei) => {
      expect(deriveGleifDiscrepancies(issuer(lei), evidenceFor(lei)).map((d) => d.kind)).toEqual([
        "name_mismatch",
      ]);
    }
  );

  it("no name discrepancy for Qivalis (displayName) or Société Générale (accents)", () => {
    for (const lei of ["724500LOOWQMIDXTS391", "969500FX8K40ZDW4F377"]) {
      expect(deriveGleifDiscrepancies(issuer(lei), evidenceFor(lei))).toEqual([]);
    }
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
