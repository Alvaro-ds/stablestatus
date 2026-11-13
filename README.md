# StableStatus

> **Information only — not legal or investment advice. [See DISCLAIMER.md](DISCLAIMER.md)**

---

StableStatus tracks the regulatory status of stablecoin issuers under the EU's
Markets in Crypto-Assets Regulation (MiCA): whether an issuer has an authorised
EMT or ART, its LEI, which national authority supervises it, its white papers,
and the ESMA DTI/FFG codes from the interim MiCA register.

**Target users:** exchanges, wallets, and other Crypto-Asset Service Providers
(CASPs) that need sourced MiCA status data.

---

## What's open

This repository contains the ingest pipeline and the public issuer-level data:
ESMA, GLEIF, EBA and DNB data, L1/L2 checks, evidence, change history and run log.
Contract mapping (addresses per chain, per-token trust levels) and the API are
not part of this repository.

---

## The Problem

On **8 October 2026**, ESMA published its opinion clarifying that CASPs must
cease all services involving non-compliant stablecoins. The hard deadline is
**8 January 2027**. Compliance requires identifying, contract by contract and
chain by chain, whether each token is covered by a valid MiCA authorisation.

---

## Why the ESMA Register Is Not Enough

The [ESMA interim MiCA register](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)
is the primary source of authorisation data, but it does not map to on-chain
contracts. Four gaps make it insufficient on its own:

- **No contract addresses.** The register lists DTI codes, not EVM/Solana
  addresses. DTI-to-address resolution requires additional work.
- **Most EMT white papers have no DTI.** Over 50% of entries in the EMT white
  paper file (`EMTWP.csv`) contain no DTI code, making automated resolution
  impossible without secondary sources.
- **Same ticker ≠ same issuer.** For example, `EURR` appears in the register
  for both StablR and Bridge Building (Revolut's entity). Filtering by ticker
  alone is unreliable.
- **Bridged tokens are invisible.** Cross-chain bridged or wrapped versions of
  authorised tokens carry none of the issuer's obligations and appear in no
  register. They must be tracked separately.

---

## Public Roadmap

| Version | Description                                | Target                               |
| ------- | ------------------------------------------ | ------------------------------------ |
| v0      | Issuer list from ESMA register (EMT + ART) | Nov 2026                             |
| v1      | Contract addresses per issuer and chain    | Planned, not part of this repository |
| v1.1    | REST API + SDK                             | Planned, not part of this repository |
| v1.2    | Web dashboard                              | Planned, not part of this repository |

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full phased roadmap.

---

## Daily Ingest

A GitHub Actions workflow ([`.github/workflows/ingest.yml`](.github/workflows/ingest.yml)) runs every day at **06:17 UTC**:

1. Runs the test suite. If any test fails, nothing is ingested.
2. Downloads `EMTWP.csv` and `ARTZZ.csv` from the ESMA interim MiCA register, normalises them and compares them with the previous state.
3. Commits the result as `chore(data): daily ESMA ingest YYYY-MM-DD` (with `[critical: N]` when critical changes are detected). Only `data/` and `CHANGELOG-data.md` are committed.

Where the data lives:

| Path                   | Content                                                 |
| ---------------------- | ------------------------------------------------------- |
| `data/current/`        | Current normalised state (issuers, white papers, meta)  |
| `data/changes.jsonl`   | Append-only history of every change                     |
| `data/raw/YYYY-MM-DD/` | Daily manifest with hashes; raw CSVs when they change   |
| `CHANGELOG-data.md`    | Human-readable changelog generated from `changes.jsonl` |

Alerts are GitHub issues, so maintainers get them by email:

- `ingest-failure`: opened when the run fails (later failures add a comment) and closed automatically on the next successful run.
- `critical-change`: opened when the register shows a withdrawal, a delisting or the first ART authorisation, with the critical events and a link to the commit.

The workflow can also be started by hand (`workflow_dispatch`); the `simulate_failure` input makes it fail on purpose to test the failure alert. `pnpm gate:check` reports how many consecutive days had a scheduled GitHub Actions run, read from `data/runs.jsonl` (one append-only line per successful run, with its runner and trigger). Manual and local runs are listed but never counted.

Caveats: GitHub may delay scheduled runs by several minutes, and it disables scheduled workflows in repositories with no activity for 60 days. The daily data commits keep the repository active, but this should be monitored.

---

## Data Sources & Licenses

| Source                                                                                                                                         | Used for                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [ESMA Interim MiCA Register](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica) | Authorisation status, issuer LEI, white papers, DTI codes      |
| [GLEIF LEI data](https://www.gleif.org/en/meta/lei-data-terms-of-use)                                                                          | LEI status, legal name and national registration ID (L1 check) |
| [EBA Register under PSD2](https://euclid.eba.europa.eu/register/pir/registerDownload)                                                          | E-money institution licence status (L2 check)                  |
| [DNB public register](https://www.dnb.nl/en-GB/registerdownload/csv/WFTEG)                                                                     | E-money institution licence status for NL issuers (L2 check)   |
| DTI codes as published in the ESMA register                                                                                                    | Digital Token Identifier codes                                 |

- **Code** — [MIT License](LICENSE)
- **Data produced by StableStatus** — [CC BY 4.0](LICENSE-DATA.md), with source attributions (ESMA, GLEIF, EBA, DNB)
- **Original files in `data/raw/`** — under the terms of each source (see [LICENSE-DATA.md](LICENSE-DATA.md))
- **Disclaimer** — [DISCLAIMER.md](DISCLAIMER.md)

Data derived from ESMA material is published in accordance with ESMA's reuse
policy. This project is not endorsed by ESMA. See [LICENSE-DATA.md](LICENSE-DATA.md)
for full attribution requirements.
