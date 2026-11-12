import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDnbEvidence,
  buildEbaEvidence,
  deriveL2Signals,
  isCreditInstitution,
  matchDnb,
  matchEba,
  normalizeId,
  summarizeL2,
} from "../../src/checks/l2.js";
import type { IdentityKeys } from "../../src/checks/l2.js";
import { parseEsmaCsv } from "../../src/esma/parse.js";
import { computeSha256 } from "../../src/esma/store.js";
import { EvidenceSchema, SignalSchema } from "../../src/model/index.js";
import type { Issuer, SourceSnapshot } from "../../src/model/index.js";
import { normalizeEmtwp } from "../../src/normalize/index.js";
import { parseDnbCsv } from "../../src/sources/dnb.js";
import type { DnbRecord } from "../../src/sources/dnb.js";
import { parseEbaRegister, readEbaZip } from "../../src/sources/eba.js";
import { parseGleifResponse } from "../../src/sources/gleif.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const ebaRecords = parseEbaRegister(
  readEbaZip(readFileSync(join(FIXTURES, "eba", "download-PSDMD-202611120800.zip")))
).map((e) => e.record);
const dnbRecords = parseDnbCsv(
  readFileSync(join(FIXTURES, "dnb", "Internetregister-WFTEG_2026-11-12.csv"))
).map((r) => r.record);
const gleif = new Map(
  parseGleifResponse(readFileSync(join(FIXTURES, "gleif", "2026-11-11.json"))).map((r) => [
    r.lei,
    r,
  ])
);

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
const issuers = normalizeEmtwp(esmaParse, esmaSnapshot, "2026-11-11", new Date()).issuers;
const issuer = (lei: string): Issuer => issuers.find((i) => i.lei === lei)!;

const ebaSnapshot = {
  sourceUrl:
    "https://euclid.eba.europa.eu/register/downloads/PSDMD/20261112/download-PSDMD-202611120800.zip",
  retrievedAt: "2026-11-12T09:00:00.000Z",
  contentSha256: "a".repeat(64),
};
const dnbSnapshot = {
  sourceUrl: "https://www.dnb.nl/en-GB/registerdownload/csv/WFTEG",
  retrievedAt: "2026-11-12T07:00:00.000Z",
  contentSha256: "b".repeat(64),
};

function keysFor(lei: string, extra: Partial<IdentityKeys> = {}): IdentityKeys {
  return {
    registeredAs: gleif.get(lei)?.registeredAs ?? null,
    dnbRelationNumbers: dnbRecords
      .filter((r) => r.lei === lei && r.registrationType === "Vergunning")
      .map((r) => r.relationNumber),
    manual: [],
    previousEntityCode: null,
    ...extra,
  };
}

const MONERIUM = "2549003QDNZWASSSCY31";
const PAXOS = "743700KYSSTKZYGEUF50";
const BLUE_EMI = "254900XFMACGD0L7AI73";
const APLAUZ = "72450039GAIN4MNI4V12";
const PAYMENT_CORP = "315700IJDQF91J9C8B68";
const BRIDGE = "254900MVWQXMF77YZP65";
const CACEIS = "96950023SCR9X9F3L662";

describe("normalizeId", () => {
  it("compares IDs by letters and digits only", () => {
    expect(normalizeId("3236886-2")).toBe("32368862");
    expect(normalizeId("C 109060")).toBe("C109060");
  });
});

