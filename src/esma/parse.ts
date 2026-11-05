import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";

import { COLUMNS_BY_TYPE, type FileType } from "./columns.js";

// ESMA CSV files are UTF-8 with BOM. Strip it before parsing so the first
// header column does not start with the invisible U+FEFF character.
const BOM = "﻿";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the downloaded CSV header does not match the expected columns.
 * The ingest stops immediately — better a loud failure than silently publishing
 * data mapped to the wrong fields.
 */
export class EsmaSchemaChangedError extends Error {
  constructor(
    public readonly fileType: FileType,
    public readonly missing: string[],
    public readonly extra: string[],
    public readonly orderChanged: boolean,
    public readonly expected: readonly string[],
    public readonly actual: string[]
  ) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: [${missing.join(", ")}]`);
    if (extra.length > 0) parts.push(`extra: [${extra.join(", ")}]`);
    if (orderChanged) parts.push("column order changed");
    super(
      `ESMA ${fileType} schema changed — ${parts.join("; ")}. Expected ${expected.length} columns, got ${actual.length}.`
    );
    this.name = "EsmaSchemaChangedError";
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ParsedRow {
  /** 1-based row number within the CSV (header excluded). */
  rowIndex: number;
  /** SHA-256 of the raw UTF-8 bytes of this row as stored on disk. */
  rowSha256: string;
  /** Column name → cell value map. Empty string when the cell is blank. */
  fields: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  /**
   * True when this is an ARTZZ file with at least one data row.
   * Currently ARTZZ is header-only (no ARTs authorised yet); when this flips
   * to true it means the first ART authorisation has appeared and needs attention.
   */
  artNonEmpty: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RecordWithInfo {
  record: string[];
  /** Cumulative byte offset in the source text after parsing this record. */
  info: { bytes: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateHeader(actual: string[], fileType: FileType): void {
  const expected = COLUMNS_BY_TYPE[fileType];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = expected.filter((c) => !actualSet.has(c));
  const extra = actual.filter((c) => !expectedSet.has(c));
  const orderChanged =
    missing.length === 0 && extra.length === 0 && actual.some((c, i) => c !== expected[i]);

  if (missing.length > 0 || extra.length > 0 || orderChanged) {
    throw new EsmaSchemaChangedError(fileType, missing, extra, orderChanged, expected, actual);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses an ESMA CSV buffer into structured rows with provenance hashes.
 *
 * rowSha256 is computed from the raw UTF-8 bytes of each row as they appear
 * in the downloaded file (BOM stripped, everything else preserved).
 * We use csv-parse's `info.bytes` offsets to slice the bytes rather than
 * re-serialising the parsed fields, so the hash survives round-trips.
 */
export function parseEsmaCsv(buf: Buffer, fileType: FileType): ParseResult {
  const text = buf.toString("utf8").replace(new RegExp(`^${BOM}`), "");

  // Keep a byte-level copy so we can slice raw row bytes for rowSha256.
  const textBuf = Buffer.from(text, "utf8");

  const rawRecords = parse(text, {
    relax_quotes: false,
    skip_empty_lines: true,
    info: true, // adds cumulative `bytes` offset to each record
  }) as unknown as RecordWithInfo[];

  if (rawRecords.length === 0) {
    throw new EsmaSchemaChangedError(
      fileType,
      [...COLUMNS_BY_TYPE[fileType]],
      [],
      false,
      COLUMNS_BY_TYPE[fileType],
      []
    );
  }

  const header = rawRecords[0]!.record;
  validateHeader(header, fileType);

  const rows: ParsedRow[] = rawRecords.slice(1).map((item, idx) => {
    // `info.bytes` is cumulative: the bytes of record N start where record N-1 ended.
    const prevBytes = rawRecords[idx]!.info.bytes;
    const currBytes = item.info.bytes;
    const rawRowBytes = textBuf.slice(prevBytes, currBytes);

    const fields: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      fields[header[i]!] = item.record[i] ?? "";
    }

    return {
      rowIndex: idx + 1,
      rowSha256: createHash("sha256").update(rawRowBytes).digest("hex"),
      fields,
    };
  });

  return {
    rows,
    artNonEmpty: fileType === "ARTZZ" && rows.length > 0,
  };
}
