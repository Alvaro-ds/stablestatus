# EBA Register under PSD2: fixtures

Extract of the real daily download of the EBA Register under PSD2 (payment and e-money institutions).

| File                                | Source URL                                                                                                 | Downloaded | Notes                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filemetadata_2026-11-12.json`      | https://euclid.eba.europa.eu/register/api/filemetadata                                                     | 2026-11-12 | Byte-exact response. `sha256_hash` refers to the full ZIP (20 MB), not to the fixture ZIP                                                                                                                                                   |
| `download-PSDMD-202611120800.zip`   | https://euclid.eba.europa.eu/register/downloads/PSDMD/20261112/download-PSDMD-202611120800.zip (extract) | 2026-11-12 | Same layout as the real ZIP (`download-PSDMD-202611120800.json` + `.json.sha256`), but the JSON keeps only 26 real entities and one agent: the issuers' entities, five entities awaiting a national ID, one withdrawn EMI (`NL_DNB!R182875`), another Monerium entity with a different LEI, an entity with a multi-language name and a payment institution |

The entity objects are copied unchanged from the 220 MB original. The JSON is re-serialised with two-space indentation and re-zipped with PowerShell `Compress-Archive`; its `.sha256` file is recomputed.

Source: EBA Register under PSD2. The EBA reproduces the information received from national competent authorities; the register has no legal significance.
