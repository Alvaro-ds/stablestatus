# ADR 0003 — Evidence, Source Precedence and Cross-Checks Against Official Registers

**Date:** 2026-11-11
**Status:** Accepted (2026-11-11)
**Related:** ADR 0002 (data model). Licensing will be ADR 0004.

---

## Context

ADR 0002 makes ESMA's interim MiCA register the primary source. Block B6.1 (inventory of sources, checked on 2026-11-09 and 2026-11-11) cross-checked the 25 EMT issuers against national competent authority (NCA) registers, GLEIF and the EBA, and found real discrepancies:

- **Dates differ.** AllUnity: ESMA 20/06/2026, while the issuer states a BaFin licence of 01/07/2025. Bridge Building: ESMA 23/07/2026, CSSF 29/06/2026.
- **Names differ.** ESMA "Monerium ehf"; GLEIF and the Central Bank of Iceland "Monerium hf." (same LEI). DINARO was named PAYWISER until 08/06/2026.
- **LEI lapsed.** Eurodollar ApS: GLEIF `registration.status = LAPSED` (renewal due 2026-10-31), checked 2026-11-11.
- **Risk without a register change.** StablR: the issuer announced that a dissolution application was filed in court on 06/11/2026, yet ESMA and the MFSA still show it as authorised.
- **Registers prove different things.** Most NCA registers confirm the entity's licence (e-money institution or credit institution). Only some (CSSF, MFSA) list EMT issuance specifically.
- **Access differs.** GLEIF (API, CC0), the EBA PSD2 register (JSON download), DNB (daily CSV/XML) and ACPR (REGAFI API) can be automated. CSSF disallows automated access (robots.txt), CNB uses a CAPTCHA, and KNF's downloadable list dates from 2020.

Clients must be able to verify every claim themselves, and StableStatus must stay neutral: it reports what official sources say and never judges an entity.

## Decision

### D1. ESMA data is never modified; disagreements become discrepancies

`data/current/issuers.json` and `whitepapers.json` keep exactly what ESMA says (ADR 0002). Any disagreement with another official source is recorded as a **discrepancy**: both values, each with its own source, never a "corrected" value.

Discrepancy kinds:

- `date_mismatch`
- `name_mismatch`
- `authority_mismatch`
- `status_mismatch`
- `missing_in_nca`
- `missing_in_esma`

### D2. Risk signals are separate from `registerStatus`

`registerStatus` still describes only the ESMA register. Events that affect an issuer but have not (yet) changed a register are **signals**, each with severity and an official source.

Signal kinds:

- `lei_lapsed` (warning)
- `lei_retired` (critical)
- `nca_licence_inactive` (critical)
- `nca_licence_withdrawn` (critical)
- `liquidation_announced` (critical)
- `insolvency_proceedings` (critical)

A signal never changes `registerStatus`. It is shown next to it, and it creates a `critical-change` alert when its severity is critical.

### D3. Evidence comes only from official sources

Allowed `sourceType` values:

| `sourceType`                | Examples                                                 |
| --------------------------- | -------------------------------------------------------- |
| `esma_register`             | ESMA interim MiCA register                               |
| `nca_register`              | ACPR, DNB, CSSF, BaFin, MFSA…                            |
| `eba_register`              | EBA PSD2/EMD2 register, EBA credit institutions register |
| `gleif`                     | GLEIF LEI API                                            |
| `issuer_official`           | Issuer's own website or press release on its domain      |
| `official_gazette_or_court` | Official journal, court or companies register            |

Third-party sources (news, blogs, aggregators, LEI lookup sites) are **leads only**. They are never stored in public data. A lead becomes evidence only after it has been confirmed in an official source.

Every evidence record carries enough for a client to re-check it:

```ts
// shape only; real code in B6.2
Evidence = {
  id: string;                  // sha256 of (issuerLei|check|sourceUrl|retrievedAt)
  issuerLei: string;
  check: "L1" | "L2" | "L3";   // see D4
  sourceType: SourceType;
  sourceUrl: string;           // exact page or API URL a person can open
  retrievedAt: string;         // ISO 8601 UTC
  method: "api" | "download" | "manual";
  contentSha256: string;       // hash of the API response, file or saved page
  matchedBy: "lei" | "national_id";
  nationalId?: string;         // e.g. CSSF W00000024, kennitala 5505121060
  observed: Record<string, string | null>; // fields as the source shows them
  result: "confirmed" | "not_found" | "mismatch" | "inactive";
}
```

For manual checks, the PDF of the page is kept privately by the maintainer. Only its hash goes in the public repository.

### D4. Verification levels

| Level  | Meaning                                                                                            | Typical source |
| ------ | -------------------------------------------------------------------------------------------------- | -------------- |
| **L1** | LEI is ISSUED in GLEIF and its legal name and country are recorded                                 | GLEIF          |
| **L2** | The entity's licence (e-money institution or credit institution) is active in an official register | EBA, NCA       |
| **L3** | An official register lists EMT issuance specifically                                               | CSSF, MFSA     |

Public output never says "verified" or "confirmed" without the level. ESMA itself remains the source of the EMT notification.

### D5. Entities are matched by LEI, then by national ID, never by name

- Match on the LEI.
- If the source has no LEI, match on the national registration ID, which is stored once confirmed.
- A different name is recorded as an alias and flagged `name_mismatch` (warning, not error).

### D6. The target is autonomous, reliable and verifiable

Automated checks need no human intervention. They run inside the daily ingest, or in a separate scheduled job when a source is slow or rate-limited. Human checks are optional: they add L3 evidence and credibility, but the system never depends on them.

