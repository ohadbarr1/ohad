# הר הביטוח fixtures (SYNTHETIC)

fox 3.0 A6. Every file here is **synthetic**: made by hand for the tests of `src/lib/harb.ts` / `src/lib/harbRisk.ts`, never exported
from harb.cma.gov.il. The column headers are the field names of the CMA circular that defines what the site holds per policy
(חוזר ביטוח 2016-1-17 "ממשק אינטרנטי לאיתור מוצרי ביטוח", as amended by 2022-1-15; see `docs/harb-format.md`); the real export's
headers, file type and encoding are NOT known. ID numbers (000000018, 000000026) and policy numbers are invented.

- `harb-circular.csv`: UTF-8 with BOM, comma-separated, a title and an as-of line above the header; two insured persons; a
  duplicate row; ddmmyyyy and dd/mm/yyyy dates; a premium-type column (monthly / annual); designed to raise the risk flags.
- `harb-codes-1255.csv`: windows-1255, semicolon-separated, branch / product-type / class as the circular's numeric codes, an
  annual-premium header, one unknown code.
- `harb-table.xls`: an HTML table saved as .xls, with a period column ("from - to") and a totals line.
- `harb-biff.xls`: only the OLE2 signature of a binary Excel 97–2003 file: the reader must refuse it with a clear message.
