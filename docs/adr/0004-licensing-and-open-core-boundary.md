# ADR-0004: Licensing and the open/private boundary (open core)

- **Status:** Accepted (2026-11-19)
- **Date:** 2026-11-17
- **Related:** ADR-0002 (data model), ADR-0003 (evidence), ADR-0006 (contract address model, private repository)

## Context

- The `stablestatus` repository has been public since 1 Nov 2026: MIT for code, CC BY 4.0 for data. Anything already published under those licences stays available under them to whoever copied it.
- On 13 Nov we chose an **open core** model. Whatever comes from public official sources is open and verifiable. Whatever adds our own verification work and service is private and paid.
- On 15 Nov we decided to submit **only the public part** to NGI Zero. NLnet requires everything it funds to be released under a free licence.
- Source reuse conditions (read on 11 Nov):
  - **ESMA:** reproduction authorised with attribution and a notice that the material was transformed. When it is included in something sold, the buyer must be told it is available free of charge on ESMA's website.
  - **EBA:** reproduction authorised with attribution.
  - **GLEIF:** CC0 data; suggesting any association with GLEIF is not allowed.
  - **DNB:** no published conditions; attributed as "DNB public register".
- Customers do not pay for ESMA data, which is public. They pay to **be able to defend a control before their supervisor**: verified contract mapping, a decision API, immediate alerts and evidence packs.

## Decision

### D1. Open part: the `stablestatus` repository (licences unchanged)

- **Code:** MIT. **Data:** CC BY 4.0.
- **It holds everything that works at issuer level from public official sources:**
  - ESMA ingestion and normalisation;
  - L1, L2 and L3 checks (GLEIF, EBA, national registers);
  - evidence, signals and discrepancies;
  - history (`changes.jsonl`, `runs.jsonl`) and the integrity chain (ADR-0005).
- This is the part submitted to NGI Zero.

### D2. Private part: the `stablestatus-mapping` repository (all rights reserved)

- **It holds:**
  - per-chain contract mapping (ADR-0006) and its confidence levels;
  - issuer confirmations;
  - contract discovery rules and queries;
  - later, the decision API, the customer dashboard, immediate alerts and evidence packs.
- **No public licence.** Customers get access by contract. API terms are reviewed with the lawyer before charging.

### D3. Dependency direction

- **The private repository may read the public one; the public one never depends on the private one**, in code or in data.
- `stablestatus-mapping` reads issuer and white-paper data from the published `stablestatus` JSON files (HTTPS, checking `schemaVersion`). It copies no code from the public repository except the schemas, stating their origin, as the website already does.
- **No contract addresses, tokens or issuer confirmations go into the public repository.** This rule is added to `CLAUDE.md` in both repositories.

### D4. The website (`stablestatus-web`, private)

- It shows the public data and its download (with sign-up) freely, as already decided.
- **How mapping data is shown is a pricing decision (phase 4).** For example: free single lookups on the website and API; full download and history paid. Until then the website only announces the mapping as "coming soon".

### D5. Mandatory attributions and notices

| Where                              | Text                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website, public data and changelog | "This document has been drafted using material downloaded from ESMA's website. ESMA does not endorse this publication…" + "EBA Register under PSD2" + "DNB public register" + GLEIF data without suggesting association |
| Terms of any paid product          | "ESMA register data is available free of charge on ESMA's website"                                                                                                                                                      |
| Every public text                  | "Information with sources, not legal advice"                                                                                                                                                                            |

### D6. External contributions to the public repository

Accepted under the same licences (MIT for code, CC BY for data). No CLA. Data contributions must follow ADR-0003: official sources only.

## Alternatives considered

| Alternative                                              | Why rejected                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Everything open                                          | Nothing to sell. Verified mapping, the costly part, would be free for any competitor                                                                                                                   |
| Everything private                                       | Loses public verifiability (the trust argument), NGI Zero and the free funnel. What is already published stays MIT anyway                                                                              |
| CC BY-NC data + commercial licence (OpenSanctions model) | Valid, but today's public data is issuer-level and almost all of it is already on ESMA's website. Restricting it adds little and complicates NGI. Can be reconsidered if the mapping is ever published |
| AGPL code                                                | Discourages offering it as a service, but the value lies in verified data and the service, not in the ingestion code                                                                                   |

## Consequences

**Pros**

- The part that builds trust is open and anyone can verify it. The part that costs work to maintain is private and sellable.
- Fits NGI Zero (public part only) and the official sources' conditions.

**Cons / costs**

- Two data repositories with different rules, and a `CLAUDE.md` in each to enforce them.
- We must make sure no contract address ends up in the public repository.

**Risks**

- A competitor may reuse the public issuer data. Mitigation: the differentiating value is the mapping and the service, which are private.
- Commercial terms do not exist yet. Mitigation: review with the lawyer before phase 4.

_StableStatus provides information with sources, not legal advice._
