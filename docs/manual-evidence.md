# Manual evidence

Some official registers can only be checked by hand: the CSSF (robots.txt disallows automated access), the CNB (CAPTCHA), the MFSA, the KNF and others. A manual check adds L2 or L3 evidence (ADR 0003 §D4, §D6). It is optional: the automated checks never depend on it.

## 1. Check the register and save the page

1. Open the entity's page in the official register. The URL must be on a domain listed in [`docs/sources.md`](sources.md#official-domains-for-manual-evidence).
2. Note the exact URL, and the date and time of the check in UTC.
3. Save the page as PDF (browser: _Print_ → _Save as PDF_). Keep the PDF privately: only its hash goes in the public repository (ADR 0003 §D3).

## 2. Compute the hash of the PDF

PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 .\cssf-bridge-building-2026-11-12.pdf
```

Copy the `Hash` value. Upper case is fine; it is stored in lower case.

## 3. Record the evidence

Write the check to a JSON file (the field names are fixed):

```json
{
  "issuerLei": "254900MVWQXMF77YZP65",
  "check": "L3",
  "sourceType": "nca_register",
  "sourceUrl": "https://www.cssf.lu/en/entity/...",
  "retrievedAt": "2026-11-12T10:30:00Z",
  "contentSha256": "<hash of the PDF>",
  "matchedBy": "national_id",
  "nationalId": "W00000024",
  "observed": { "Status": "Authorised", "Category": "Electronic money institution" },
  "result": "confirmed"
}
```

Then run:

```powershell
pnpm evidence:add --file .\evidence.json
```

Every field can also be given as a flag, which overrides the file: `--result inactive`, `--observed '{"Status":"Withdrawn"}'`.

| Field         | Values                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `check`       | `L2` (licence active in an official register) or `L3` (the register lists EMT issuance specifically)    |
| `sourceType`  | `nca_register` or `eba_register`, as listed for the URL's domain in `docs/sources.md`                   |
| `retrievedAt` | ISO 8601 UTC, not in the future                                                                         |
| `matchedBy`   | `lei` if the page shows the LEI; otherwise `national_id`, and `nationalId` is required                  |
| `observed`    | The fields as the page shows them, copied literally. At least one                                       |
| `result`      | `confirmed`, `inactive`, `mismatch` or `not_found`. `inactive` raises a critical `nca_licence_inactive` |

The command validates the input, appends one line to `data/evidence/evidence.jsonl` with `method: "manual"`, rebuilds `data/current/checks.json`, appends any change event to `data/changes.jsonl` and, last, appends a chained `manual_evidence` line to `data/runs.jsonl` ([ADR 0005](adr/0005-integrity-record-format.md#amendment-2026-11-21-manual-evidence-records)). It rejects URLs outside the official domains, unknown issuers and duplicates, and it refuses to run (exit code 1) if `integrity:verify` already fails on the current data.

## 4. Commit and push

The daily ingest bot also appends to `data/runs.jsonl`. Keep the window between pulling and pushing as short as possible:

1. Pull right before you start:

   ```powershell
   git switch main
   git pull --ff-only
   ```

2. Run `pnpm evidence:add` (step 3) for each JSON file.
3. Check the data before committing. Both must pass:

   ```powershell
   pnpm data:validate
   pnpm integrity:verify
   ```

4. Commit and push right away:

   ```powershell
   git add data CHANGELOG-data.md
   git commit -m "chore(data): add manual evidence"
   git push
   ```

### If the push is rejected

The bot committed in between. **Do not merge or pull with a merge.** A merge would fork the chain: your `manual_evidence` line and the bot's line would both point to the same `prevEntrySha256`, and `integrity:verify` would fail in CI. Instead, discard your local data commits, update from `origin/main` and run `evidence:add` again with the same JSON files.

> **Before resetting:** `git reset --hard` discards every local commit and uncommitted change on the branch. Your evidence JSON files and PDFs live outside the repository, so they are not lost. Check with `git status` that there are no other local changes, and with `git log` that the only local commits are the data commits from this procedure. If there is anything else, stop and save it first.

```powershell
git fetch origin
git status
git log --oneline origin/main..HEAD
git reset --hard origin/main
pnpm evidence:add --file .\evidence.json
pnpm data:validate
pnpm integrity:verify
git add data CHANGELOG-data.md
git commit -m "chore(data): add manual evidence"
git push
```

`git log --oneline origin/main..HEAD` lists the local commits that the reset will discard; it must show only your data commits.

**From Sourcetree:**

1. Click **Fetch** (toolbar) to update `origin/main`.
2. Open **File Status**: it must show no uncommitted changes. In **History**, the commits above `origin/main` must be only your data commits.
3. In **History**, right-click the commit labelled `origin/main` → **Reset current branch to this commit** → mode **Hard - discard all working copy changes** → **OK**.
4. Run `pnpm evidence:add`, `pnpm data:validate` and `pnpm integrity:verify` in a terminal, then commit the changes in `data/` and `CHANGELOG-data.md` and click **Push**.

## National IDs for the EBA register

The EBA register has no LEI field, so the daily ingest finds an issuer there by national ID (ADR 0003 §D5). When the GLEIF registration number does not match the ID the EBA uses, add the ID to `data/manual/national-ids.json` after checking it in the national authority's register:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "lei": "254900MVWQXMF77YZP65",
      "caOwnerId": "LU_CSSF",
      "nationalId": "W00000024",
      "checkedAt": "2026-11-12",
      "sourceUrl": "https://www.cssf.lu/en/entity/..."
    }
  ]
}
```

`caOwnerId` is the EBA code of the authority (`LU_CSSF`, `DE_BAFIN`, `PL_PFSA`, `FR_ACPR`…). Never take the ID from a search by name in the EBA register: confirm it on a page that also shows the LEI or the company registration number.

Where to find the ID, by authority (checked on 2026-11-15):

- **CSSF (LU)**: eDesk lists one entity per licence. The e-money institution entry (`W…`) shows no LEI; the e-money token issuer entry (`N…`) of the same company does. The search results page shows both rows together.
- **BaFin (DE)**: the EBA ID is the BaFin `Bak Nr.` shown on the company database page.
- **KNF (PL)**: the EBA ID is the `NIP` shown in e-RUP, next to the `KRS`.
- **ACPR (FR)**: `ENT_NAT_REF_COD` is the SIREN and the `EntityCode` suffix is the REGAFI `id_referentiel`.

### Known data error: Société Générale - Forge

The EBA lists SG-Forge (LEI `969500FX8K40ZDW4F377`) as `FR_ACPR!737174`, with that same code in `ENT_NAT_REF_COD` instead of its SIREN. REGAFI lists the company once, as `id_referentiel` 93046 (SIREN 882696628, CIB 15883), holding both its investment firm and e-money institution licences. The ID 737174 does not appear in any REGAFI dataset or in the Wayback Machine (checked 2026-11-15), so it cannot be confirmed in an official national register and is not added to `national-ids.json`. The issuer's L2 and L3 come from manual REGAFI evidence instead; the EBA check stays unmatched for it.

---

_StableStatus provides sourced information, not legal advice._
