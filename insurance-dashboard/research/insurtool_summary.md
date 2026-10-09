# R3 · InsurTool (EY): שחזור מלא

> נצפה 9.10.2026 · Power BI ציבורי · כותרת: "IFRS17 FY2026 Analysis", נתוני **Q2 2026** · 62 עמודים.
> הקטלוג המלא: `insurtool_catalog.csv` (105 שורות, שורה לכל ויזואל). צילומים: `img/insurtool/pNN.jpg` (עמ' 55, אנשי קשר, לא נשמר).
> שמות העמודים, כותרות הוויזואלים, המסננים והערות השוליים נשלפו מה-DOM. עמודת "מקור בדוח" היא **הערכה שלי**, לא של EY.

## שורה תחתונה

1. **האוניברסום גדל מ-11 ל-19 ישויות במסננים (18 בגרף הראשי)**, בניגוד ל-HANDOFF: Harel, Phoenix, Menora Holdings, Menora Insurance, Clal, Migdal, Ayalon, IDI, Shomera, Wesure Globaltech, Wesure Insurance, AIG, Hachshara, Haklai, Libra, Shlomo, David Shield, Securitas, Ankor. חלקן חברות בנות של אחרות (Menora Insurance, Shomera, Wesure Insurance).
2. **אין מודול CSM נפרד.** הכפתור "CSM Life & Health" בעמוד הבית מוביל לעמודי CSM בתוך Overview ו-New Business. בפועל 6 מודולים עם תוכן: Overview (11), P&C (10), New Business (3), Health (9), Life (11), Investment Contracts (2), ועוד Annex (7).
3. **InsurTool הוא חתך רוחב של רבעון, לא סדרת זמן:** בורר שנה (2025/2026) ורבעון (Q1/Q2), השוואה לשנה קודמת בלבד. הגרף היחיד עם ציר זמן הוא שווי שוק (6 נקודות). זה הפער שלנו: 30 רבעונים לכל מדד.
4. **רוב העבודה של EY היא הערות שוליים על השוואתיות**, לא הנתונים עצמם. הן חוזרות ב-30+ עמודים וחייבות להיכנס אצלנו כשדה `basis` לכל חברה ומדד.

## מבנה

| מודול | עמודים | מסכים |
|---|---|---|
| Home, Disclaimer | 1-2 | ניווט |
| Overview | 3-14 | Main KPIs · TCI לפני מס Adjusted · TCI לפני מס · פירוק TCI למגזר · AUM · פירוק רווח כולל · הון ודיבידנד · ROE · שווי שוק ומכפילים · CSM · עקומי ריבית חסרת סיכון |
| P&C | 15-25 | GWP · TCI · יחסי רווח חיתומי · פירוק TCI · פירוק רווח חיתומי · פירוק מרווח פיננסי · יחס תביעות שוטפות · Combined ratio · שינויים בגין שירותי עבר · RA |
| New Business | 26-29 | פרמיות משונתות · CSM עסק חדש · CSM Growth Ratio |
| Health | 30-39 | GWP · TCI · פירוק TCI · פירוק רווח חיתומי · מרווח פיננסי · רווח חיתומי/הכנסות · שחרור CSM/רווח חיתומי · Loss ratio · שירותי עבר |
| Life | 40-51 | כמו Health, ועוד: פירוק סטיות ניסיון · יחס בפועל/צפוי · Loss ratio בריסק |
| Investment Contracts | 52-54 | AUM · 3 יחסים (דמי ניהול/AUM ממוצע, הוצאות/דמי ניהול, רווח/דמי ניהול) |
| Contact, Annex | 55-62 | עקרונות Adjusted profit ל-6 קבוצות · מילון מונחים |

## מסננים (כפי שנצפו)

| מסנן | ערכים |
|---|---|
| Year | 2025, 2026 |
| Quarter | Q1, Q2 (Q4 = שנה מלאה) |
| Type | Cumulative, Incremental |
| Add Adjusted? | No, Yes (Non GAAP כהגדרת כל חברה) |
| Financial Statements / Adjusted | מתג בעמודי TCI |
| Gross / Net | CSM, יחסי רווח חיתומי |
| Company | בחירה מרובה |
| Line of Business, P&C | All Segments, Compulsory Motor, Casco Motor, Other insurance lines |
| Line of Business, Health | All Segments, Individual LTC, Collective LTC, Individual Medical Expenses, Collective Medical Expenses, Other |
| Line of Business, Life | All Segments, Non-participating savings component, Participating savings component, Protection Policies |
| New Business Product | Participating savings component, Protection Policies, Individual Medical Expenses, Collective Medical Expenses, Other |
| Label | Value, YoY (חוזי השקעה) |
| CSM date | 12.2025, 03.2026, 06.2026 |
| RF curve type | Real RF; +50%, +80%, +100% ILP |

## תבניות עיצוב שחוזרות

- **דירוג:** עמודות ממוינות בסדר יורד, ערך מעל כל עמודה, וכרטיס "Whole Market" עם ערך ו-YoY בפינה ימנית עליונה.
- **פירוק:** עמודות מוערמות לחברה, ולצדן עמודה נפרדת "Whole Market" באותו פירוק, עם ערך ו-% מהסך.
- **זוג קבוע:** ערך למעלה, YoY או QoQ למטה; או יחס מימין מול יחס משמאל.
- **נתח שוק:** טבעת, רק בעמודי GWP ועסק חדש.
- **יחסים:** עמודות אופקיות ממוינות עם קו שוק.

## נוסחאות שמוגדרות במפורש

| מדד | הגדרה |
|---|---|
| ROE | Net Income / Adjusted equity; Adjusted equity = (הון פתיחה + הון סגירה + דיבידנד ששולם)/2; שנתי: (1+ROE)^(4/N)−1 במצטבר, (1+ROE)^4−1 בתוספתי |
| P/B | שווי שוק במועד פרסום / הון לבעלי מניות למועד הדוח |
| P/E | שווי שוק במועד פרסום / רווח כולל נקי משונתן לבעלי המניות |
| CSM Growth Ratio | CSM עסק חדש / שחרור CSM |
| Combined ratio (ברוטו) | הוצאות ביטוח ברוטו / הכנסות ביטוח ברוטו; גרסה שנייה ללא שירותי עבר |
| Loss ratio | תביעות והוצאות שוטפות / הכנסות משירותי ביטוח ברוטו |
| Current claims ratio (P&C) | תביעות והוצאות שירות שוטפות ללא עלויות רכישה / הכנסות משירותי ביטוח ברוטו |
| Actual-to-expected (Life) | תביעות והוצאות שהתהוו / תביעות והוצאות צפויות |
| Insurance מול Other financial profit | Insurance = P&C + Life + Health + מגזר ההון של חברת הביטוח; Other = פנסיה וגמל, חוזי השקעה, אשראי, סוכנויות |

## הסתייגויות השוואתיות (להעתיק ל-`basis`)

- **Harel, Ayalon:** CSM עסק חדש ו-CSM Growth Ratio ברמת **ברוטו**; השאר נטו.
- **Phoenix, Menora:** הקצאת רווחי השקעה, מימון והוצאות תפעול ממגזר ההון למגזרי הביטוח (כולל מספרי השוואה).
- **Menora:** אין מגזר בריאות נפרד; Life = LTS בלבד; ריסק חיים נכלל בבריאות.
- **Clal:** CSM נטו בלי פילוח למגזר.
- **Hachshara:** מגזרי חיים בלבד בחלק מהמסכים.
- **David Shield:** דוחות בדולר, מתורגמים בשער ממוצע.
- **Phoenix:** "שירותי עבר" כולל שינויי אומדן מרבעונים קודמים באותה שנה.
- **Adjusted:** הגדרה שונה לכל חברה (מרווח מנורמל של RF + 2% עד 2.5%, לפי החברה).

## פערים בצילום
- עמודי Annex 58-61 צולמו ברזולוציה נמוכה והם תמונה ולא טקסט; הסיכום שלהם חלקי ומסומן כך בקטלוג.
- לא נבדקו: מצב Incremental, Q1, 2025, ופילוח לפי ענף בכל עמוד (נצפתה ברירת המחדל: 2026, Q2, Cumulative, All Segments).
