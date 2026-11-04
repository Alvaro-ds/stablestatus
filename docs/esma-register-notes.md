# ESMA Interim MiCA Register — Developer Reference

Source and date of last update: compiled 2026-11-01 from direct inspection of
the CSV files and the ESMA field description document.

---

## File URLs

All files are served from the same base path:

```
https://www.esma.europa.eu/sites/default/files/2024-12/{FILENAME}.csv
```

| File | Contents |
|------|---------|
| `EMTWP.csv` | E-Money Token white papers (one row per white paper) |
| `ARTZZ.csv` | Asset-Referenced Token entries |
| `CASPS.csv` | Crypto-Asset Service Provider registrations |
| `NCASP.csv` | Non-EU CASP notifications |
| `OTHER.csv` | Other notified entities |
| `Description_of_the_fields_in_the_interim_MiCA_register.csv` | Column dictionary |

---

## Encoding & Format

- **Encoding:** UTF-8 **with BOM** (`\xEF\xBB\xBF` at the start of the file).
  Strip the BOM before processing or use a BOM-aware parser.
- **Line endings:** records are terminated by CRLF (`\r\n`), but quoted fields
  may contain **bare LF** (`\n`) line breaks. In `EMTWP_2026-10-30.csv` there
  are 51 CRLF (header + 50 records) and 7 embedded LF, all inside a single
  `ae_DTI` cell (one DTI per chain, separated by `\n\t`). The file has 58 lines
  but only 50 records: never count records by counting lines.
- **Delimiter:** Comma (`,`). Fields are quoted with double-quotes and may
  contain embedded newlines — always use a real CSV parser. Never `split(',')`.
- **Quoting:** Standard RFC 4180 double-quote escaping (`""` inside a quoted
  field represents a literal `"`).

---

## EMTWP.csv Structure

### Columns

The 19 columns, in file order (taken from `EMTWP_2026-10-30.csv`):

| # | Column | Notes |
|---|--------|-------|
| 1 | `ae_competentAuthority` | National Competent Authority (NCA) name. Contains typos — see below. |
| 2 | `ae_homeMemberState` | ISO country code of the home member state (e.g. `CZ`). |
| 3 | `ae_lei_name` | Legal name of the issuer as registered with its LEI. |
| 4 | `ae_lei` | Legal Entity Identifier. **The issuer key.** |
| 5 | `ae_lei_cou_code` | Country code of the LEI. |
| 6 | `ae_commercial_name` | Commercial / brand name. |
| 7 | `ae_address` | Registered address. |
| 8 | `ae_website` | Issuer website. |
| 9 | `ac_authorisationNotificationDate` | Date of the issuer's authorisation. |
| 10 | `ac_authorisationEndDate` | **Critical** — end of authorisation. See below. |
| 11 | `ae_exemption48_4` | Whether the MiCA Art. 48(4) exemption applies. |
| 12 | `ae_exemption48_5` | Whether the MiCA Art. 48(5) exemption applies. |
| 13 | `ae_authorisation_other_emt` | Licence type (e.g. `Electronic money institution`). |
| 14 | `ae_DTI_FFG` | DTI Functionally Fungible Group code. |
| 15 | `ae_DTI` | Digital Token Identifier(s). Noisy — see below. |
| 16 | `wp_url` | White paper URL, or a sentinel value. |
| 17 | `wp_authorisationNotificationDate` | Date of the white paper notification. |
| 18 | `wp_comments` | Free text. Sometimes contains the ticker. |
| 19 | `wp_lastupdate` | Date of the last update of the entry. |

### Dates

All date columns use **`dd/mm/yyyy`** (e.g. `26/04/2017`). Do not parse them
with `new Date(value)`, which assumes `mm/dd/yyyy` or ISO format. Date columns
can also be empty or contain the literal `n/a`.

### Key fact: one row per white paper, not per issuer

An issuer with multiple white papers (e.g. one per token) has multiple rows.
The 2026-10-30 snapshot has 50 rows (48 unique) and 25 distinct issuers.

