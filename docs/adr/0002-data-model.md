# ADR 0002 — Phase 1 Data Model: Issuers, White Papers, Status and Provenance

**Date:** 2026-11-03
**Status:** Accepted (2026-11-04)
**Related:** ADR 0001 (versioned JSON in Git instead of a database)

---

## Context

Phase 1 must answer, every day and with sources: _"Is this issuer and its white
paper authorised under MiCA today, and since when?"_. The source is ESMA's
interim MiCA register (`EMTWP.csv` and `ARTZZ.csv`).

What the data looks like (download of 2026-10-31):

- **One row per white paper**, not per issuer: 50 rows, 25 issuers (distinct LEIs).
- **28 of 50 rows have no DTI.** Rows that do use at least 14 different separators.
- There is no ticker column. The ticker sometimes appears in `wp_comments`,
  sometimes in the URL, sometimes nowhere.
- Dirty data:
  - 2 exact duplicate rows (AIEU).
  - Typos in authority names ("De Nederlansche Bank").
  - DTI and FFG swapped (GR8.money).
  - 3 Quantoz rows without an authorisation date.
- `wp_url` can be `EMT_NO_WP` or `EMT_CRIN`.
- `ac_authorisationEndDate` is the most critical signal: a date means the
  authorisation has been withdrawn.
- The free DTI Foundation download **locks** the chain and address fields, and
  its redistribution terms are unclear.

Legal review (Nov 2026) confirmed two requirements:

1. A token's official address must come from the issuer's own website (Phase 2).
2. **Every data point must be traceable to its source**, because CASPs will have
   to justify their decisions to their supervisor.

This model underpins blocks B2–B7. Changing it later is expensive, so it is fixed now.

## Decision

### D1. Units and identity keys

| Entity           | Represents                                                   | Key                                                                                                      | Why                                                                                                                  |
| ---------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Issuer`         | Authorised legal entity                                      | `lei` (20 chars, ISO 17442)                                                                              | Stable, global, links to GLEIF and national registers. **Never** the name (typos) or the ticker (copyable)           |
| `WhitePaper`     | One ESMA row: a white paper, or an authorisation without one | `wpKey = lei + ":" + first 12 hex chars of sha256(wpUrl\|wp_comments\|wp_authorisationNotificationDate)` | The only key that identifies every row, including the 28 without a DTI. Content-based: never depends on row position |
| `SourceSnapshot` | One ESMA file as downloaded at a given time                  | `sha256` of the content                                                                                  | Proves exactly what the source said                                                                                  |

**There is no `Token` entity in Phase 1.** DTIs are stored as a list on the
`WhitePaper` (`dtis[]` and `ffg`), because:

- Without the locked DTIF fields we cannot tell which chain each DTI refers to.
- 28 white papers have no DTI, so there would be no token to create.

Phase 2 adds a `Deployment` entity keyed by `chainId (CAIP-2) + address`, the
real identity of an on-chain token. It links to its `WhitePaper` and, when one
exists, to its DTI.

Phase 2 note (out of scope here): each `Deployment` will also store
**deployment evidence**: `deployTxHash`, `deployer`, `blockNumber` and
`deployedAt`. This shows that the contract was deployed by an address linked to
the issuer, and separates originals from bridged versions and imitations.
Dune (via MCP) is a discovery tool, for example to find every contract deployed
by an issuer's deployer. Published data is confirmed by reading the chain via
RPC with viem, since Dune is a third-party indexer, not a primary source. To be
decided in the address-model ADR (B11).

When an issuer publishes a new white paper version, `wp_url` changes and the
row appears as a removal plus an addition on the same day. The diff (B4)
records this as `whitepaper_replaced` when the LEI and the day match, so it is
not mistaken for a withdrawal.

### D2. Provenance: per row in Phase 1, per field in Phase 2

Every `Issuer` and `WhitePaper` carries a `provenance` object:

```ts
// src/model/provenance.ts (shape only; real code is written in B2)
provenance: {
  sourceUrl: string; // exact CSV URL on esma.europa.eu
  fetchedAt: string; // ISO 8601 UTC, e.g. "2026-11-16T05:12:03Z"
  snapshotSha256: string; // hash of the whole file
  rowIndex: number; // row in the original CSV (1 = first data row)
  rowSha256: string; // hash of the raw row, before normalisation
}
```

Any published data point can be traced to the ESMA URL, that day's file
(stored in `data/raw/`) and the exact row, all verifiable by hash.

Per-row provenance is enough in Phase 1 because every field in a row comes from
the same source. Phase 2 mixes sources (issuer website, on-chain reads,
national registers), so each field will carry its own provenance. The
national-register cross-check (B6) is stored separately as `Evidence` records
with the same provenance shape, and never alters ESMA data.

### D3. Status describes the register, not a compliance verdict

Status is **computed** from dates, not copied from any field:

| `registerStatus`             | Rule                                                            | Change severity |
| ---------------------------- | --------------------------------------------------------------- | --------------- |
| `authorised`                 | Has an authorisation date and no end date, or a future end date | —               |
| `authorisation_date_missing` | Listed but without an authorisation date (the 3 Quantoz rows)   | Warning         |
| `withdrawn`                  | Has an end date that has been reached                           | **Critical**    |
| `delisted`                   | Was in the register and disappeared without an end date         | **Critical**    |

The issuer's status is derived from its white papers.

**Legal boundary:** the field is `registerStatus` ("what the register says"),
never `compliant` or `allowed`. StableStatus provides sourced information; the
CASP decides. This keeps the tool from reading as advice, and the legal notice
states it explicitly.

### D4. Normalisation rules (implemented in B3)

| Field      | Rule                                                                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dates      | `dd/mm/yyyy` → `YYYY-MM-DD`. Empty is `null`, never `""`                                                                                                                                                                                     |
| DTI        | Extract with `/\b[0-9A-Z]{9}\b/g` (do not split on `\|`), dedupe and sort. `n/a` → `[]`                                                                                                                                                      |
| DTI vs FFG | If an `ae_DTI_FFG` value also appears in `ae_DTI` on the same row, or vice versa, apply the known fix (GR8.money case) and flag `quality: ["dti_ffg_swapped"]`                                                                               |
| Authority  | Keep the original in `authorityRaw` and a canonical `authorityCode` (e.g. `NL-DNB`, `DE-BAFIN`, `FR-ACPR`) from an alias table in `src/normalize/authorities.ts`. An unknown alias **does not break ingestion**, but is flagged as a warning |
| `wp_url`   | Trim and lowercase the host. `EMT_NO_WP` and `EMT_CRIN` become `wpType` with `wpUrl: null`                                                                                                                                                   |
| Duplicates | Rows with the same `rowSha256` after trimming are merged into one, flagged `quality: ["duplicate_row"]`                                                                                                                                      |
| Ticker     | Stored only as `tickerHint`, extracted from `wp_comments` by rules. **Not a key and not verified data.** No DTIF tickers in public data until its licence is clarified                                                                       |

Every anomaly is recorded in a `quality: string[]` field on the record, so
problems stay visible instead of being silently cleaned.

### D5. Files and validation

```
data/
  raw/YYYY-MM-DD/EMTWP.csv     # exact copy, only when the sha256 changes
  raw/YYYY-MM-DD/ARTZZ.csv
  raw/YYYY-MM-DD/manifest.json # url, fetchedAt and sha256 of each file (every day)
  current/issuers.json         # current normalised state
  current/whitepapers.json
  current/meta.json            # date, source hashes, counts, schema version
  changes.jsonl                # append-only history, never rewritten
