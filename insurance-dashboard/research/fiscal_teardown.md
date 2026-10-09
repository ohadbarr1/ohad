# R1 · Fiscal.ai: פירוק מוצר

> נצפה 9.10.2026 · גרסה v6.0.1 · חשבון **חינמי** (כפתור UPGRADE, חלק מהמסכים נעולים) · חברות: MetLife (`NYSE_MET`), הראל (`XTAE_HARL`).
> כל מה שכתוב כאן נצפה במסך. מה שלא נצפה מסומן "לא נצפה".

## שורה תחתונה

1. **הליבה שכדאי להעתיק היא מסך Financials:** סרגל טווח תקופות, שורת בקרים אחת, טבלה עם צ'קבוקס לכל שורה, והגרף נפתח מעל הטבלה. אצלנו זה כבר קיים חלקית ב-`Company.tsx`.
2. **הכיסוי הישראלי של Fiscal.ai רדוד, וזה הפער שלנו:** להראל יש דוחות בתבנית גנרית בלבד (אין CSM, אין IFRS 17), **אין Segments & KPIs**, **אין מסמכי IR ותמלולים**, **אין קונצנזוס**. ראה `img/fiscal_19..21`.
3. **החשבון החינמי נועל היסטוריה:** רבעוני מוגבל ל-6 רבעונים, KPI ל-3 שנים. Custom Metrics, ייצוא, As Reported ו-"Data Auditability To Filing" הם בתוכנית בתשלום. אצלנו כל אלה חינם ועל כל ההיסטוריה.

## מבנה כללי

| אזור | מה יש |
|---|---|
| סרגל צד | Dashboard · Analysis · Charting · Screener · Query · Earnings · Fund Letters · Resources · Settings · Updates |
| סרגל עליון | חיפוש גלובלי ("Search 50,000+ companies"), עזרה, התראות |
| כותרת חברה | לוגו, שם, `EXCHANGE-TICKER`, סימנייה, הערה, מחיר + שינוי יומי ("15 min delay"), נגן אירוע אחרון (אודיו + מסמך) |
| לשוניות חברה (MET) | Overview · Financials · Investor Relations · Research · Estimates · News · Ownership · Industry · Dividends · Modeling · Filings |
| לשוניות חברה (הראל) | Overview · Financials · Research · Estimates · Ownership · Industry · Dividends · Modeling (אין IR, News, Filings) |
| פס תחתון | לשוניות סביבת עבודה ("Untitled", "+") ב-Charting, Screener, Query, Dashboard |

**תבנית URL:** `/company/<EXCH>_<TICKER>/financials/<statement>/<annual|quarterly|semi-annual|ltm>/`. כל מצב תצוגה הוא URL, ולכן ניתן לשיתוף.

## קיצורי מקלדת (שנצפו)

| מקש | פעולה |
|---|---|
| `/` | פתיחת חיפוש גלובלי |
| `Tab` בתוצאת חיפוש | קפיצה לתת-עמוד של החברה (Income Statement, Balance Sheet, Cash Flow, Ratios, Custom Metrics ועוד) |
| הקלדה חופשית | "Tesla income statement", "Apple estimates" מנווט ישירות לעמוד |
| `Enter` | פתיחת התוצאה הראשונה |
| Alt+קליק על מסנן (Earnings) | הצגת ערך זה בלבד |

דף קיצורים מלא: לא נצפה.

## מסך אחר מסך

### Overview (`img/fiscal_01_overview.jpg`)
- **Company Overview:** תיאור, CEO, אתר, סקטור, שנת ייסוד.
- **Company Statistics:** רשת צפופה של 8 קבוצות: Profile, Margins, Returns (5Yr Avg), Valuation (TTM), Valuation (NTM), Financial Health, Growth (CAGR 3/5/10 + Fwd 2Yr), Dividends. מתג מטבע.
- **Bulls Say / Bears Say:** שלוש נקודות לכל צד, מקור Morningstar עם תאריך.
- **What's happening:** סיכום חדשות בנקודות לטווח תאריכים.
- **Earnings:** Annual/Quarterly, Revenue/EPS, בפועל מול קונצנזוס, BEAT/MISS, "beat 22 out of 39 (56%)".
- **גרף מחיר:** טווחים 1D עד MAX, Min/Max Date, בורר סדרה (Price), שורת סיכום "Total Chg, CAGR", Download, מסך מלא.

