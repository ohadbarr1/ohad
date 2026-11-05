# הר הביטוח: the file the agent imports (fox 3.0 A6)

Checked 06.11.26. Code: `web/src/lib/harb.ts` (reader), `web/src/lib/harbRisk.ts` (the folder's risk side), `web/src/lib/harbTypes.ts`
(what is stored), `web/src/components/agent/RiskSide.tsx`, `web/src/components/agent/ClientImport.tsx`. Tests: `npm run test:harb`.

## Bottom line

- **What the site holds per policy is documented** in a primary source: the CMA circular that set up הר הביטוח.
- **The file the holder downloads is not documented anywhere public.** No column headers, file type or encoding were found.
  `harb.cma.gov.il` answers HTTP 403 to anything but a signed-in browser (and fox does not sign in or evade that).
- So the reader matches **header names** (synonyms of the circular's field names), never column positions, and every read says
  it is unverified against a real export until one is checked.

## Primary sources

1. חוזר ביטוח **2022-1-15**, "ממשק אינטרנטי לאיתור מוצרי ביטוח" (21.9.2022, in force 1.2.2023): amends חוזר **2016-1-17**
   (31.10.2016) and reprints it in full with the changes marked.
   https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice-2022-1-15/he/regulation%20_%202022-1-15_highlighted_pdf.pdf
   §3(א): what each insurer reports to the CMA for every active product. (1) the insured's ID number; (2) the policy number;
   (3) the product type; (4) the insurance domain (ביטוח כללי, ביטוח בריאות, ביטוח חיים); (5) personal or group; (6) start date;
   (7) end date; (8) "סך דמי הביטוח השנתיים שצפויים להשתלם עבור שנת ביטוח; בביטוחים שבהם דמי הביטוח נגבים באופן חודשי, דמי
   הביטוח שהיו צפויים להשתלם בגין החודש שקדם ליום הדיווח"; (9) the premium type (annual or monthly); (10)–(11) minor or adult;
   (12)–(15) nursing-care benefit details; (16) motor details. Reported monthly (life: by the 15th).
   The 2022 amendment also lets an insurance agent's appointed viewers see candidates' data on the site (§5א), in the joining
   process of חוזר 2016-1-7.
2. The draft of the same circular, **2015-277** (31.8.2016), whose annex gives the reporting file itself:
   https://www.gov.il/BlobFolder/dynamiccollectorresultitem/regulation-2834/he/regulation_th_2015-277.pdf
   CSV, comma-delimited, file name `HB_<company no.>_<main branch>_<secondary branch>_<yyyy_mm_dd_hh>.csv`; fields: ID (N9), policy
   number (A20), annual premium paid (N9.2), start date (N8, ddmmyyyy), end date (N8), plan number in אותות, domain (N1),
   classification (N1), plan type (N1), main branch (N2), secondary branch (N2). Code tables: 603 main branch, 617 secondary branch,
   602 plan type, 300 domain, 619 classification (copied into `lib/harb.ts`: `CODE_MAIN`, `CODE_SUB`, `CODE_PTYPE`, `CODE_DOMAIN`,
   `CODE_CLS`). The 2022 amendment says the reporting codes were refined, so the reader prefers text and uses the tables only for a
   bare number, and says "קוד N" for a code it does not know.
   Its explanatory notes give the purpose: missing information "מהווה גורם משמעותי ביצירת מצב של ביטוחי כפל וגביה עודפת של
   פרמיות הביטוח". That is what the risk side checks.

These describe the insurer → CMA feed, not the holder's download. They fix *which* fields can appear and what they mean (notably:
the premium can be annual or monthly, per policy, with a type field), not the headers the download prints.

## Not found

- A gov.il / כל זכות page or user guide describing the download (columns, xlsx vs xls vs csv, encoding).
- Secondary pages (e.g. bituch.co.il/bdika/har-habituach, erenfeld-ins.co.il) describe a screen with an "export to Excel" button and
  a table with insurer, branch, policy number, period and premium; none shows the headers, and they disagree on monthly vs annual.

## What the reader does about it

- Containers: `.xlsx` (zip of XML, through lib/zipRead + lib/maslaka's XML tree), an HTML table saved as `.xls` (common for
  government "Excel" exports), CSV / TSV / semicolon CSV, UTF-8 (BOM or not), UTF-16 LE or windows-1255. A binary `.xls`
  (Excel 97–2003) is refused with "save as .xlsx or CSV": no spreadsheet library is installed (`xlsx` / `exceljs` are not in
  node_modules) and none was added.
- Header row: the first of the first 30 rows with ≥ 2 recognised headers; title and "as of" lines above it are allowed.
- Dates: dd/mm/yyyy, dd.mm.yyyy, dd/mm/yy, yyyy-mm-dd, ddmmyyyy (the circular), yyyymmdd, Excel serials, and a "from – to" period.
- Premium period: a premium-type column per row, else "שנתית"/"חודשית" in the premium's header, else unknown (shown, not summed).

## Privacy

Stored in the folder per policy (`lib/harbTypes` RiskMeta): company, branch, domain, product type, personal/group, dates, premium and
its period, the cover category, the last four characters of the policy number, and an insured ordinal (1, 2, …) when the file has
an insured column. Never stored: ID numbers, names, the full policy number. The file itself is not kept.

## QA with a real file (open)

1. Download from harb.cma.gov.il (an agent's own policies are enough) via the screen's export button; note the file type.
2. Drop it on `/clients/new` (or "הוספת קובץ מהר הביטוח" in a folder on `/clients`).
3. Check: the header row is found; every column the file has is mapped (`harbRows(...).cols`); premiums and their period are right;
   dates are right; company names shorten well; nothing ID-shaped is stored.
4. Then replace the synthetic fixture headers with the real ones, add a redacted copy as a fixture, and drop `HARB_WARN`.
