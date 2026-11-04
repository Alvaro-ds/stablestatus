import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { COLUMNS_BY_TYPE, type FileType } from "./columns.js";

const BOM = "﻿";

export class EsmaSchemaChangedError extends Error {
  constructor(
    public readonly fileType: FileType,
    public readonly missing: string[],
    public readonly extra: string[],
    public readonly orderChanged: boolean,
    public readonly expected: readonly string[],
    public readonly actual: string[],
  ) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: [${missing.join(", ")}]`);
    if (extra.length > 0) parts.push(`extra: [${extra.join(", ")}]`);
    if (orderChanged) parts.push("column order changed");
    super(
      `ESMA ${fileType} schema changed — ${parts.join("; ")}. Expected ${expected.length} columns, got ${actual.length}.`,
    );
    this.name = "EsmaSchemaChangedError";
  }
}

export interface ParsedRow {
  rowIndex: number;
  rowSha256: string;
  fields: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  artNonEmpty: boolean;
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function rowHash(fields: Record<string, string>): string {
  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("hex");
}

function validateHeader(
  actual: string[],
  fileType: FileType,
): void {
  const expected = COLUMNS_BY_TYPE[fileType];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = expected.filter((c) => !actualSet.has(c));
  const extra = actual.filter((c) => !expectedSet.has(c));
  const orderChanged =
    missing.length === 0 &&
    extra.length === 0 &&
    actual.some((c, i) => c !== expected[i]);

  if (missing.length > 0 || extra.length > 0 || orderChanged) {
    throw new EsmaSchemaChangedError(
      fileType,
      missing,
      extra,
      orderChanged,
      expected,
      actual,
    );
  }
}

export function parseEsmaCsv(buf: Buffer, fileType: FileType): ParseResult {
  const text = stripBom(buf.toString("utf8"));

  const records: string[][] = parse(text, {
    relax_quotes: false,
    skip_empty_lines: true,
  }) as string[][];

  if (records.length === 0) {
    throw new EsmaSchemaChangedError(
      fileType,
      COLUMNS_BY_TYPE[fileType] as unknown as string[],
      [],
      false,
      COLUMNS_BY_TYPE[fileType],
      [],
    );
  }

  const header = records[0]!;
  validateHeader(header, fileType);

  const dataRecords = records.slice(1);

  const rows: ParsedRow[] = dataRecords.map((record, idx) => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      fields[header[i]!] = record[i] ?? "";
    }
    return {
      rowIndex: idx + 1,
      rowSha256: rowHash(fields),
      fields,
    };
  });

  return {
    rows,
    artNonEmpty: fileType === "ARTZZ" && rows.length > 0,
  };
}
