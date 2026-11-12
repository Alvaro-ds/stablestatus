import { z } from "zod";

import { computeSha256 } from "../esma/store.js";
import { readZipEntries } from "../lib/zip.js";
import { storeExtract, sortedRecordsSha256 } from "./extract-store.js";
import type { SourceExtract } from "./extract-store.js";
import { fetchBytes } from "./http.js";
import type { HttpOptions } from "./http.js";

/** Small JSON that names the latest daily ZIP of the EBA Register under PSD2 and its sha256. */
export const EBA_METADATA_URL = "https://euclid.eba.europa.eu/register/api/filemetadata";
const DOWNLOADS_PREFIX = "https://euclid.eba.europa.eu/register/downloads/PSDMD/";
const ZIP_PATH_RE = /^\d{8}\/download-PSDMD-\d{12}\.zip$/;
const ZIP_TIMEOUT_MS = 120_000;
export const EBA_EXTRACT_FILENAME = "eba-pir-extract.json";

/** Entity types kept from the register: e-money institutions, licensed and exempted. */
export const EBA_EMI_TYPES = new Set(["PSD_EMI", "PSD_EEMI"]);

// ---------------------------------------------------------------------------
// Schemas: only the fields we use
// ---------------------------------------------------------------------------

const MetadataSchema = z.object({
  latest_version_relative_zip_path: z.string().regex(ZIP_PATH_RE),
  sha256_hash: z.string().regex(/^[0-9a-f]{64}$/),
  golden_copy_path_context: z.literal(DOWNLOADS_PREFIX),
});

const TextSchema = z.union([z.string(), z.array(z.string()).min(1)]);
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const EntitySchema = z.object({
  CA_OwnerID: z.string().min(1),
  EntityCode: z.string().min(1),
  EntityType: z.string().min(1),
  Properties: z.array(z.record(z.string(), z.unknown())),
});

const PropertiesSchema = z.object({
  ENT_AUT: z.array(IsoDateSchema).min(1),
  ENT_NAT_REF_COD: z.string().optional(),
  ENT_NAM: TextSchema,
});

/** One e-money institution as listed by the EBA, with the fields used by the L2 checks. */
export interface EbaRecord {
  entityCode: string;
  entityType: string;
  caOwnerId: string;
  nationalId: string | null;
  name: string;
  /** "Authorised/Withdrawn" dates: they alternate, so an even count means withdrawn. */
  authDates: string[];
}

/** A parsed record together with the original entity object, kept for the stored extract. */
export interface EbaEntity {
  record: EbaRecord;
  raw: unknown;
}

export interface EbaFetchResult {
  url: string;
  retrievedAt: string;
  contentSha256: string;
  entities: EbaEntity[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Returns the ZIP URL and its published sha256. Rejects any host or path other than the EBA's. */
export function parseEbaMetadata(body: Buffer): { zipUrl: string; sha256: string } {
  const m = MetadataSchema.parse(JSON.parse(body.toString("utf8")));
  return {
    zipUrl: m.golden_copy_path_context + m.latest_version_relative_zip_path,
    sha256: m.sha256_hash,
  };
}

/** Extracts the register JSON from the ZIP and checks it against the .sha256 file shipped with it. */
export function readEbaZip(zip: Buffer): Buffer {
  const entries = readZipEntries(zip);
  const jsonName = [...entries.keys()].find((n) => /^download-PSDMD-\d{12}\.json$/.test(n));
  const json = jsonName ? entries.get(jsonName) : undefined;
  const expected = jsonName
    ? entries.get(`${jsonName}.sha256`)?.toString("utf8").trim()
    : undefined;
  if (!json || !expected)
    throw new Error("EBA ZIP does not contain the register JSON and its .sha256");
  if (computeSha256(json) !== expected)
    throw new Error("EBA register JSON does not match its .sha256");
  return json;
}

function text(value: string | string[]): string {
  return Array.isArray(value) ? value.join(" / ") : value;
}

/** Parses the register JSON (`[[disclaimer], [entities]]`) and keeps the e-money institutions. */
export function parseEbaRegister(json: Buffer): EbaEntity[] {
  const top = z
    .tuple([z.array(z.unknown()), z.array(z.unknown())])
    .parse(JSON.parse(json.toString("utf8")));
  const out: EbaEntity[] = [];
  for (const raw of top[1]) {
    const type = (raw as { EntityType?: unknown } | null)?.EntityType;
    if (typeof type !== "string" || !EBA_EMI_TYPES.has(type)) continue;
    const e = EntitySchema.parse(raw);
    const p = PropertiesSchema.parse(Object.assign({}, ...e.Properties));
    out.push({
      raw,
      record: {
        entityCode: e.EntityCode,
        entityType: e.EntityType,
        caOwnerId: e.CA_OwnerID,
        nationalId: p.ENT_NAT_REF_COD?.trim() || null,
        name: text(p.ENT_NAM).trim(),
        authDates: p.ENT_AUT,
      },
    });
  }
  if (out.length === 0) throw new Error("EBA register contains no e-money institutions");
  return out;
}

/** sha256 of the used fields of the given records, sorted by entity code. */
export function computeEbaRecordsSha256(records: EbaRecord[]): string {
  return sortedRecordsSha256(records, (r) => r.entityCode);
}

// ---------------------------------------------------------------------------
// Network and storage
// ---------------------------------------------------------------------------

/**
 * Downloads the EBA register once: the metadata JSON, then the daily ZIP. The ZIP must match
 * the sha256 published in the metadata. contentSha256 is the sha256 of the ZIP bytes.
 */
export async function fetchEbaRegister(
  options: HttpOptions & { now?: () => Date } = {}
): Promise<EbaFetchResult> {
  const isJson = (ct: string) => ct.includes("json");
  const meta = parseEbaMetadata(await fetchBytes(EBA_METADATA_URL, isJson, options));
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const zip = await fetchBytes(meta.zipUrl, (ct) => !ct.includes("html"), {
    timeoutMs: ZIP_TIMEOUT_MS,
    ...options,
  });
  const contentSha256 = computeSha256(zip);
  if (contentSha256 !== meta.sha256) {
    throw new Error(`EBA ZIP sha256 ${contentSha256} differs from the published ${meta.sha256}`);
  }
  return {
    url: meta.zipUrl,
    retrievedAt,
    contentSha256,
    entities: parseEbaRegister(readEbaZip(zip)),
  };
}

/** Stores the original entities of our issuers when their used fields changed. */
export function storeEbaExtract(
  result: EbaFetchResult,
  selected: EbaEntity[],
  rawDir: string,
  date: string
): boolean {
  const extract: SourceExtract = {
    sourceUrl: result.url,
    retrievedAt: result.retrievedAt,
    contentSha256: result.contentSha256,
    recordsSha256: computeEbaRecordsSha256(selected.map((e) => e.record)),
    records: [...selected]
      .sort((a, b) => a.record.entityCode.localeCompare(b.record.entityCode))
      .map((e) => e.raw),
  };
  return storeExtract(extract, rawDir, date, EBA_EXTRACT_FILENAME);
}
