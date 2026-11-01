# StableStatus

> **Information only — not legal or investment advice. [See DISCLAIMER.md](DISCLAIMER.md)**

---

StableStatus is an open dataset and API that maps every stablecoin contract —
by chain and address, including bridged and wrapped versions — to its regulatory
status under the EU's Markets in Crypto-Assets Regulation (MiCA): whether it
is an authorised EMT or ART, who issues it (LEI), which national authority
supervises it, the white paper URL, and the ESMA DTI/FFG codes from the interim
MiCA register.

**Target users:** exchanges, wallets, and other Crypto-Asset Service Providers
(CASPs) that need per-contract compliance data to meet MiCA obligations.

---

## The Problem

On **8 October 2026**, ESMA published its opinion clarifying that CASPs must
cease all services involving non-compliant stablecoins. The hard deadline is
**8 January 2027**. Compliance requires identifying, contract by contract and
chain by chain, whether each token is covered by a valid MiCA authorisation.

---

## Why the ESMA Register Is Not Enough

The [ESMA interim MiCA register](https://www.esma.europa.eu/databases-library/registers-and-data/mica-register)
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

| Version | Description | Target |
|---------|-------------|--------|
| v0 | Issuer list from ESMA register (EMT + ART) | Nov 2026 |
| v1 | Verified contract addresses per issuer and chain | **Before 8 Jan 2027** |
| v1.1 | REST API + SDK | Jan 2027 |
| v1.2 | Web dashboard | Jan 2027 |

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full phased roadmap.

---

## Trust Model

Each contract address carries one of four trust levels:

| Level | Meaning |
|-------|---------|
| `verified` | Issuer's official source confirms the address **and** on-chain data matches |
| `probable` | On-chain data matches the issuer profile, but issuer confirmation is pending |
| `bridged` | A third-party bridged/wrapped version; the original issuer's MiCA obligations do not apply |
| `imitation` | Uses the same ticker as an authorised token but belongs to a different issuer |

---

## Data Sources & Licenses

| Source | Used for |
|--------|---------|
| [ESMA Interim MiCA Register](https://www.esma.europa.eu/databases-library/registers-and-data/mica-register) | Authorisation status, issuer LEI, white papers, DTI codes |
| [DTI Foundation](https://dtif.org) | Digital Token Identifier codes |
| Public blockchain RPC / explorers | Contract addresses, on-chain verification |
| Issuer official sources | Address confirmation for `verified` level |

- **Code** — [MIT License](LICENSE)
- **Data** (`data/`) — [CC BY 4.0](LICENSE-DATA.md), with mandatory ESMA and DTI Foundation attributions
- **Disclaimer** — [DISCLAIMER.md](DISCLAIMER.md)

Data derived from ESMA material is published in accordance with ESMA's reuse
policy. This project is not endorsed by ESMA. See [LICENSE-DATA.md](LICENSE-DATA.md)
for full attribution requirements.
