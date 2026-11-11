import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchError, HttpError } from "../../src/esma/fetch.js";
import { computeSha256 } from "../../src/esma/store.js";
import {
  buildGleifUrl,
  computeRecordsSha256,
  fetchGleifRecords,
  gleifViewUrl,
  parseGleifResponse,
  storeGleifRaw,
} from "../../src/sources/gleif.js";

const FIXTURE = readFileSync(join(__dirname, "../fixtures/gleif/2026-11-11.json"));
const LEIS = parseGleifResponse(FIXTURE).map((r) => r.lei);

function jsonResponse(body: Buffer | string, status = 200) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    status,
    headers: { "content-type": "application/vnd.api+json" },
  });
}

const noSleep = () => Promise.resolve();

describe("buildGleifUrl", () => {
  it("sorts and dedupes LEIs into one batch URL", () => {
    expect(
      buildGleifUrl(["984500AA0OCA9CE0D796", "2549003QDNZWASSSCY31", "2549003QDNZWASSSCY31"])
    ).toBe(
      "https://api.gleif.org/api/v1/lei-records?filter[lei]=2549003QDNZWASSSCY31,984500AA0OCA9CE0D796&page[size]=100"
    );
  });

  it("rejects malformed LEIs and more than one page", () => {
    expect(() => buildGleifUrl(["bad&lei"])).toThrow();
    expect(() => buildGleifUrl([])).toThrow();
    const many = Array.from({ length: 101 }, (_, i) => `${String(i).padStart(18, "0")}00`);
    expect(() => buildGleifUrl(many)).toThrow(/exceed/);
  });
});

describe("gleifViewUrl", () => {
  it("builds the public search page URL", () => {
    expect(gleifViewUrl("2549003QDNZWASSSCY31")).toBe(
      "https://search.gleif.org/#/record/2549003QDNZWASSSCY31"
    );
  });
});

describe("parseGleifResponse with the real fixture", () => {
  it("returns one flattened record per LEI, sorted", () => {
    const records = parseGleifResponse(FIXTURE);
    expect(records).toHaveLength(26);
    expect(records.map((r) => r.lei)).toEqual([...records.map((r) => r.lei)].sort());
    expect(records.find((r) => r.lei === "8945001XWFMRUTCAK575")).toEqual({
      lei: "8945001XWFMRUTCAK575",
      legalName: "Eurodollar ApS",
      country: "DK",
      entityStatus: "ACTIVE",
      registeredAs: "39729482",
      registrationStatus: "LAPSED",
      nextRenewalDate: "2026-10-31T23:00:00Z",
    });
  });

  it("fails when a used field is missing", () => {
    const json = JSON.parse(FIXTURE.toString("utf8"));
    delete json.data[0].attributes.registration.status;
    expect(() => parseGleifResponse(Buffer.from(JSON.stringify(json)))).toThrow();
  });

  it("fails when the response is paginated", () => {
    const json = JSON.parse(FIXTURE.toString("utf8"));
    json.meta.pagination.total = 200;
    expect(() => parseGleifResponse(Buffer.from(JSON.stringify(json)))).toThrow(/paginated/);
  });
});

describe("computeRecordsSha256", () => {
  it("ignores meta and record order", () => {
    const json = JSON.parse(FIXTURE.toString("utf8"));
    json.meta.goldenCopy.publishDate = "2026-11-11T16:00:00Z";
    json.data.reverse();
    const other = parseGleifResponse(Buffer.from(JSON.stringify(json)));
    expect(computeRecordsSha256(other)).toBe(computeRecordsSha256(parseGleifResponse(FIXTURE)));
  });

  it("changes when a used field changes", () => {
    const json = JSON.parse(FIXTURE.toString("utf8"));
    json.data[0].attributes.registration.status = "RETIRED";
    const other = parseGleifResponse(Buffer.from(JSON.stringify(json)));
    expect(computeRecordsSha256(other)).not.toBe(computeRecordsSha256(parseGleifResponse(FIXTURE)));
  });
});

describe("fetchGleifRecords", () => {
  it("sends one request with JSON:API Accept header and hashes the exact bytes", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(FIXTURE));
    const result = await fetchGleifRecords(LEIS, { fetch, sleep: noSleep });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(buildGleifUrl(LEIS));
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/vnd.api+json");
    expect(headers["User-Agent"]).not.toMatch(/@/);
    expect(result.contentSha256).toBe(computeSha256(FIXTURE));
    expect(result.records).toHaveLength(26);
  });

  it("retries 5xx with exponential backoff", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse("", 503))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(jsonResponse(FIXTURE));
    await fetchGleifRecords(LEIS, { fetch, sleep, delayMs: 10 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it("throws FetchError after the last attempt", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse("", 500));
    await expect(fetchGleifRecords(LEIS, { fetch, sleep: noSleep })).rejects.toBeInstanceOf(
      FetchError
    );
  });

  it("does not retry 4xx or invalid bodies", async () => {
    const fetch404 = vi.fn().mockResolvedValue(jsonResponse("", 404));
    await expect(
      fetchGleifRecords(LEIS, { fetch: fetch404, sleep: noSleep })
    ).rejects.toBeInstanceOf(HttpError);
    expect(fetch404).toHaveBeenCalledTimes(1);

    const fetchBad = vi.fn().mockResolvedValue(jsonResponse('{"data":[]}'));
    await expect(fetchGleifRecords(LEIS, { fetch: fetchBad, sleep: noSleep })).rejects.toThrow();
    expect(fetchBad).toHaveBeenCalledTimes(1);
  });
});

describe("storeGleifRaw", () => {
  let rawDir: string;
  beforeEach(() => {
    rawDir = mkdtempSync(join(tmpdir(), "stablestatus-gleif-"));
  });
  afterEach(() => rmSync(rawDir, { recursive: true, force: true }));

  it("stores only when the records hash changes", () => {
    const sha = computeRecordsSha256(parseGleifResponse(FIXTURE));
    expect(storeGleifRaw(FIXTURE, sha, rawDir, "2026-11-11")).toBe(true);
    expect(readFileSync(join(rawDir, "2026-11-11", "gleif.json")).equals(FIXTURE)).toBe(true);

    const json = JSON.parse(FIXTURE.toString("utf8"));
    json.meta.goldenCopy.publishDate = "2026-11-12T08:00:00Z";
    const sameRecords = Buffer.from(JSON.stringify(json));
    expect(storeGleifRaw(sameRecords, sha, rawDir, "2026-11-12")).toBe(false);
    expect(existsSync(join(rawDir, "2026-11-12"))).toBe(false);

    expect(storeGleifRaw(sameRecords, "b".repeat(64), rawDir, "2026-11-13")).toBe(true);
  });

  it("rejects unsafe dates", () => {
    expect(() => storeGleifRaw(FIXTURE, "a".repeat(64), rawDir, "../x")).toThrow();
  });
});