### Financials (`img/fiscal_02_financials_is.jpg`, `fiscal_03_row_to_chart.jpg`)
- **לשוניות משנה:** Income Statement · Balance Sheet · Cash Flow Statement · Ratios · Segments & KPIs · Adjusted · Custom Metrics.
- **סרגל טווח:** שתי ידיות על ציר תקופות (Dec '05 עד Dec '28 (E)), כולל תקופות תחזית; תיבות תאריך התחלה וסיום.
- **שורת בקרים:** חיפוש מדדים · Metric Templates · `% Chg` (תפריט) · Common Size · Condense · ספרות עשרוניות (`.0` / `.00`) · Standardized / As Reported · מטבע (USD, ולחברה זרה ILS/USD) · יחידות K/M/B/T · Annual / Quarterly / Semi-Annual / LTM · קישור שיתוף למדדים שנבחרו · הורדה · Reverse Dates · איפוס.
- **טבלה:** צ'קבוקס לכל שורה; חץ הרחבה לשורות עם פירוט; עמודת LTM ראשונה; שורות נגזרות באיטליק (Total Revenues %Chg, Operating Margin); מנעול בתאים נעולים.
- **שורה ← גרף:** סימון צ'קבוקס פותח גרף עמודות מעל הטבלה. מקרא: `Total Revenues (Annual) (Millions) (Total Change: 27.44%) (CAGR: 2.73%)`. לכל סדרה: קו / עמודות / מוערם / ציר נפרד, הגדרות, תוויות ערך, הסתרה, הסרה. מתג גרף/טבלה, Download.
- **Ratios (קבוצות):** Trailing Valuation · Forward Valuation · Dividends · Margins · Capital Efficiency · Financial Health (המשך הרשימה נחתך).
- **Segments & KPIs** (`fiscal_04`): קבוצות עם שורת סך: Net Premiums Earned לפי מגזר, Revenue לפי מגזר, Adjusted Earnings לפי מגזר. שינוי מבנה דיווח מסומן בשם השורה ("Pre-FY2025 Reporting").
- **Adjusted:** Adjusted Revenue, AOI, AOI Margin, Adjusted Net Income, Margin, Adjusted EPS, Adjusted CapEx.
- **Custom Metrics:** "Add Existing Metric" / "Add Custom Metric". נעול בחינמי.

### Estimates (`fiscal_09_estimates.jpg`)
לשוניות: Revenue · EPS · Price Targets · EBITDA · EBIT · FCF · FFO/Share · AFFO/Share · NAV · NAV/Share · Book Value/Share · CapEx. גרף בפועל מול קונצנזוס עם מניפת טווח; טבלה: Fiscal.ai (חדש), Mean, Median. מקור: Wall St. / Fiscal.ai. עתיד נעול בחינמי.

### Investor Relations (`fiscal_10_ir_transcript.jpg`)
רשימת אירועים (רבעונים, כנסים, AGM, Investor Day, Proxy) · תמלול עם דוברים · נגן אודיו עם מהירות ו-"Skip to Q&A" · חיפוש בתמלול · **AI Summary** ו-**Custom Prompt** בפאנל ימני. מופעל על ידי **Quartr** (לוגו בנגן).

### Research (`fiscal_13_research.jpg`)
Morningstar Report · AI Generated Report, רשימת תאריכים. נעול בחינמי.

### Industry (`fiscal_11_industry.jpg`)
טבלת עמיתים: הוספת מדדים וחברות כ-chips, גרירת שורות, מיון, USD/Local, ייצוא. ברירת מחדל ל-MET: PFG, AFL, AIG, HIG, MFC, SLF, LNC, PRU.

### Dividends (`fiscal_12_dividends.jpg`)
גרף מדרגות של דיבידנד לאורך כל ההיסטוריה; טבלה: Ex Date, Pay Date, Type, Amount, Split Adj, Chg vs Prior, YoY, TTM Dividends, TTM YoY.