describe("matchEba", () => {
  it("matches by LEI when the EBA uses it as entity code (Monerium, not Monerium EMI)", () => {
    const m = matchEba(issuer(MONERIUM), keysFor(MONERIUM), ebaRecords);
    expect(m).toMatchObject({ kind: "found", matchedBy: "lei" });
    expect(m.kind === "found" && m.record.entityCode).toBe(MONERIUM);
  });

  it("matches by the GLEIF registration number, ignoring punctuation (Paxos)", () => {
    const m = matchEba(issuer(PAXOS), keysFor(PAXOS), ebaRecords);
    expect(m).toMatchObject({ kind: "found", matchedBy: "national_id", nationalId: "32368862" });
  });

  it("matches the company code used as entity code (Lithuania)", () => {
    const m = matchEba(issuer(BLUE_EMI), keysFor(BLUE_EMI), ebaRecords);
    expect(m.kind === "found" && m.record.entityCode).toBe("305682465");
  });

  it("matches NL issuers through their DNB relation number", () => {
    const m = matchEba(issuer(APLAUZ), keysFor(APLAUZ), ebaRecords);
    expect(m.kind === "found" && m.record.entityCode).toBe("NL_DNB!R180692");
  });

  it("never matches by name: no reliable ID leaves the issuer unmatched", () => {
    expect(matchEba(issuer(BRIDGE), keysFor(BRIDGE), ebaRecords)).toEqual({
      kind: "unmatched",
      reason: "national_id_missing",
    });
  });

  it("uses a hand-checked national ID with its competent authority", () => {
    const keys = keysFor(BRIDGE, { manual: [{ caOwnerId: "LU_CSSF", nationalId: "W00000024" }] });
    const m = matchEba(issuer(BRIDGE), keys, ebaRecords);
    expect(m.kind === "found" && m.record.entityCode).toBe("LU_CSSF!W00000024");
    const wrongAuthority = keysFor(BRIDGE, {
      manual: [{ caOwnerId: "DE_BAFIN", nationalId: "W00000024" }],
    });
    expect(matchEba(issuer(BRIDGE), wrongAuthority, ebaRecords)).toEqual({
      kind: "not_found",
      nationalId: "W00000024",
    });
  });

  it("reports ambiguity instead of picking one of several matches", () => {
    const keys = keysFor(BRIDGE, {
      manual: [
        { caOwnerId: "LU_CSSF", nationalId: "W00000024" },
        { caOwnerId: "LU_CSSF", nationalId: "W00000009" },
      ],
    });
    expect(matchEba(issuer(BRIDGE), keys, ebaRecords)).toEqual({
      kind: "unmatched",
      reason: "ambiguous_match",
    });
  });

  it("reports not_found when a previously matched entity disappears", () => {
    const keys = keysFor(PAXOS, { previousEntityCode: "FI_FIN_FSA!00000000" });
    expect(matchEba(issuer(PAXOS), keys, ebaRecords)).toEqual({
      kind: "not_found",
      nationalId: null,
    });
  });
});

describe("EBA evidence and signals", () => {
  it("confirmed: authorised e-money institution, authorisation date kept in observed", () => {
    const m = matchEba(issuer(APLAUZ), keysFor(APLAUZ), ebaRecords);
    if (m.kind === "unmatched") throw new Error("unmatched");
    const ev = EvidenceSchema.parse(buildEbaEvidence(APLAUZ, m, ebaSnapshot));
    expect(ev).toMatchObject({
      check: "L2",
      sourceType: "eba_register",
      method: "download",
      matchedBy: "national_id",
      nationalId: "R180692",
      result: "confirmed",
    });
    expect(ev.observed["ENT_AUT"]).toBe("2023-02-15");
    expect(deriveL2Signals(ev)).toEqual([]);
  });

  it("inactive: withdrawn entity raises nca_licence_withdrawn", () => {
    const withdrawn = ebaRecords.find((r) => r.entityCode === "NL_DNB!R182875")!;
    const ev = buildEbaEvidence(
      APLAUZ,
      {
        kind: "found",
        record: withdrawn,
        matchedBy: "national_id",
        nationalId: withdrawn.nationalId,
      },
      ebaSnapshot
    );
    expect(ev.result).toBe("inactive");
    const [signal] = deriveL2Signals(ev);
    expect(SignalSchema.parse(signal)).toMatchObject({
      kind: "nca_licence_withdrawn",
      severity: "critical",
      observed: { ENT_AUT: "2022-07-29, 2026-05-21" },
    });
  });

  it("not_licensed: an exempt EMI is registered, not licensed (Payment Corporation)", () => {
    const m = matchEba(issuer(PAYMENT_CORP), keysFor(PAYMENT_CORP), ebaRecords);
    if (m.kind === "unmatched") throw new Error("unmatched");
    expect(buildEbaEvidence(PAYMENT_CORP, m, ebaSnapshot)).toMatchObject({
      result: "not_licensed",
      observed: { EntityType: "PSD_EEMI" },
    });
  });

  it("not_found: empty observation", () => {
    const ev = buildEbaEvidence(PAXOS, { kind: "not_found", nationalId: null }, ebaSnapshot);
    expect(EvidenceSchema.parse(ev)).toMatchObject({ result: "not_found", observed: {} });
  });
});

