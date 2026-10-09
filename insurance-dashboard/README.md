# מרכז מחקר: ביטוח, פנסיה וגמל

אתר מחקר על בסיס דוחות כספיים ונתוני רשות שוק ההון. React + TypeScript + Vite, גרפים ב-ECharts, בלי שרת: הנתונים הם קבצי JSON שנבנים מראש.

## הרצה מקומית

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # אתר סטטי בתיקיית web/dist, מוכן לאירוח
```

פריסה: Cloudflare Pages, Netlify או Vercel. Build command: `npm run build`. Root: `insurance-dashboard/web`. Output: `dist`. הניווט משתמש ב-hash, ולכן לא נדרשת הגדרת שרת מיוחדת.

## עמודים

| נתיב | מה יש בו |
|---|---|
| `/` | חיפוש גלובלי (חברות, קבוצות, 1,251 קופות, שורות בדוחות כספיים), מדדי שוק, כרטיסי חברות |
| `/market/overview`, `/ranking`, `/funds`, `/group/:name` | סקירת שוק, דירוג חברות (חודש, מוצר, מדד, חלון, קו שוק), טבלת קופות, עמוד קבוצה |
| `/companies` | טבלת חברות עם נכסים, נתח, צבירה ודמי ניהול |
| `/company/:id` | סקירה, **דוחות כספיים** (טבלת מדדים עם צ'קבוקסים שמזינה גרף, יחידות, % שינוי, CAGR, עמוד מקור), **IFRS 17 · CSM** לפי קבוצת תיק, פנסיה וגמל, מפת מסמכי המקור |
| `/coverage` | אילו חברות ותקופות נקלטו |
| `/methodology` | הגדרות, מגבלות, בקרות איכות |

## צינור הנתונים (Python)

```bash
pip install pandas pyarrow openpyxl
python3 pipeline/fetch_regulator.py        # גמל-נט, פנסיה-נט, ביטוח-נט מ-data.gov.il  -> data/raw (לא ב-git)
python3 pipeline/build_market.py           # צבירה, בקרות, -> data/market.json + web/public/data/market.json
python3 pipeline/extract_company_workbook.py data/sources/<חוברת>.xlsx <company_id> web/public/data/companies
python3 pipeline/build_company_index.py    # רישום חברות + סטטוס דוחות -> web/public/data/companies/index.json
```

הוספת חברה: שורה ב-`data/registry/companies.json`. הוספת דוח: חוברת חילוץ בפורמט של `data/sources/Phoenix_H1_2026_Financial_Statements.xlsx` (גיליון לכל טבלה, עמוד PDF לכל שורה).

## מבנה

```
web/src/lib       market.ts (מנוע צבירה), company.ts (אינדקס עובדות), useData.ts, format.ts, theme.tsx
web/src/components  Chart, Search, Layout, ui
web/src/pages     Home, Market, Companies, Company, Coverage, Methodology
web/public/data   market.json, companies/*.json   (נבנים בצינור)
pipeline          סקריפטי Python
data/registry     רישום חברות
data/sources      קבצי מקור שנקלטו
SPEC.md           אפיון מלא
```
