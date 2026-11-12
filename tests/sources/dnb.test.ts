import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeSha256 } from "../../src/esma/store.js";
import {
  DNB_CSV_URL,
  computeDnbRecordsSha256,
  dnbDate,
  fetchDnbRegister,
  parseDnbCsv,
  selectDnbRows,
  storeDnbExtract,
} from "../../src/sources/dnb.js";
import { UnexpectedContentError } from "../../src/sources/http.js";

const CSV = readFileSync(join(__dirname, "../fixtures/dnb/Internetregister-WFTEG_2026-11-12.csv"));
const APLAUZ = "72450039GAIN4MNI4V12";
const QIVALIS = "724500LOOWQMIDXTS391";
const noSleep = () => Promise.resolve();

describe("parseDnbCsv", () => {
  it("parses the real CSV (BOM, ';', CRLF) into records", () => {
    const rows = parseDnbCsv(CSV);
    const qivalis = rows.find((r) => r.record.lei === QIVALIS)?.record;
    expect(qivalis).toEqual({
      relationNumber: "R203793",
      name: "Qivalis B.V.",
      kvk: "98235680",
      lei: QIVALIS,
      registrationType: "Vergunning",
      startDate: "2026-10-13",
      endDate: null,
      inLiquidation: false,
      liquidationDate: null,
    });
  });

  it("fails if the header changes", () => {
    const text = CSV.toString("utf8").replace("Relatienummer", "RelatieNr");
    expect(() => parseDnbCsv(Buffer.from(text))).toThrow(/header/);
  });

  it("fails on an invalid value in a used field", () => {
    const text = CSV.toString("utf8").replace('"Nee"', '"Maybe"');
    expect(() => parseDnbCsv(Buffer.from(text))).toThrow();
  });

  it("converts dates", () => {
    expect(dnbDate("13-10-2026")).toBe("2026-10-13");
    expect(dnbDate("")).toBeNull();
  });
});

describe("selectDnbRows", () => {
  it("keeps our LEIs only and drops repeated per-activity rows", () => {
    const rows = parseDnbCsv(CSV);
    const selected = selectDnbRows(rows, [APLAUZ]);
    expect(rows.filter((r) => r.record.lei === APLAUZ).length).toBeGreaterThan(selected.length);
    expect(new Set(selected.map((r) => r.record.registrationType))).toEqual(
      new Set(["Vergunning", "Europees paspoort uitgaand"])
    );
    expect(selected.every((r) => !("ActiviteitBranche" in r.raw))).toBe(true);
  });
});

describe("fetchDnbRegister", () => {
  it("downloads the CSV once and hashes its bytes", async () => {
    const calls: string[] = [];
    const result = await fetchDnbRegister({
      fetch: async (url) => {
        calls.push(url);
        return new Response(new Uint8Array(CSV), { headers: { "content-type": "text/csv" } });
      },
      sleep: noSleep,
      now: () => new Date("2026-11-12T07:00:00Z"),
    });
    expect(calls).toEqual([DNB_CSV_URL]);
    expect(result.contentSha256).toBe(computeSha256(CSV));
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("rejects an HTML page without retrying", async () => {
    let n = 0;
    const fetch = async () => {
      n++;
      return new Response("<html>", { headers: { "content-type": "text/html" } });
    };
    await expect(fetchDnbRegister({ fetch, sleep: noSleep })).rejects.toBeInstanceOf(
      UnexpectedContentError
    );
    expect(n).toBe(1);
  });
});

describe("storeDnbExtract", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dnb-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes only when the selected records change", () => {
    const rows = parseDnbCsv(CSV);
    const result = {
      url: DNB_CSV_URL,
      retrievedAt: "2026-11-12T07:00:00.000Z",
      contentSha256: computeSha256(CSV),
      rows,
    };
    const selected = selectDnbRows(rows, [APLAUZ, QIVALIS]);

    expect(storeDnbExtract(result, selected, dir, "2026-11-12")).toBe(true);
    const stored = JSON.parse(
      readFileSync(join(dir, "2026-11-12", "dnb-wfteg-extract.json"), "utf8")
    );
    expect(stored.recordsSha256).toBe(computeDnbRecordsSha256(selected.map((r) => r.record)));

    expect(storeDnbExtract(result, [...selected].reverse(), dir, "2026-11-13")).toBe(false);
    expect(existsSync(join(dir, "2026-11-13"))).toBe(false);
    expect(storeDnbExtract(result, selectDnbRows(rows, [APLAUZ]), dir, "2026-11-14")).toBe(true);
  });
});