### Modeling (`fiscal_06..08`)
- **Reverse DCF:** "What Growth is Priced In?" מחיר ייחוס, WACC, צמיחה משתמעת מול ממוצע היסטורי על סרגל אחד, "expectation gap" בנק' אחוז, משפט מסכם אחד, גרף היסטורי מול מסלול משתמע. מתגים: Perpetuity / Exit Multiple; Revenue / Earnings / Cash Flow Growth; שנות תחזית 3-10; WACC Advanced Mode.
- **IRR:** מכפיל (P/E, Trailing/Forward), תקופת החזקה, מכפיל יציאה, צמיחת EPS, תשואת דיבידנד וצמיחתו; תוצאה אחת גדולה ("18.5% IRR"); גרף מחיר היסטורי שממשיך למסלול חזוי.
- **DCF:** קיים כלשונית; המסך עצמו לא נצפה.
- **Comps:** הוספת עמיתים ומדדים, טבלה (Market Cap, Price, P/S, P/E, P/FCF, P/B, EV/EBITDA, PEG, Industry), "Target assumptions" ושווי הוגן משתמע.

### Filings (`fiscal_14_filings.jpg`)
חיפוש; מסננים: All · Annual & Quarterly Reports · News · Prospectuses · Ownership · Proxy · Other. רוב הפריטים נעולים בחינמי.

### Charting (`fiscal_15_charting.jpg`)
"Search for 20,000+ metrics, segments, & KPIs" + "Add companies". chips לחברות, שורה לכל מדד עם אותם בקרי סדרה, סרגל טווח, **Index to 0**, Local/USD, K/M/B/T, תדירות, פריסה "By Company" (או לפי מדד), Share link, Download.

### Screener (`fiscal_16_screener.jpg`)
שורת "Apply filters using AI" (שפה חופשית) · Countries / Industries / Exchanges עם מתג Exclude · "Add Screener Criteria" · כרטיס לכל קריטריון עם מינימום-מקסימום ויחידה, גרירה ומחיקה.

### Query (`fiscal_17_query.jpg`)
חיפוש מילות מפתח במסמכים: Query terms · Add companies · Document Types (5 סוגים).

### Dashboard
לשוניות Summary · Performance · News · Markets. טבלת מעקב: מדדים וחברות כ-chips, עמודות ניתנות למיון ולגרירה, Add Custom Asset, Connect brokerage, ייצוא. מספר דשבורדים בפס התחתון. (צילום לא נשמר: מסך אישי.)

### Earnings (`fiscal_18_earnings.jpg`)
Agenda · Day · Week · Month · Heatmap. מסננים: Region, Sector, Exchange, Status. סיכום עליון: דוחות בתצוגה, מאושרים, היום העמוס, פיצול BMO/AMC. Export.

### Copilot
**לא נצפה** כפריט ניווט ב-v6.0.1. ה-AI מפוזר: AI Summary / Custom Prompt על תמלול ועל דוח, AI Generated Report, ו-"Apply filters using AI" בסקרינר. איך הוא מצטט: לא נבדק (נעול).

## תוכניות (ממסך השדרוג, `fiscal_05_plans_paywall.jpg`)

| | Pro | Max |
|---|---|---|
| דוחות | 15 שנים, 20 רבעונים | 20+ שנים, 40+ רבעונים |
| KPI | 10 שנים, 15 רבעונים | 15+ שנים, 20+ רבעונים |
| דשבורדים | 10, עד 100 שורות | ללא הגבלה |
| אירועים (שיחות, תמלולים, מצגות) | 10 אחרונים | 30+ |
| קונצנזוס | 2 שנים, 4 רבעונים | 3 שנים, 5 רבעונים |
| רק ב-Max | | Data Auditability To Filing · Export & Download · As Reported & Standardized |

מחירים: לא נצפו.

## הראל ב-Fiscal.ai (`fiscal_19..21`)

| נושא | מצב |
|---|---|
| מזהה | `XTAE_HARL`; מחיר ב-ILS (אגורות לא הובהר); מתג ILS/USD |
| דוח רווח והפסד | תבנית ביטוח גנרית: Premiums and Annuity Revenues, Interest And Dividend Income, Asset Management Fee, Policy Benefits, Policy Acquisition/Underwriting Costs. **אין שורות IFRS 17** (הכנסות משירותי ביטוח, CSM, RA) |
| רבעוני | 6 רבעונים פתוחים (Mar '25 עד Jun '26), השאר נעולים |
| Segments & KPIs | "This information was not provided by the company" |
| Investor Relations | "No investor relations events available" |
| Estimates | "No Analyst Data Available" |