describe("DNB evidence and signals", () => {
  const licence = matchDnb(APLAUZ, dnbRecords)!;

  it("confirmed: active licence (Vergunning), matched by LEI", () => {
    expect(licence.registrationType).toBe("Vergunning");
    const ev = EvidenceSchema.parse(buildDnbEvidence(APLAUZ, licence, dnbSnapshot));
    expect(ev).toMatchObject({
      sourceType: "nca_register",
      matchedBy: "lei",
      nationalId: "R180692",
      result: "confirmed",
      observed: { Begindatum: "2023-01-27", Einddatum: null },
    });
  });

  it("ignores incoming passports: only the licence counts", () => {
    expect(matchDnb(MONERIUM, dnbRecords)).toBeUndefined();
  });

  it("not_found: no licence for the LEI", () => {
    expect(buildDnbEvidence(MONERIUM, undefined, dnbSnapshot).result).toBe("not_found");
  });

  it("inactive with an end date: nca_licence_withdrawn", () => {
    // DNB removes withdrawn entities instead of dating them, so this case is a variant of a real row.
    const ended: DnbRecord = { ...licence, endDate: "2026-11-01" };
    const ev = buildDnbEvidence(APLAUZ, ended, dnbSnapshot);
    expect(ev.result).toBe("inactive");
    expect(deriveL2Signals(ev)).toMatchObject([
      { kind: "nca_licence_withdrawn", observed: { Einddatum: "2026-11-01" } },
    ]);
  });

  it("inactive in liquidation: nca_licence_inactive", () => {
    const liquidation: DnbRecord = {
      ...licence,
      inLiquidation: true,
      liquidationDate: "2026-11-05",
    };
    const ev = buildDnbEvidence(APLAUZ, liquidation, dnbSnapshot);
    expect(deriveL2Signals(ev)).toMatchObject([
      {
        kind: "nca_licence_inactive",
        observed: { Inliquidatie: "Ja", DatumInLiquidatie: "2026-11-05" },
      },
    ]);
  });

  it("a future end date is still active", () => {
    expect(
      buildDnbEvidence(APLAUZ, { ...licence, endDate: "2027-01-01" }, dnbSnapshot).result
    ).toBe("confirmed");
  });
});

describe("summarizeL2", () => {
  const ev = (result: "confirmed" | "inactive" | "not_found") => ({
    ...buildDnbEvidence(APLAUZ, licence(), dnbSnapshot),
    result,
  });
  function licence() {
    return matchDnb(APLAUZ, dnbRecords)!;
  }

  it("one official confirmation is enough, even if another source says inactive", () => {
    const both = [ev("confirmed"), ev("inactive")];
    expect(summarizeL2(both, null)).toEqual({ result: "confirmed", reason: null, note: null });
    expect(both.flatMap(deriveL2Signals)).toHaveLength(1);
  });

  it("not_checked with the reason when there is no evidence", () => {
    expect(summarizeL2([], "national_id_missing")).toEqual({
      result: "not_checked",
      reason: "national_id_missing",
      note: null,
    });
  });

  it("an exempt institution is not_licensed with a fixed neutral note", () => {
    const exempt = { ...ev("confirmed"), result: "not_licensed" as const };
    expect(summarizeL2([exempt], null)).toEqual({
      result: "not_licensed",
      reason: "exempt_institution",
      note: "Registered as an exempt e-money institution in the EBA PSD2 register; not counted as a licence (L2)",
    });
    expect(summarizeL2([exempt, ev("confirmed")], null).result).toBe("confirmed");
  });

  it("banks: no automated official source", () => {
    expect(isCreditInstitution(issuer(CACEIS))).toBe(true);
    expect(isCreditInstitution(issuer(APLAUZ))).toBe(false);
    expect(summarizeL2([], "no_automated_official_source").reason).toBe(
      "no_automated_official_source"
    );
  });
});
