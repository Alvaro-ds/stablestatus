/**
 * Generates variant EMTWP CSV fixtures for diff/ingest tests.
 * Run with: node --experimental-strip-types tests/scripts/generate-variants.ts
 *
 * Variants produced in tests/fixtures/esma/variants/:
 *   withdrawal.csv        — one whitepaper gets a past ac_authorisationEndDate
 *   whitepaper_delisted.csv — one whitepaper row removed (issuer still exists)
 *   whitepaper_replaced.csv — one whitepaper row gets a new wp_url (same LEI)
 *   field_changed.csv     — one whitepaper row gets a new DTI appended
 *   issuer_added.csv      — one new issuer row appended
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

const BASE = join(import.meta.dirname, "..", "fixtures", "esma", "EMTWP_2026-10-30.csv");
const OUT_DIR = join(import.meta.dirname, "..", "fixtures", "esma", "variants");

mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvCell(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function serializeCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

function writeVariant(name: string, rows: string[][]): void {
  writeFileSync(join(OUT_DIR, name), serializeCsv(rows), "utf8");
  console.log(`Written: ${name} (${rows.length - 1} data rows)`);
}

// ---------------------------------------------------------------------------
// Parse base fixture
// ---------------------------------------------------------------------------

const rawBuf = readFileSync(BASE);
const rawText = rawBuf.toString("utf8").replace(/^﻿/, "");

// rows is string[][] — header at index 0, data rows at 1..n
const rows = parse(rawText, {
  relax_column_count: true,
  relax_quotes: true,
  skip_empty_lines: true,
}) as string[][];

const header = rows[0]!;

function colIdx(name: string): number {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`Column not found: ${name}`);
  return i;
}

const COL_LEI = colIdx("ae_lei");
const COL_LEI_NAME = colIdx("ae_lei_name");
const COL_END_DATE = colIdx("ac_authorisationEndDate");
const COL_DTI = colIdx("ae_DTI");
const COL_WP_URL = colIdx("wp_url");
const COL_WP_OFFER_DATE = colIdx("wp_authorisationNotificationDate");
const COL_WP_COMMENTS = colIdx("wp_comments");
const COL_AUTH_DATE = colIdx("ac_authorisationNotificationDate");

const dataRows = rows.slice(1);

// ---------------------------------------------------------------------------
// Find a suitable row for each scenario
// ---------------------------------------------------------------------------

// Count rows per LEI to find issuers with multiple whitepapers
const countByLei = new Map<string, number>();
for (const r of dataRows) {
  const lei = r[COL_LEI]!;
  countByLei.set(lei, (countByLei.get(lei) ?? 0) + 1);
}

// Row with empty ac_authorisationEndDate (currently authorised, no end date)
const withdrawalRowIdx = dataRows.findIndex(
  (r) => r[COL_END_DATE] === "" || r[COL_END_DATE] === "n/a"
);
if (withdrawalRowIdx === -1) throw new Error("Could not find a row with empty end date");

// Row belonging to an issuer with >= 2 rows (so removing it doesn't remove the issuer)
const delistedRowIdx = dataRows.findIndex((r) => {
  const lei = r[COL_LEI]!;
  return (countByLei.get(lei) ?? 0) >= 2;
});
if (delistedRowIdx === -1) throw new Error("Could not find multi-whitepaper issuer");

// Use same row as delisted for replacement scenario (same LEI keeps other rows)
const replacedRowIdx = delistedRowIdx;

// Use first data row for field_changed
const fieldChangedRowIdx = 0;

// ---------------------------------------------------------------------------
// Generate variants
// ---------------------------------------------------------------------------

// 1. withdrawal.csv
const withdrawalRows: string[][] = [
  header,
  ...dataRows.map((r, i) => {
    if (i !== withdrawalRowIdx) return r;
    const updated = [...r];
    updated[COL_END_DATE] = "01/01/2024";
    return updated;
  }),
];
writeVariant("withdrawal.csv", withdrawalRows);

// 2. whitepaper_delisted.csv — remove one whitepaper row
const delistedRows: string[][] = [header, ...dataRows.filter((_, i) => i !== delistedRowIdx)];
writeVariant("whitepaper_delisted.csv", delistedRows);

// 3. whitepaper_replaced.csv — change wp_url (new wpKey, same LEI)
const replacedRows: string[][] = [
  header,
  ...dataRows.map((r, i) => {
    if (i !== replacedRowIdx) return r;
    const updated = [...r];
    updated[COL_WP_URL] = "https://www.replaced-whitepaper.example.com/wp";
    return updated;
  }),
];
writeVariant("whitepaper_replaced.csv", replacedRows);

// 4. field_changed.csv — append a new DTI to ae_DTI
const fieldChangedRows: string[][] = [
  header,
  ...dataRows.map((r, i) => {
    if (i !== fieldChangedRowIdx) return r;
    const updated = [...r];
    const existing = updated[COL_DTI] ?? "";
    updated[COL_DTI] = existing ? existing + "|NEWDTI001" : "NEWDTI001";
    return updated;
  }),
];
writeVariant("field_changed.csv", fieldChangedRows);

// 5. issuer_added.csv — append a new issuer row
// LEI must match /^[A-Z0-9]{18}[0-9]{2}$/ — 18 alphanumeric + 2 digits = 20 chars
const newLei = "TESTADDEDISSUER00001";
const newRow = [...(dataRows[fieldChangedRowIdx] ?? header)];
newRow[COL_LEI] = newLei;
newRow[COL_LEI_NAME] = "Test Added Issuer";
newRow[COL_WP_URL] = "https://www.test-added-issuer.example.com/wp";
newRow[COL_WP_OFFER_DATE] = "01/01/2026";
newRow[COL_WP_COMMENTS] = "TSTKR";
newRow[COL_AUTH_DATE] = "01/01/2026";
newRow[COL_END_DATE] = "";

const issuerAddedRows: string[][] = [header, ...dataRows, newRow];
writeVariant("issuer_added.csv", issuerAddedRows);

// 6. future_withdrawal.csv — same as base but one row has a future ac_authorisationEndDate
// Used to test that status is re-evaluated even when the CSV hash is unchanged.
// "15/10/2026" is after 2026-10-01 (authorised) but before 2026-11-01 (withdrawn).
const futureWithdrawalRows: string[][] = [
  header,
  ...dataRows.map((r, i) => {
    if (i !== withdrawalRowIdx) return r;
    const updated = [...r];
    updated[COL_END_DATE] = "15/10/2026";
    return updated;
  }),
];
writeVariant("future_withdrawal.csv", futureWithdrawalRows);

console.log("Done. Variants written to", OUT_DIR);
