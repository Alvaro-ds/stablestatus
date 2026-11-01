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
- **Line endings:** CRLF (`\r\n`). This is consistent across all files.
- **Delimiter:** Comma (`,`). Fields are quoted with double-quotes and may
  contain embedded newlines — always use a real CSV parser. Never `split(',')`.
- **Quoting:** Standard RFC 4180 double-quote escaping (`""` inside a quoted
  field represents a literal `"`).

---

## EMTWP.csv Structure

### Key fact: one row per white paper, not per issuer

An issuer with multiple white papers (e.g. one per token) has multiple rows.
As of October 2026 there are ~50 rows and ~25 distinct issuers.

**The issuer key is `ae_lei` (Legal Entity Identifier).** Never use `ae_name`
as a key — it contains typos and variations. Two rows with the same `ae_lei`
belong to the same issuer.

### Critical column: `ac_authorisationEndDate`

If this column contains a date, the issuer's authorisation has ended or is
ending. This is the primary signal for "no longer compliant".

### Ticker

There is **no dedicated ticker column**. The ticker sometimes appears in
`wp_comments`, but inconsistently. Do not rely on it.

**The same ticker can belong to different issuers.** Real example: `EURR`
appears for both StablR and Bridge Building (Revolut's entity). Always
resolve by LEI, never by ticker.

### `wp_url` sentinel values

The URL column is not always a URL. Known sentinel strings:
- `EMT_NO_WP` — issuer has no white paper yet
- `EMT_CRIN` — white paper is under CRIN confidentiality

### Duplicate rows

The file contains exact duplicate rows. Remove them before processing
(deduplicate on all columns).

---

## DTI Codes (`ae_DTI` column)

### Extraction

The `ae_DTI` column is noisy. Known separators and patterns found in the wild:
`|`, ` | `, `||`, bare newlines, chain names in parentheses (e.g.
`ABC123456 (Ethereum)`), and the literal string `n/a`.

**Extract DTI codes with the regex `/\b[0-9A-Z]{9}\b/g`** applied to the raw
cell value. This is the only reliable method.

### Coverage gap

As of October 2026, **~56% of EMT white papers have no DTI code** at all.
Plan for this: do not assume a DTI is always available.

### Known data error: GR8.money

For the GR8.money entry, the DTI and FFG columns are **swapped** in the
register. Validate DTI values against the DTIF format when the DTI Foundation
API becomes available.

---

## Authority Name Errata

The `nc_authority_name` column contains spelling variations and typos for the
same authority across rows. Normalise to a canonical name before grouping.
Examples seen in the data: different hyphenation, accents, and abbreviation
styles for the same NCA.

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
