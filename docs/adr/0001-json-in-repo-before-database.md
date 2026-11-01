# ADR 0001 — Versioned JSON in Git Instead of a Database (Phases 1–2)

**Date:** 2026-11-01
**Status:** Accepted

---

## Context

StableStatus is a solo project with no funding, a 10–15 h/week budget, and a
hard public deadline of 8 January 2027. The product is an open dataset: a set
of JSON snapshots that map stablecoin issuers and contract addresses to their
MiCA regulatory status.

The data changes at most once a day (driven by the ESMA register update
cadence). There are no concurrent writes, no user-submitted data, and no
relational queries in Phases 1–2. The primary access pattern is "download the
latest snapshot" or "diff two snapshots".

Reliability and auditability of the regulatory data are the core value
propositions. Every change to the dataset must be traceable to a specific
source, date, and hash.

---

## Decision

In Phases 1 and 2, data is stored as versioned JSON files in the `data/`
directory of this git repository, not in a database.

The git history serves as the immutable audit trail: every change is a commit
with a timestamp, the previous state is always recoverable, and diffs are human-
readable. GitHub Actions provides the scheduled ingest pipeline for free on a
public repository.

---

## Alternatives Considered

**Supabase (free tier) from day one.**
Would add infrastructure complexity, a network dependency for every ingest run,
and a migration step anyway. The free tier has row-count and bandwidth limits
that could become a constraint before Phase 3 revenue arrives.

**Neon (free tier) from day one.**
Same reasoning as Supabase. Also requires writing and maintaining a schema and
migration tooling before any data exists to query.

**SQLite file in the repo.**
Binary format, not human-readable in diffs, no GitHub preview, harder to
consume without tooling. JSON in git is simpler and serves the same purpose
for this data volume.

---

## Consequences

- **Positive:** Zero infrastructure cost. Git history is the audit log. Data is
  immediately inspectable on GitHub. No schema migration needed in Phases 1–2.
  Consumers can `git clone` and have the full history.
- **Negative:** No SQL queries against the data in Phases 1–2 (not needed).
  Must migrate to PostgreSQL in Phase 3 when the API requires relational queries
  and the data volume exceeds what is practical in a git repo.
- **Migration:** Phase 3 will add a PostgreSQL database (Supabase or Neon) and
  a one-time import of the JSON snapshots. The JSON files remain in the repo as
  the canonical, auditable record.