## רכיב ← מקבילה אצלנו ← עדיפות

| רכיב ב-Fiscal.ai | מקבילה אצלנו | עדיפות |
|---|---|---|
| טבלת מדדים עם צ'קבוקס שפותח גרף מעליה | קיים ב-`Company.tsx` (דוחות). להוסיף: גרף **מעל** הטבלה, מקרא עם Total Change + CAGR, בקרי סדרה (קו/עמודה/מוערם/ציר שני/תוויות) | P0 |
| סרגל טווח עם שתי ידיות | חסר. להוסיף מעל כל טבלה וגרף | P0 |
| שורת בקרים אחת: % Chg · Common Size · עשרוניות · יחידות · תדירות · Reverse Dates | חלקי (יחידות, % שינוי, CAGR). להשלים Common Size, LTM, Semi-Annual (רלוונטי: H1), Reverse Dates | P0 |
| Standardized / As Reported | מתוכנן (PLAN 4.4). אצלם זה בתשלום, אצלנו ברירת מחדל | P0 |
| מצב תצוגה ב-URL | ניווט hash קיים. להכניס אליו מדדים נבחרים, טווח ותדירות | P0 |
| Segments & KPIs עם שורת סך ושבר דיווח בשם השורה | CSM לפי קבוצת תיק קיים. להרחיב למגזרים ולסמן IFRS 4 / IFRS 17 באותה שיטה | P0 |
| Data Auditability To Filing | קיים (עמוד PDF לכל שורה). זה היתרון המרכזי, להבליט | P0 |
| חיפוש גלובלי `/` + ניווט בהקלדה ("הראל CSM") | חסר | P1 |
| Charting: מדדים × חברות, Index to 0, By Company / By Metric, Share link | Workbench (PLAN E) | P1 |
| Industry / Comps: מדדים וחברות כ-chips, גרירה, ייצוא | Sector Lens + Comps (PLAN C, E) | P1 |
| Overview: רשת סטטיסטיקות ב-8 קבוצות | Overview מקודד להפניקס (חוב 3 ב-HANDOFF). לבנות מהטקסונומיה, עם קבוצות ביטוח: רווחיות, CSM, הון, כושר פירעון, צמיחה, דיבידנד | P1 |
| Dividends: גרף מדרגות + טבלת תשלומים | "הון ודיבידנד" (PLAN A) | P1 |
| Reverse DCF / IRR: תוצאה אחת גדולה, סרגל משתמע מול היסטורי | Valuation (PLAN F). להתאים לביטוח: ROE משתמע מ-P/B במקום צמיחת הכנסות | P1 |
| IR: רשימת אירועים, תמלול, AI Summary, Custom Prompt | Documents + "שאל" (PLAN G, H). אין תמלולים בעברית; מסמכים בלבד | P1 |
| Query: חיפוש מילות מפתח במסמכים | `search_docs` + MiniSearch (PLAN 2) | P1 |
| Screener עם שפה חופשית | 15 חברות בלבד, ערך נמוך. לאחד לתוך Comps | P2 |
| Dashboard: טבלת מעקב, כמה דשבורדים בפס תחתון | דשבורדים שמורים (`db`) | P2 |
| Earnings calendar | לוח פרסום דוחות ל-15 חברות, שורה אחת ב-Overview | P2 |
| Estimates (קונצנזוס) | אין קונצנזוס חינמי. צפי עצמאי מסומן "אומדן" (PLAN F) | לא ישים |
| Bulls / Bears, Morningstar | לא ישים (אין מקור) | לא ישים |

## מה לא לקחת
- **תבנית דוחות גנרית:** היא הסיבה שהראל נראית שם חלשה. אצלנו טקסונומיית IFRS 17.
- **נעילות וחלונות שדרוג.**
- **פיזור AI בין מסכים:** אצלנו אנליסט אחד עם כלים וציטוט עמוד.
