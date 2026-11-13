# Data License

## 1. Licence and licensor

© 2026 Álvaro Dapena Salinas (StableStatus)

Data produced by StableStatus is published under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** licence.
Legal code: https://creativecommons.org/licenses/by/4.0/legalcode

---

## 2. Scope

**Licensed under CC BY 4.0** (data produced by StableStatus):

- `data/current/` (normalised issuers, white papers, checks and metadata)
- `data/changes.jsonl` (append-only change history)
- `data/evidence/` (recorded evidence)
- `data/runs.jsonl` (ingest run log)
- `data/raw/*/manifest.json` (daily manifests with source URLs and hashes)
- `CHANGELOG-data.md`

**Original third-party files** in `data/raw/` (ESMA CSV files, GLEIF API responses, EBA and DNB register extracts) are redistributed unmodified under the terms of each source (section 4). They are **not** relicensed under CC BY 4.0.

**Not included in this dataset:** contract addresses, on-chain token mapping, per-token trust levels and issuer confirmations of addresses.

---

## 3. How to attribute

Suggested attribution:

> Source: StableStatus (https://stablestatus.org), CC BY 4.0. Includes data from ESMA, GLEIF, the EBA and DNB.

Under section 3(a)(1)(A)(i) of CC BY 4.0, the licensor designates ESMA, the EBA and DNB as parties to receive attribution, in addition to StableStatus.

---

## 4. Source terms

### ESMA

Source: Interim MiCA Register, https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica (section "Interim MiCA Register").
Legal notice: https://www.esma.europa.eu/about-esma/legal-notice-and-data-protection

Data in this repository has been transformed from material published by ESMA. As required by the ESMA legal notice:

> ‘This document has been drafted using material downloaded from ESMA’s website’

> ESMA does not endorse this publication and in no way is liable for copyright or other intellectual property rights infringements nor for any damages caused to third parties through this publication

Reproduction of ESMA material is authorised provided the source is acknowledged. If this data is included in anything that is sold, buyers must be told that the original material can be obtained free of charge from the ESMA website. The ESMA logo is not used in this project.

### GLEIF

LEI data is published by the Global Legal Entity Identifier Foundation (GLEIF) under CC0 1.0, as set out in the LEI Data Terms of Use: https://www.gleif.org/en/meta/lei-data-terms-of-use

StableStatus and its data, other than the original LEI data, are not provided or endorsed by GLEIF or any LEI issuing organisation (LOU), nor associated with them. The GLEIF trademark and logo are not used in this project.

### EBA

Source: EBA Register under PSD2 (https://euclid.eba.europa.eu/register/pir/registerDownload). Reproduction is authorised provided the source is acknowledged. Attribution: "Source: EBA Register under PSD2". The register has no legal significance: the accuracy of the information is the responsibility of each national competent authority.

### DNB

Source: De Nederlandsche Bank public register, e-money institutions (https://www.dnb.nl/en-GB/registerdownload/csv/WFTEG). DNB publishes no reuse terms for this download. Attribution: "Source: DNB public register".

### DTI codes

Digital Token Identifier (DTI) codes are taken as they appear in the ESMA register. This repository does not include data from the DTI Foundation registry (tickers, names or other fields). The DTI Foundation's terms apply to its registry, not to these codes as published by ESMA.

---

## 5. No endorsement

Nothing in this repository implies that ESMA, GLEIF, the EBA, DNB or any other authority endorses StableStatus.

---

## 6. Recommendations (not licence conditions)

These are recommendations only. They are not conditions of the licence and do not add to the obligations of CC BY 4.0:

- link to this file when redistributing the data;
- always verify regulatory status in the ESMA register and in the register of the relevant national competent authority.

---

## 7. Disclaimer

This data is provided for information only and is not legal advice. See [DISCLAIMER.md](DISCLAIMER.md).
