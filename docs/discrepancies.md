# Discrepancies and Signals

This guide explains the `discrepancies` and `signals` published in `data/current/checks.json`: what each kind means, how severe it is and where it comes from. It is written for compliance teams. The design decisions behind it are in [ADR 0003](adr/0003-evidence-and-source-precedence.md).

## What a discrepancy is

A discrepancy is recorded when two official sources state different values for the same piece of data about an issuer, for example its legal name or its country.

- The ESMA interim MiCA register is never modified. StableStatus keeps both values, each with its own source and its own evidence record.
- A discrepancy does **not** change `registerStatus`, which describes only what the ESMA register says.
- A discrepancy does **not** say which of the two values is correct. It only shows that the sources differ.

## Discrepancy kinds

Severity is the one given to the change event when the discrepancy first appears (see [Where to see it](#where-to-see-it)).

| Kind                 | What it compares                                                                 | Severity | Detected automatically today   |
| -------------------- | -------------------------------------------------------------------------------- | -------- | ------------------------------ |
| `name_format`        | ESMA issuer name (`ae_lei_name`) vs GLEIF `entity.legalName.name`                | info     | Yes, from GLEIF                |
| `name_mismatch`      | ESMA issuer name (`ae_lei_name`) vs GLEIF `entity.legalName.name`                | warning  | Yes, from GLEIF                |
| `country_mismatch`   | ESMA `ae_lei_cou_code` vs GLEIF `entity.legalAddress.country`                    | warning  | Yes, from GLEIF                |
| `date_mismatch`      | ESMA authorisation date vs the date in another official register                 | warning  | No: defined, not generated yet |
| `authority_mismatch` | ESMA competent authority vs the authority shown by another official source       | warning  | No: defined, not generated yet |
| `status_mismatch`    | ESMA authorisation status vs the licence status in another official register     | warning  | No: defined, not generated yet |
| `missing_in_nca`     | Issuer listed by ESMA but not found in the national competent authority register | warning  | No: defined, not generated yet |
| `missing_in_esma`    | Issuer listed by a national competent authority but not in the ESMA register     | warning  | No: defined, not generated yet |

Notes:

- The country is only compared when ESMA gives one. An empty ESMA value is a data-quality issue, not a discrepancy.
- Issuers are matched across sources by LEI (or by national registration ID when a source has no LEI), never by name. A name discrepancy therefore always concerns the same LEI.

## How names are compared

1. The ESMA name used is the first non-empty line of `ae_lei_name`.
2. Both names are normalised: case, accents, punctuation and extra whitespace are ignored. If they are then equal, no discrepancy is recorded.
3. If they still differ, legal forms from a closed list are removed: SA, S.A., SAS, SCA, B.V., GmbH, Ltd, ehf, hf., UAB, SIA, sp. z o.o., Oy, ApS, SE, d.o.o. If the names are then equal, the kind is `name_format`; otherwise it is `name_mismatch`.

Example (invented names): ESMA "Example Payments GmbH" and GLEIF "EXAMPLE PAYMENTS" give `name_format`. ESMA "Example Payments GmbH" and GLEIF "Sample Money GmbH" give `name_mismatch`.

## Signals

A signal is an event from an official source that may affect an issuer but has not (or not yet) changed the ESMA register, such as a lapsed LEI or a withdrawn national licence.

How a signal differs from a discrepancy:

- A discrepancy compares two sources on the same data. A signal reports a state in one source, with no comparison.
- Each signal kind has a fixed severity, stored on the signal itself.
- Like a discrepancy, a signal never changes `registerStatus`. It is shown next to it.

| Kind                     | Meaning                                                                                                           | Severity | Detected automatically today                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `lei_lapsed`             | GLEIF `registration.status` is `LAPSED` (the LEI was not renewed)                                                 | warning  | Yes, from GLEIF                                      |
| `lei_retired`            | GLEIF `registration.status` is `RETIRED`, `ANNULLED`, `DUPLICATE` or `MERGED`, or `entity.status` is not `ACTIVE` | critical | Yes, from GLEIF                                      |
| `nca_licence_inactive`   | An official register shows the licence as not active (for example, the entity is in liquidation)                  | critical | Yes, from the DNB register and manual checks         |
| `nca_licence_withdrawn`  | An official register shows the licence as withdrawn or ended                                                      | critical | Yes, from the EBA PSD2 register and the DNB register |
| `liquidation_announced`  | A liquidation is announced in an official source                                                                  | critical | No: defined, not generated yet                       |
| `insolvency_proceedings` | Insolvency proceedings are opened, according to an official source                                                | critical | No: defined, not generated yet                       |

Every signal with severity `critical` opens a `critical-change` alert (a GitHub issue in this repository) on the day it first appears. `lei_lapsed` does not.

## Where to see it

### `data/current/checks.json`

One entry per issuer, with `discrepancies[]` and `signals[]`. Example with invented values:

```json
{
  "lei": "EXAMPLE0000000000001",
  "levels": { "L1": "inactive", "L2": "confirmed", "L3": null },
  "levelReached": "L2",
  "discrepancies": [
    {
      "kind": "name_format",
      "field": "name",
      "esmaValue": "Example Payments GmbH",
      "otherValue": "EXAMPLE PAYMENTS",
      "otherSourceType": "gleif",
      "otherSourceUrl": "https://api.gleif.org/api/v1/lei-records?filter[lei]=EXAMPLE0000000000001",
      "evidenceId": "a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1"
    }
  ],
  "signals": [
    {
      "kind": "lei_lapsed",
      "severity": "warning",
      "observed": { "registration.status": "LAPSED" },
      "sourceType": "gleif",
      "sourceUrl": "https://api.gleif.org/api/v1/lei-records?filter[lei]=EXAMPLE0000000000001",
      "evidenceId": "a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1"
    }
  ]
}
```

### `data/changes.jsonl`

The append-only change history. Each change is one line, with its date, source, severity and a fixed, neutral message:

| Event                  | When                                | Severity                                           |
| ---------------------- | ----------------------------------- | -------------------------------------------------- |
| `discrepancy_added`    | A discrepancy appears               | `info` for `name_format`, `warning` for the others |
| `discrepancy_resolved` | A discrepancy is no longer recorded | `info`                                             |
| `signal_added`         | A signal appears                    | The signal's own severity                          |
| `signal_cleared`       | A signal is no longer raised        | `info`                                             |

### Evidence

Every discrepancy and signal has an `evidenceId` that points to a record in `data/evidence/evidence.jsonl`. That record holds the exact source URL, the retrieval date, the SHA-256 hash of the content retrieved and the fields as the source shows them, so any value can be checked again at the source.

## What we do not do

- We do not correct ESMA data. Both values are published as the sources state them.
- We do not judge issuers. A discrepancy or a signal describes data in official sources, not the conduct of an entity.
- For now, we do not notify ESMA, national competent authorities or issuers of discrepancies (ADR 0003 §D7).

---

_StableStatus provides sourced information, not legal advice._
