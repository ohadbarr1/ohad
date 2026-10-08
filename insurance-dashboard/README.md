# שוק החיסכון הפנסיוני: מודול פנסיה וגמל (שלב 1)

אתר סטטי על נתוני הרשות לשוק ההון (גמל-נט, פנסיה-נט, ביטוח-נט), חודשי מ-2012 עד אוגוסט 2026.

## רענון חודשי

```bash
pip install pandas pyarrow
python3 pipeline/fetch_regulator.py   # מוריד את שלושת מערכי הנתונים מ-data.gov.il אל data/raw/ (לא נשמר ב-git)
python3 pipeline/build_market.py      # מצבר, מריץ בקרות ומייצר data/market.json
python3 pipeline/build_site.py        # מזריק את הנתונים לאתר ומייצר dist/pension-gemel.html
```

אפשר לפתוח את `dist/pension-gemel.html` בכל דפדפן. הוא טוען רק את ספריית הגרפים (ECharts) מ-cdnjs.

## מבנה

| נתיב | תפקיד |
|---|---|
| `pipeline/fetch_regulator.py` | הורדה מ-CKAN API של data.gov.il |
| `pipeline/build_market.py` | שיוך לקבוצות, צבירה חודשית, בקרות איכות, תמונת מצב של קופות |
| `pipeline/build_site.py` | הזרקת הנתונים לתבנית האתר |
| `site/app.html` | האתר (ללא תלות בבנייה): סקירה, דירוג, חברה, קופות, מתודולוגיה |
| `SPEC.md` | אפיון מלא של הפרויקט |

הבקרות מודפסות בסוף `build_market.py` ומוצגות גם בלשונית "מתודולוגיה ובקרה".
