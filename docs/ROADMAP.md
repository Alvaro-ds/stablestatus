# StableStatus — Roadmap

## Phase 0 — Validation (2–15 Nov 2026)

Set up the public repository, licences, CI pipeline, and real ESMA fixtures.
Confirm the technical approach and validate interest with potential CASP clients.

**Exit gate:** Repository is public, CI is green, ESMA fixture is committed and
hash-verified.

---

## Phase 1 — ESMA Ingest & Issuer List v0 (16 Nov – 6 Dec 2026)

Build the daily GitHub Actions workflow that downloads the ESMA interim MiCA
register CSV files, parses and normalises them, and publishes a versioned JSON
snapshot to `data/`. Produce the first public issuer list (EMT + ART).

**Exit gate:** Daily ingest runs **7 consecutive days without a single failure**.
Any schema change in the ESMA CSV causes the workflow to fail with a clear error
(never silently publishes corrupt data).

---

## Phase 2 — On-Chain Mapping & Contract List v1 (7 Dec 2026 – 3 Jan 2027)

Map each authorised issuer to its deployed stablecoin contracts on every
relevant chain (EVM chains via viem, Solana via @solana/web3.js). Assign a
trust level (`verified`, `probable`, `bridged`, `imitation`) to each address.
Publish the first versioned contract list in `data/`.

**Exit gate:** Contract list v1 is published before **8 January 2027**.
This is the critical customer-facing deadline.

---

## Phase 3 — API, SDK & Dashboard (4–31 Jan 2027)

Build the public REST API (Next.js App Router on Vercel), the TypeScript SDK,
and the web dashboard. Migrate the JSON data store to PostgreSQL (Supabase or
Neon). Add Upstash Redis for rate limiting.

**Exit gate:** API is live, SDK is published to npm, dashboard is accessible.

---

## Phase 4 — Launch & Monetisation (1 Feb – 7 Mar 2027)

Onboard paying CASP customers, set up billing, and publish the pricing page.

**Exit gate:** First paying customer.

---

## Phase 5 — Oracle on Base & Other Jurisdictions (when clients request it)

Deploy a Solidity oracle contract on Base that exposes on-chain MiCA status
for composable DeFi use cases. Extend coverage to non-EU jurisdictions
(UK FCA, Swiss FINMA, etc.).

**Entry condition:** Only when existing clients explicitly request it.
Smart contracts are audited externally before any mainnet deployment.
