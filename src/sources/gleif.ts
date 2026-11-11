import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { FetchError, HttpError } from "../esma/fetch.js";
import {
  FETCH_BASE_DELAY_MS,
  FETCH_MAX_ATTEMPTS,
  FETCH_TIMEOUT_MS,
  USER_AGENT,
} from "../esma/constants.js";
import { computeSha256 } from "../esma/store.js";
import { LeiSchema } from "../model/index.js";

export const GLEIF_API_URL = "https://api.gleif.org/api/v1/lei-records";
const MAX_PAGE_SIZE = 100;
const RAW_FILENAME = "gleif.json";
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Response schema: only the fields we use. Unknown fields are stripped.
// ---------------------------------------------------------------------------

const GleifResponseSchema = z.object({
  meta: z.object({ pagination: z.object({ total: z.number().int().min(0) }) }),
  data: z.array(
    z.object({
      attributes: z.object({
        lei: LeiSchema,
        entity: z.object({
          legalName: z.object({ name: z.string() }),
          legalAddress: z.object({ country: z.string().nullable() }),
          status: z.string().nullable(),
          registeredAs: z.string().nullable(),
        }),
        registration: z.object({
          status: z.string().min(1),
          nextRenewalDate: z.string().nullable(),
        }),
      }),
    })
  ),
});

/** Flattened GLEIF record with the fields used by the L1 checks, in a fixed key order. */
export interface GleifRecord {
  lei: string;
  legalName: string;
  country: string | null;
  entityStatus: string | null;
  registeredAs: string | null;
  registrationStatus: string;
  nextRenewalDate: string | null;
}

export interface GleifFetchResult {
  url: string;
  retrievedAt: string;
  body: Buffer;
  records: GleifRecord[];
  contentSha256: string;
  recordsSha256: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface GleifFetchOptions {
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Batch URL for up to 100 LEIs, sorted so the same set always yields the same URL. */
export function buildGleifUrl(leis: string[]): string {
  const unique = [...new Set(leis)].sort();
  if (unique.length === 0) throw new Error("buildGleifUrl: no LEIs given");
  if (unique.length > MAX_PAGE_SIZE) {
    throw new Error(`buildGleifUrl: ${unique.length} LEIs exceed one page of ${MAX_PAGE_SIZE}`);
  }
  for (const lei of unique) LeiSchema.parse(lei);
  return `${GLEIF_API_URL}?filter[lei]=${unique.join(",")}&page[size]=${MAX_PAGE_SIZE}`;
}

/** Public GLEIF search page for one LEI. */
export function gleifViewUrl(lei: string): string {
  return `https://search.gleif.org/#/record/${LeiSchema.parse(lei)}`;
}

/** Parses and validates a GLEIF lei-records response. Throws on schema or pagination errors. */
export function parseGleifResponse(body: Buffer): GleifRecord[] {
  const parsed = GleifResponseSchema.parse(JSON.parse(body.toString("utf8")));
  if (parsed.meta.pagination.total > parsed.data.length) {
    throw new Error(
      `GLEIF response is paginated: ${parsed.data.length} of ${parsed.meta.pagination.total} records`
    );
  }
  return parsed.data
    .map(({ attributes: a }) => ({
      lei: a.lei,
      legalName: a.entity.legalName.name,
      country: a.entity.legalAddress.country,
      entityStatus: a.entity.status,
      registeredAs: a.entity.registeredAs,
      registrationStatus: a.registration.status,
      nextRenewalDate: a.registration.nextRenewalDate,
    }))
    .sort((x, y) => x.lei.localeCompare(y.lei));
}

/** sha256 of the used fields only, sorted by LEI: stable across GLEIF metadata updates. */
export function computeRecordsSha256(records: GleifRecord[]): string {
  const sorted = [...records].sort((x, y) => x.lei.localeCompare(y.lei));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return !(err instanceof z.ZodError) && !(err instanceof SyntaxError);
}

async function attemptFetch(url: string, fetchFn: FetchFn, timeoutMs: number): Promise<Buffer> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.api+json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new HttpError(url, response.status);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new Error(`GLEIF returned unexpected content-type "${contentType}" for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetches GLEIF records for `leis` in one batch request, with the same retry policy as
 * the ESMA fetcher: network errors, timeouts, 5xx and 429 are retried with exponential backoff.
 */
export async function fetchGleifRecords(
  leis: string[],
  options: GleifFetchOptions = {}
): Promise<GleifFetchResult> {
  const url = buildGleifUrl(leis);
  const fetchFn = options.fetch ?? (globalThis.fetch as FetchFn);
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const delayMs = options.delayMs ?? FETCH_BASE_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? FETCH_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const retrievedAt = now().toISOString();
      const body = await attemptFetch(url, fetchFn, timeoutMs);
      const records = parseGleifResponse(body);
      return {
        url,
        retrievedAt,
        body,
        records,
        contentSha256: computeSha256(body),
        recordsSha256: computeRecordsSha256(records),
      };
    } catch (err) {
      if (!isRetryable(err)) throw err;
      lastError = err;
      if (attempt < maxAttempts - 1) await sleep(delayMs * 2 ** attempt);
    }
  }
  throw new FetchError(url, maxAttempts, lastError);
}

// ---------------------------------------------------------------------------
// Raw storage
// ---------------------------------------------------------------------------

function latestStoredRecordsSha256(rawDir: string): string | null {
  if (!existsSync(rawDir)) return null;
  const dirs = readdirSync(rawDir)
    .filter((d) => DATE_DIR_RE.test(d))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const path = join(rawDir, dir, RAW_FILENAME);
    if (existsSync(path)) return computeRecordsSha256(parseGleifResponse(readFileSync(path)));
  }
  return null;
}

/**
 * Writes the exact response bytes to `<rawDir>/<date>/gleif.json` only when the used
 * fields changed since the last stored copy. Returns true when a file was written.
 */
export function storeGleifRaw(
  body: Buffer,
  recordsSha256: string,
  rawDir: string,
  date: string
): boolean {
  if (!DATE_DIR_RE.test(date)) throw new Error(`Invalid date format for storage path: ${date}`);
  if (latestStoredRecordsSha256(rawDir) === recordsSha256) return false;
  const destDir = join(rawDir, date);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, RAW_FILENAME), body);
  return true;
}