CHANGELOG-data.md              # human-readable summary generated from changes.jsonl
```

- Each `changes.jsonl` line: `{ at, entity, key, kind, field?, from?, to?, severity, snapshotSha256 }`.
  This is the basis of the audit trail.
- Schemas are defined with **zod** in `src/model/`; TypeScript types are derived
  with `z.infer`, giving a single source of truth.
- If ESMA's columns change (different header), ingestion **stops**, writes
  nothing and alerts. A day without data beats a day of misread data.
- Every file in `current/` carries `schemaVersion`. A breaking change requires a
  version bump and a new ADR.

## Alternatives considered

| Alternative                            | Why rejected                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Ticker or name as key                  | Tickers repeat across issuers (EURR: StablR and Bridge/Revolut) and names have typos. This is the very problem we solve |
| `Token` entity keyed by DTI in Phase 1 | Fails for 28 of 50 rows, and each DTI's chain is locked in the DTIF data                                                |
| Per-field provenance now               | Duplicates the same value on every field of a row with no benefit while there is a single source. Adopted in Phase 2    |
| Copy status "as is"                    | ESMA publishes no status field; it must be derived from dates. Doing it explicitly, with tests, is more auditable       |
| Database now                           | Rejected in ADR 0001: with 50 rows, versioned JSON in Git is free and its commit history doubles as an audit trail      |
| Store the raw CSV every day            | Would mostly duplicate the same file. Stored only on hash change; the daily `manifest.json` proves the check ran        |

## Consequences

**Positive**

- Every published data point traces to source and row, by hash. Meets the
  legal review's traceability requirement.
- Withdrawals and delistings become dated critical events, which is what CASPs
  need most.
- Phase 2 adds `Deployment` without touching `Issuer` or `WhitePaper`.

**Negative / costs**

- `wpKey` depends on the white paper URL; a new URL yields a removal plus an
  addition, mitigated by the `whitepaper_replaced` rule.
- The authority alias table is maintained by hand (few entries, with a warning
  on new ones).
- The ticker is only a hint (`tickerHint`); in Phase 1 the site cannot reliably
  search by ticker on every row.

_Amendment (2026-11-07):_ ESMA lists several white papers under the same
`wp_url` (AllUnity, Quantoz, Fiat Republic, Bettr), so `lei + wpUrl` is not
unique. `wpKey` is now `lei + ":" + first 12 hex chars of
sha256(wpUrl|wp_comments|wp_authorisationNotificationDate)`, applied to every
row. It never depends on row position. A change to `wp_comments` or to the
white paper date yields a new key, which B4 reports as `whitepaper_replaced`.

**Risks**

- If ESMA changes the file format or URL, ingestion stops (by design) and needs
  manual intervention. Mitigation: the automatic alert in B5.
- ESMA's register is interim and lags national registers. The B6 cross-check
  documents this but does not modify ESMA data.

---

_StableStatus provides sourced information, not legal advice._
