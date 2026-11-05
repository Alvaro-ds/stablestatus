# ESMA Fixture Files

These files are byte-exact copies of CSV files downloaded from the ESMA interim
MiCA register. They are stored as binary in git (see `.gitattributes`) to
preserve the original BOM and CRLF line endings required by the parser tests.

## Files

| File                   | Source URL                                                       | Downloaded | SHA-256                                                            | Notes                                              |
| ---------------------- | ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| `EMTWP_2026-10-30.csv` | https://www.esma.europa.eu/sites/default/files/2024-12/EMTWP.csv | 2026-10-30 | `f7fb1c594f0374dc16171ac15d4f5db773bf84b1b495e6b3640bdc2a718a4484` | 50 data rows, 25 issuers                           |
| `ARTZZ_2026-11-04.csv` | https://www.esma.europa.eu/sites/default/files/2024-12/ARTZZ.csv | 2026-11-04 | `fa1ef4da123e3d49642c69f90a81a88f6c2cc2a0b9471b2108e4dfc635ca7c67` | Header only (no ART issuers yet); uses LF not CRLF |

## Encoding

All ESMA CSV files use:

- **UTF-8 with BOM** (`\xEF\xBB\xBF` prefix)
- **CRLF line endings** (`\r\n`)
- **Comma delimiter** with RFC 4180 quoting

## Adding New Fixtures

When adding a new fixture snapshot:

1. Download the file (do not modify it).
2. Compute its SHA-256: `Get-FileHash <file> -Algorithm SHA256` (PowerShell)
   or `sha256sum <file>` (Linux/macOS).
3. Add a row to the table above with the filename, source URL, download date,
   and SHA-256.
4. Commit it — git stores it as binary, preserving bytes exactly.
