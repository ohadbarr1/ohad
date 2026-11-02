Synthetic clearing-house files for `tests/maslaka.unit.ts`, `tests/import.unit.ts` and the visual check of `/my` (W3, W7). **Fixtures,
not real data:** every person, number and amount is invented; the structure follows the regulator's holdings-interface schema v008
(gov.il, `MivneAchid_Holdings_Excel_008.xlsx`; see `src/lib/maslaka.ts`) and the shape of version-009 files. The companies'
registration numbers and the fund numbers are public (data.gov.il) so the matcher can find fox tracks.

- `fixture-pension.xml` · מנורה: two pension accounts (one with deposit rows, insurance track and pension covers) and a risk policy.
- `fixture-mor.xml` · מור: a study fund, a provident fund, one fund not in the data.
- `fixture-bituach.xml` · מגדל: a managers' insurance policy with a guaranteed coefficient, covers with cost, salary-month deposits and a
  transfer row; a mortgage risk policy.
- `fixture-plain.zip`, `fixture-zipcrypto.zip` (password `fox-2026`, written by `/usr/bin/zip -e`), `fixture-aes.zip` (AES-256, password
  `fox-2026`, written by zip.js), `fixture-nested.zip` (a plain zip holding the ZipCrypto zip): the pension and insurance XMLs plus a
  stand-in PDF and Excel. Regenerate with `node scripts/maslaka-fixtures.mjs` after changing the XMLs.
- `harb-sample.csv` · an invented הר הביטוח export in the shape secondary descriptions give (no real export was available to copy).
