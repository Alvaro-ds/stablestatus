import { parse } from "csv-parse/sync";
import { z } from "zod";

import { computeSha256 } from "../esma/store.js";
import { storeExtract, sortedRecordsSha256 } from "./extract-store.js";
import type { SourceExtract } from "./extract-store.js";
import { fetchBytes } from "./http.js";
import type { HttpOptions } from "./http.js";

/** DNB public register, e-money institutions (WFTEG). Updated on working days at 06:00. */
export const DNB_CSV_URL = "https://www.dnb.nl/en-GB/registerdownload/csv/WFTEG";
export const DNB_EXTRACT_FILENAME = "dnb-wfteg-extract.json";

export const DNB_COLUMNS = [
  "Deelregister",
  "Relatienummer",
  "StatutaireNaam",
  "StatutairLand",
  "StatutairePlaats",
  "Inliquidatie",
  "DatumInLiquidatie",
  "Handelsnaam",
  "AdresVestiging",
  "PostcodeVestiging",
  "PlaatsVestiging",
  "LandVestiging",
  "LandCodeVestiging",
  "Postadres",
  "PlaatsPostadres",
  "LandPostadres",
  "LandCodePostadres",
  "KvK",
  "RSIN",
  "LEI",
  "RegistratieType",
  "Wetsartikel",
  "Begindatum",
  "Einddatum",
  "ActiviteitBranche",
  "BegindatumActiviteit",
  "EinddatumActiviteit",
  "Onherroepelijkheidsdatum",
  "GerelateerdRelatienummer",
  "GerelateerdStatutaireNaam",
  "Land",
  "LandCode",
  "APFRelatienummer",
  "APFStatutaireNaam",
  "Afwikkeldatum",
] as const;

/** Per-activity columns: dropped from the stored extract, where they only repeat each licence. */
const ACTIVITY_COLUMNS = new Set([
  "ActiviteitBranche",
  "BegindatumActiviteit",
  "EinddatumActiviteit",
]);

const DateSchema = z.union([z.literal(""), z.string().regex(/^\d{2}-\d{2}-\d{4}$/)]);

const RowSchema = z.object({
  Relatienummer: z.string().min(1),
  StatutaireNaam: z.string().min(1),
  Inliquidatie: z.enum(["Ja", "Nee"]),
  DatumInLiquidatie: DateSchema,
  KvK: z.string(),
  LEI: z.string(),
  RegistratieType: z.string().min(1),
  Begindatum: DateSchema,
  Einddatum: DateSchema,
});

/** One registration of one relation, with the fields used by the L2 checks. */
export interface DnbRecord {
  relationNumber: string;
  name: string;
  kvk: string | null;
  lei: string | null;
  /** e.g. "Vergunning" (licence) or "Europees paspoort inkomend" (incoming passport). */
  registrationType: string;
  startDate: string | null;
  endDate: string | null;
  inLiquidation: boolean;
  liquidationDate: string | null;
}

export interface DnbRow {
  record: DnbRecord;
  raw: Record<string, string>;
}

export interface DnbFetchResult {
  url: string;
  retrievedAt: string;
  contentSha256: string;
  rows: DnbRow[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** "dd-mm-yyyy" → "yyyy-mm-dd"; "" → null. */
export function dnbDate(value: string): string | null {
  if (!value) return null;
  const [d, m, y] = value.split("-");
  return `${y}-${m}-${d}`;
}

/**
 * Parses the DNB CSV (UTF-8 with BOM, ";" separated, CRLF). Fails if the header differs
 * from DNB_COLUMNS, so a format change never yields misread data.
 */
export function parseDnbCsv(body: Buffer): DnbRow[] {
  const rows: string[][] = parse(body, { delimiter: ";", bom: true, relax_column_count: false });
  const [header, ...data] = rows;
  if (!header || header.join(";") !== DNB_COLUMNS.join(";")) {
    throw new Error(`DNB CSV header changed: ${header?.join(";") ?? "(empty)"}`);
  }
  if (data.length === 0) throw new Error("DNB CSV has no rows");
  return data.map((cells) => {
    const raw = Object.fromEntries(DNB_COLUMNS.map((c, i) => [c, cells[i] ?? ""]));
    const r = RowSchema.parse(raw);
    return {
      raw,
      record: {
        relationNumber: r.Relatienummer,
        name: r.StatutaireNaam,
        kvk: r.KvK || null,
        lei: r.LEI.trim().toUpperCase() || null,
        registrationType: r.RegistratieType,
        startDate: dnbDate(r.Begindatum),
        endDate: dnbDate(r.Einddatum),
        inLiquidation: r.Inliquidatie === "Ja",
        liquidationDate: dnbDate(r.DatumInLiquidatie),
      },
    };
  });
}

/** Rows whose LEI is in `leis`, deduplicated (the CSV repeats each registration per activity). */
export function selectDnbRows(rows: DnbRow[], leis: Iterable<string>): DnbRow[] {
  const wanted = new Set(leis);
  const seen = new Set<string>();
  const out: DnbRow[] = [];
  for (const row of rows) {
    if (!row.record.lei || !wanted.has(row.record.lei)) continue;
    const raw = Object.fromEntries(
      Object.entries(row.raw).filter(([k]) => !ACTIVITY_COLUMNS.has(k))
    );
    const key = JSON.stringify(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ record: row.record, raw });
  }
  return out;
}

function recordKey(r: DnbRecord): string {
  return JSON.stringify([r.lei, r.relationNumber, r.registrationType, r.startDate, r.endDate]);
}

/** sha256 of the used fields of the given records, deduplicated and sorted. */
export function computeDnbRecordsSha256(records: DnbRecord[]): string {
  const unique = [...new Map(records.map((r) => [JSON.stringify(r), r])).values()];
  return sortedRecordsSha256(unique, recordKey);
}

// ---------------------------------------------------------------------------
// Network and storage
// ---------------------------------------------------------------------------

/** Downloads the DNB CSV once. contentSha256 is the sha256 of the CSV bytes. */
export async function fetchDnbRegister(
  options: HttpOptions & { now?: () => Date } = {}
): Promise<DnbFetchResult> {
  const retrievedAt = (options.now ?? (() => new Date()))().toISOString();
  const body = await fetchBytes(DNB_CSV_URL, (ct) => ct.includes("csv"), options);
  return {
    url: DNB_CSV_URL,
    retrievedAt,
    contentSha256: computeSha256(body),
    rows: parseDnbCsv(body),
  };
}

/** Stores the rows of our issuers (without per-activity columns) when their used fields changed. */
export function storeDnbExtract(
  result: DnbFetchResult,
  selected: DnbRow[],
  rawDir: string,
  date: string
): boolean {
  const extract: SourceExtract = {
    sourceUrl: result.url,
    retrievedAt: result.retrievedAt,
    contentSha256: result.contentSha256,
    recordsSha256: computeDnbRecordsSha256(selected.map((r) => r.record)),
    records: [...selected]
      .sort((a, b) => recordKey(a.record).localeCompare(recordKey(b.record)))
      .map((r) => r.raw),
  };
  return storeExtract(extract, rawDir, date, DNB_EXTRACT_FILENAME);
}
