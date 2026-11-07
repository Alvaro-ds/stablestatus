import type { ParseResult } from "../esma/parse.js";
import type { Issuer, Meta, RegisterStatus, SourceSnapshot, WhitePaper } from "../model/index.js";

import { normalizeAuthority } from "./authorities.js";
import { parseEsmaDate } from "./dates.js";
import { dedupeRows } from "./dedupe.js";
import { normalizeDtis } from "./dti.js";
import { computeWpStatus, deriveIssuerStatus } from "./status.js";
import { extractTickerHint, normalizeWpUrl } from "./wp-url.js";

export interface NormalizeResult {
  issuers: Issuer[];
  whitepapers: WhitePaper[];
  meta: Meta;
}

/**
 * Converts raw EMTWP parse output into normalised Issuer and WhitePaper entities.
 * Output arrays are sorted by key for JSON stability across runs.
 *
 * @param parseResult - output of parseEsmaCsv("EMTWP")
 * @param snapshot    - provenance of the downloaded file
 * @param date        - ingest date (YYYY-MM-DD) written to meta
 * @param now         - used to compute registerStatus (compare against end dates)
 */
export function normalizeEmtwp(
  parseResult: ParseResult,
  snapshot: SourceSnapshot,
  date: string,
  now: Date,
): NormalizeResult {
  // 1. Remove exact duplicate rows (same rowSha256), marking survivors.
  const rows = dedupeRows(parseResult.rows);

  // 2. Pre-compute wpUrlResult + base key for every row.
  const rowData = rows.map((row) => {
    const wpUrlResult = normalizeWpUrl(row.fields["wp_url"]!);
    const baseKey = `${row.fields["ae_lei"]}:${wpUrlResult.wpUrl ?? wpUrlResult.wpType}`;
    return { row, wpUrlResult, baseKey };
  });

  // 3. Find collision groups (same base key → multiple rows).
  const keyCount = new Map<string, number>();
  for (const { baseKey } of rowData) {
    keyCount.set(baseKey, (keyCount.get(baseKey) ?? 0) + 1);
  }

  // 4. Build WhitePaper entities.
  const whitepapers: WhitePaper[] = rowData.map(({ row, wpUrlResult, baseKey }) => {
    const wpKey =
      keyCount.get(baseKey)! > 1 ? `${baseKey}:${row.rowIndex}` : baseKey;

    const lei = row.fields["ae_lei"]!;
    const authorisationDate = parseEsmaDate(row.fields["ac_authorisationNotificationDate"]!);
    const authorisationEndDate = parseEsmaDate(row.fields["ac_authorisationEndDate"]!);
    const authorityResult = normalizeAuthority(row.fields["ae_competentAuthority"]!);
    const dtiResult = normalizeDtis(row.fields["ae_DTI_FFG"]!, row.fields["ae_DTI"]!, lei);
    const registerStatus = computeWpStatus(authorisationDate, authorisationEndDate, now);
    const tickerHint = extractTickerHint(row.fields["wp_comments"]!);

    const quality: string[] = [];
    if (row.fields["_quality"]) quality.push(row.fields["_quality"]!);
    quality.push(...authorityResult.quality);
    quality.push(...dtiResult.quality);

    return {
      wpKey,
      lei,
      wpUrl: wpUrlResult.wpUrl,
      wpType: wpUrlResult.wpType,
      authorisationDate,
      authorisationEndDate,
      dtis: dtiResult.dtis,
      ffg: dtiResult.ffg,
      tickerHint,
      authorityRaw: authorityResult.authorityRaw,
      authorityCode: authorityResult.authorityCode,
      registerStatus,
      quality,
      provenance: {
        sourceUrl: snapshot.url,
        fetchedAt: snapshot.fetchedAt,
        snapshotSha256: snapshot.sha256,
        rowIndex: row.rowIndex,
        rowSha256: row.rowSha256,
      },
    };
  });

  // 5. Build Issuer entities (one per LEI) from the grouped whitepaper data.
  const issuerMap = new Map<
    string,
    { firstRow: (typeof rowData)[number]["row"]; wpStatuses: RegisterStatus[] }
  >();

  for (let i = 0; i < rowData.length; i++) {
    const { row } = rowData[i]!;
    const lei = row.fields["ae_lei"]!;
    if (!issuerMap.has(lei)) {
      issuerMap.set(lei, { firstRow: row, wpStatuses: [] });
    }
    issuerMap.get(lei)!.wpStatuses.push(whitepapers[i]!.registerStatus);
  }

  const issuers: Issuer[] = [...issuerMap.entries()].map(([lei, { firstRow, wpStatuses }]) => {
    const authorityResult = normalizeAuthority(firstRow.fields["ae_competentAuthority"]!);
    return {
      lei,
      name: firstRow.fields["ae_lei_name"]!,
      commercialName: firstRow.fields["ae_commercial_name"]! || null,
      homeMemberState: firstRow.fields["ae_homeMemberState"]!,
      countryCode: firstRow.fields["ae_lei_cou_code"]! || null,
      address: firstRow.fields["ae_address"]! || null,
      website: firstRow.fields["ae_website"]! || null,
      authorityRaw: authorityResult.authorityRaw,
      authorityCode: authorityResult.authorityCode,
      registerStatus: deriveIssuerStatus(wpStatuses),
      quality: [...authorityResult.quality],
      provenance: {
        sourceUrl: snapshot.url,
        fetchedAt: snapshot.fetchedAt,
        snapshotSha256: snapshot.sha256,
        rowIndex: firstRow.rowIndex,
        rowSha256: firstRow.rowSha256,
      },
    };
  });

  // 6. Sort both arrays for deterministic JSON output.
  issuers.sort((a, b) => a.lei.localeCompare(b.lei));
  whitepapers.sort((a, b) => a.wpKey.localeCompare(b.wpKey));

  // 7. Build meta.
  const meta: Meta = {
    date,
    schemaVersion: 1,
    sources: [
      {
        url: snapshot.url,
        sha256: snapshot.sha256,
        fetchedAt: snapshot.fetchedAt,
      },
    ],
    issuerCount: issuers.length,
    whitepaperCount: whitepapers.length,
  };

  return { issuers, whitepapers, meta };
}