**The issuer key is `ae_lei` (Legal Entity Identifier).** Never use
`ae_lei_name` or `ae_commercial_name` as a key — names contain variations. Two
rows with the same `ae_lei` belong to the same issuer.

### Critical column: `ac_authorisationEndDate`

If this column contains a date, the issuer is no longer authorised (or stops
being authorised on that date). This is the primary signal for "no longer
compliant".

In the 2026-10-30 snapshot no row has a real date here: the column is empty
except for three rows (AIEU Services Limited S.A.) that contain the literal
`n/a`. Treat `n/a` as "no end date", and fail on any value that is neither
empty, `n/a`, nor a valid `dd/mm/yyyy` date.

### Exemptions: `ae_exemption48_4` and `ae_exemption48_5`

Flags for the exemptions in MiCA Article 48(4) and 48(5). Values are not
normalised: the snapshot contains `YES`, `NO`, `No`, `N/A` and empty cells.
Compare case-insensitively and keep `N/A` and empty as distinct "unknown" values.

### Ticker

There is **no dedicated ticker column**. The ticker sometimes appears in
`wp_comments`, but inconsistently. Do not rely on it.

**The same ticker can belong to different issuers.** Real example: `EURR`
appears for both StablR and Bridge Building (Revolut's entity). Always
resolve by LEI, never by ticker.

### `wp_url` sentinel values

The URL column is not always a URL. Known sentinel strings:
- `EMT_NO_WP` — issuer has no white paper yet
- `EMT_CRIN` — white paper is under CRIN confidentiality (not present in the
  2026-10-30 snapshot)

### Duplicate rows

The file contains exact duplicate rows. Remove them before processing
(deduplicate on all columns).

---

## DTI Codes (`ae_DTI` column)

### Extraction

The `ae_DTI` column is noisy. Known separators and patterns found in the wild:
`|`, ` | `, `||`, bare newlines followed by tabs, chain names in parentheses
(e.g. `ABC123456 (Ethereum)`), and the literal string `n/a`.

**Extract DTI codes with the regex `/\b[0-9A-Z]{9}\b/g`** applied to the raw
cell value. This is the only reliable method.

### Coverage gap

In the 2026-10-30 snapshot, **28 of 50 EMT white papers (56%) have no DTI
code** at all. Plan for this: do not assume a DTI is always available.

### Known data error: GR8.money

For the GR8.money entries, the values in `ae_DTI` and `ae_DTI_FFG` are
**swapped** in the register. Both are 9-character codes, so the regex cannot
tell them apart: validate the code type against the DTI Foundation data.

### DTI Foundation data

The free JSON download from the DTI Foundation (https://dtif.org) only
includes the DTI, its type, the name and the ticker. The chain and contract
address fields (`Normative.AuxiliaryDistributedLedger` and
`AuxiliaryTechnicalReference`) come back as `<locked>`. A DTI therefore
**cannot be resolved to a contract address** with the free data: addresses
must come from issuer sources and on-chain verification.

---

## Authority Name Errata

The `ae_competentAuthority` column contains spelling variations and typos for
the same authority across rows. Normalise to a canonical name before grouping.
Examples from the 2026-10-30 snapshot:

- `De Nederlandsche Bank (DNB)` and `De Nederlansche Bank (DNB)` (typo)
- `Bank of Lithuania (LSC)` and `Bank of Lithuania`

---

## Schema Validation Requirement

The ingest pipeline **must use a strict zod schema** to validate the parsed CSV
before writing any output. If an unexpected column appears, a required column
disappears, or a value fails validation, the pipeline must **fail with a clear
error message** — it must never silently publish corrupt or incomplete data.

This is a core product guarantee: downstream CASPs rely on the data for
compliance decisions.

---

## Immutability Requirement

Every change to the dataset (issuer status, contract address, trust level) must
be appended to an immutable history log. Status history is append-only: entries
are never modified or deleted. This log is the foundation of the audit trail.