| Source                                | Covers                   | Mode                                                                | When                                                                     |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GLEIF API                             | 25/25, L1                | Automated, daily                                                    | B6.2                                                                     |
| EBA PSD2 register (JSON)              | E-money institutions, L2 | Automated                                                           | After its reuse terms are confirmed                                      |
| DNB CSV, ACPR REGAFI API              | NL 3, FR 6, L2           | Automated                                                           | After their reuse terms are confirmed; the REGAFI key is a GitHub secret |
| Credit institutions not covered above | L2                       | Manual baseline once, then automated where a legitimate feed exists | B6.3                                                                     |
| CSSF, MFSA (and CNB, KNF)             | L2 and L3                | Manual only                                                         | B6.3, then optional                                                      |

Rules for automation:

- We respect robots.txt, CAPTCHAs and terms of use. **No scraping where it is disallowed.** If a source cannot be automated legitimately, its level is reached through another official source (for example the EBA for L2) or stays manual and optional.
- Each automated source is enabled only after its reuse terms have been read and recorded in `docs/sources.md`.
- A source that is unreachable does not fail the daily ingest. It records `result: "not_checked"` for that run, and after 3 consecutive days it opens an `ingest-failure` issue.

### D7. Neutral public wording, no outreach

- Public text states facts and sources only, using fixed templates. For example: "ESMA register: authorisation date 20/06/2026. BaFin register: 01/07/2025. Sources: … (checked 2026-11-11)."
- No adjectives and no conclusions about any entity.
- StableStatus does not notify ESMA, NCAs or issuers of discrepancies for now. To be revisited when StableStatus is a viable business.

## Files

```
data/evidence/evidence.jsonl      # append-only, one Evidence record per line
data/current/checks.json          # latest result per issuer: level reached, discrepancies, signals
docs/sources.md                   # every source: URL, access method, reuse terms, date read
```

`checks.json` is derived from `evidence.jsonl` and can be rebuilt from it at any time. Changes in discrepancies and signals are written to `data/changes.jsonl` like any other event (new kinds: `discrepancy_added`, `discrepancy_resolved`, `signal_added`, `signal_cleared`).

## Alternatives considered

| Alternative                                      | Why rejected                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Correct ESMA data when an NCA disagrees          | We would be asserting a fact no official source states in that form, and ESMA's record would be lost |
| Change `registerStatus` on news of liquidation   | Mixes "what the register says" with our interpretation; clients could not tell them apart            |
| Accept reputable third-party sources as evidence | Clients would have to trust our judgement instead of re-checking an official source                  |
| Scrape every NCA register                        | Breaks the terms of some registers (CSSF robots.txt, CNB CAPTCHA); legal and reputational risk       |
| Match by name                                    | Names differ across registers (Monerium, DINARO)                                                     |

## Consequences

**Positive**

- Every claim can be re-checked by a client from a URL, a date and a hash.
- Risk signals such as liquidations reach clients before the registers change, with an official source.
- Automation covers L1 for all issuers and L2 for most, without human work.

**Negative / costs**

- Two more data files and a new schema to maintain.
- L3 depends on manual checks for now, so it may be missing for most issuers.
- Credit institutions outside FR and NL may stay at L1 until a legitimate feed is found.

**Risks**

- Reuse terms of EBA, ACPR and DNB are not yet confirmed. Mitigation: no automated source goes live before its terms are recorded.
- Official sources change URLs or formats. Mitigation: per-source `not_checked` results and an alert after 3 days.

_Amendment (2026-11-11, B6.2):_

- **New discrepancy kind `country_mismatch`:** ESMA `ae_lei_cou_code` differs from GLEIF `entity.legalAddress.country`. An empty ESMA value is a data-quality issue, not a discrepancy.
- **New evidence result `not_checked`** (D3), as already required by D6. In practice it is recorded per source in `data/runs.jsonl` (`sources.gleif.status`), not as 25 evidence lines per failed run.
- **L1 (D4) requires** GLEIF `registration.status = ISSUED`, `entity.status = ACTIVE`, and a recorded legal name and country.
- **Evidence gains an optional `viewUrl`:** the source's public page for the entity. `sourceUrl` stays the exact URL whose response is hashed (for GLEIF, the batch API request).
- **Evidence is appended only when what was observed changes.** Every daily check is still recorded in `runs.jsonl` with the response hash (`contentSha256`) and a hash of the fields used, sorted by LEI and without volatile metadata (`recordsSha256`). `checks.json` is rebuilt from `evidence.jsonl`, `runs.jsonl` and the current ESMA state.
- **Alert after 3 days (D6):** for now `last-run.json` lists the source in `sourceAlerts`. Opening an issue from the workflow is a follow-up.
- **New discrepancy kind `name_format` (info):** names are compared using the ESMA `displayName` (first non-empty line of `ae_lei_name`), ignoring case, accents (NFKD without diacritics), punctuation and whitespace. If they then differ only by legal forms from a closed list (SA, S.A., SAS, SCA, B.V., GmbH, Ltd, ehf, hf., UAB, SIA, sp. z o.o., Oy, ApS, SE, d.o.o.), the kind is `name_format` (info); otherwise `name_mismatch` (warning). Both values are kept, as for any discrepancy.
- **One signal per issuer and kind (D2):** when several fields raise the same signal (e.g. `registration.status = DUPLICATE` and an `entity.status` other than `ACTIVE`), they are stored together in the signal's `observed`.

---

_StableStatus provides sourced information, not legal advice._
