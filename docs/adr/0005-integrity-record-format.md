# ADR 0005 — Integrity Record Format for `runs.jsonl`

**Date:** 2026-11-17
**Status:** Accepted (2026-11-17)
**Related:** ADR 0002 (data model, `runs.jsonl`), ADR 0003 (evidence)

---

## Context

`data/runs.jsonl` records every successful ingest run (ADR 0002). Today anyone
with write access could edit or delete a line, or change a file in
`data/current/` after a run, and nothing would show it. Clients and the public
website must be able to check, on their own, that the run history and the
published data have not been altered after they were written. The website only
**verifies**; it never computes the chain itself.

## Decision

### D1. Canonical JSON is RFC 8785 (JCS)

Object keys are sorted by UTF-16 code units (the default order of
`Array.prototype.sort`) and every primitive is serialised with
`JSON.stringify`, which is exactly how JCS defines its serialisation. No
whitespace. Our records only hold strings, integers, booleans and `null`.

### D2. State hash

At the end of each successful run, after every rename and append:

```ts
stateFiles = [{ path, sha256 }]; // sorted by path
stateSha256 = sha256(JCS(stateFiles));
```

- `path` is relative to the repository root with `/` separators, e.g.
  `data/current/issuers.json`.
- Files included: `data/current/*.json`, `data/changes.jsonl` and
  `data/evidence/evidence.jsonl`. A file that does not exist is not listed.
- `sha256` is over the exact bytes (LF line endings are enforced by
  `.gitattributes`).
- Out of scope: `CHANGELOG-data.md` and `data/last-run.json` (derived) and
  `data/raw/` (already hashed in each `manifest.json`).

`stateFiles` is stored in the line so a verifier can tell which file changed.

### D3. Chain link

Each new line carries:

- `prevEntrySha256`: the `entrySha256` of the previous chained line.
- `entrySha256`: `sha256(JCS(line without entrySha256))`.

The hash is computed over the **raw parsed JSON** of the line, not over the
object returned by zod: zod strips unknown keys, which would let extra fields
slip in without breaking the hash.

### D4. Genesis

Old lines have none of these fields and are **never modified**. The first
chained line has `chainGenesis: true` and
`prevEntrySha256 = sha256(exact bytes of runs.jsonl before it was appended)`,
which anchors the whole earlier history. Verifier rules: at most one genesis, it
must be the first chained line, and no unchained line may follow it.

### D5. Verifier

`verifyChain(lines, files?)` lives in `src/integrity/`, depends only on Web
Crypto (`crypto.subtle`) so the website can copy the module unchanged, and is
therefore `async`. It returns `{ ok: true }` or
`{ ok: false, line, reason }` with the first broken line (1-based). With
`files`, it also recomputes the last line's `stateSha256` and names the file
that differs. `pnpm integrity:verify` runs it on `data/` and exits 0 or 1.

### D6. Schema

The new fields are optional in `RunRecordSchema`, so old lines still validate.
If a line has `entrySha256`, then `prevEntrySha256`, `stateSha256` and
`stateFiles` are required.

## Alternatives considered

| Alternative                     | Why rejected                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Hash the raw bytes of each line | Depends on `JSON.stringify` key order; other implementations cannot rebuild it |
| Merkle tree                     | Unneeded for a linear, append-only list                                        |
| Rewrite old lines with hashes   | Breaks the append-only rule                                                    |
| `node:crypto` in the verifier   | The website could not reuse the module as is                                   |

## Consequences

**Positive**

- Editing or deleting a line, or changing published data after a run, is
  detected by CI on every human push and by anyone who runs the verifier.

**Negative / limits**

- Anyone with write access (the maintainer, the ingest workflow token, or a
  compromised action or dependency running in it) can rewrite the whole chain
  consistently. Truncating the tail and reverting the data is also not
  detected. Both need an external anchor (OpenTimestamps or similar), planned
  as a follow-up, or third parties keeping a past `entrySha256`.
- Changes that keep the JSON semantics (whitespace, `0` vs `0.0`) do not break
  the hash, by design.
- Ingest does not verify the chain before appending; CI does.

**Mitigations in place**

- A repository ruleset on `main` blocks force pushes and branch deletion
  (admins can bypass).

---

_StableStatus provides sourced information, not legal advice._
