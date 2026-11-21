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

## Amendment (2026-11-21): manual evidence records

**Why.** `pnpm evidence:add` changes three files covered by `stateSha256`
(`data/evidence/evidence.jsonl`, `data/current/checks.json` and, when there are
events, `data/changes.jsonl`) but did not append to `runs.jsonl`. After a manual
check, `integrity:verify` failed, and the change stayed outside the chain until
the next ingest, whose line would have covered it as if the ingest had made it.
Rule: **every change to the published state is a line in the chain.**

**Format.** `evidence:add` appends one line per evidence, chained exactly like an
ingest line (D2–D4):

```json
{
  "kind": "manual_evidence",
  "at": "2026-11-21T10:00:00.000Z",
  "evidenceIds": ["<id of the evidence added>"],
  "events": 1,
  "critical": 1,
  "stateFiles": [{ "path": "data/changes.jsonl", "sha256": "…" }],
  "stateSha256": "…",
  "prevEntrySha256": "…",
  "entrySha256": "…"
}
```

- `at` is when the command ran, not the evidence's `retrievedAt`.
- `kind` tells it apart; ingest lines keep having no `kind`. `RunRecordSchema` is
  the union of both, so every existing line still validates unchanged.
- All chain fields are required on this kind.

**Order.** `evidence:add` first runs the verifier on the current data and stops
with exit code 1 if it fails, so nothing is chained on top of a broken state.
It then computes every new file and the line in memory, writes the three files
(`.tmp` + rename) and appends the line last. If it dies between the renames and
the append, the verifier fails on the last line; restore `data/` with Git and
run it again.

**Not a run.** A manual evidence line counts for no gate and no source check:
`gate:check` ignores it (it only prints how many there are), and
`sourceLastCheckedAt` / `sourceNeedsAlert` never see it because it has no
`sources`. `data:validate` still requires `at` to never decrease across all
lines.

**Forks.** If two people append on the same previous line and the branches are
merged, both lines share a `prevEntrySha256`. The verifier rejects the second
one (`prevEntrySha256 does not match`), so `integrity:verify` in CI catches the
fork; `data:validate` does not repeat that check. See
[`docs/manual-evidence.md`](../manual-evidence.md) for how to avoid it.

---

_StableStatus provides sourced information, not legal advice._
