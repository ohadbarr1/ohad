# Draft: request to TASE for permission to read MAYA automatically

For the owner to review, fill in the bracketed fields and send (suggested address: the MAYA/TASE data contact, e.g. the support address
shown on TASE's block page, CRM@tasemail.co.il, or the DataHub sales contact). Nothing in fox calls MAYA on a schedule until TASE answers
in writing; the answer's reference goes into `ops/autopilot.toml` → `[discovery] maya_permission_ref`.

Facts behind the numbers below: 15 issuers with a MAYA company id (`data/registry/companies.json`); MAYA's list endpoint returns 30
reports per page; ≈5 periodic documents per issuer per quarter (report, translation, presentation, solvency report, liabilities schedule).

---

## עברית

**לכבוד:** הבורסה לניירות ערך בתל אביב, מחלקת מידע / MAYA
**הנדון:** בקשה לאישור קריאה אוטומטית מצומצמת של דיווחי חברות מ-MAYA עבור אתר מחקר לא מסחרי

שלום רב,

שמי [שם מלא], רו״ח, ואני מפעיל את fox (https://fox-research-il.web.app), אתר מחקר יסודות חינמי, ללא פרסומות וללא תשלום, על חברות
הביטוח ומנהלי החיסכון ארוך הטווח בישראל. האתר מציג נתונים מתוך הדוחות התקופתיים בלבד; כל נתון מקושר לדוח המקורי ב-MAYA ולעמוד שבו הוא
מודפס. אין באתר שערי מניות או המלצות.

קובץ robots.txt של MAYA קובע ששליפה שיטתית דורשת אישור מפורש, ולכן אנו מבקשים אישור לשימוש המצומצם הבא:

1. **מה נקרא:** רשימת הדיווחים (`/api/v1/reports/companies`) של 15 חברות מדווחות בלבד ([רשימה: הפניקס 767, הראל 585, מגדל 1041,
   כלל 224, מנורה מבטחים 566, הכשרה 1187, איילון 209, ביטוח ישיר 1089, מיטב 1064, אלטשולר שחם 2367, מור 1692, אנליסט 1008, ילין
   לפידות 1307, מור גמל ופנסיה 2358, אי.בי.אי 175]); ומתוך mayafiles רק הקבצים של דיווחים חדשים מסוג דוח רבעוני/שנתי (PDF וקובץ
   XBRL טופס ת930), מצגת למשקיעים, דוח סולבנסי ומצבת התחייבויות (ת126).
2. **תדירות:** בעונת הדוחות (כעשרה ימים לפני ואחרי מועד הפרסום הצפוי) בקשה אחת לכל חברה ברבע שעה, בימי דיווח בין 07:00 ל-22:00;
   מחוץ לעונה בקשה אחת לכל חברה בשעה. קצב מרבי: בקשה אחת לשתי שניות. בסך הכול כ-60 בקשות לשעה בעונה, ובנוסף הורדת הקבצים של
   דיווחים חדשים בלבד (כ-75 דיווחים ברבעון). אנו מוכנים להתאים את התדירות לכל מגבלה שתקבעו.
3. **זיהוי:** כל בקשה נושאת User-Agent המזהה את fox ואת כתובת האתר; כתובת קשר: [דוא״ל]. בקשה שנחסמת (403/429) עוצרת את הריצה ואינה
   חוזרת; לא נעשה ניסיון לעקוף חסימה.
4. **שימוש וייחוס:** האתר מציג נתונים שחולצו מהדוחות (לא את הקבצים עצמם), עם קישור לדיווח ב-MAYA ולעמוד בדוח ועם הכיתוב "מקור: MAYA,
   הבורסה לניירות ערך בתל אביב". הקבצים נשמרים כארכיון פרטי לצורך אימות בלבד ואינם מופצים. אין שימוש בנתונים לאימון מודלים, אין
   מכירה או העברה לצד שלישי.
5. **חלופה:** אם עדיף לכם, נשמח לקבל גישה למוצר הדיווחים של TASE DataHub בתנאים לשימוש לא מסחרי, או לפיד רשמי (RSS) של דיווחי
   החברות הללו.

נשמח לאישור בכתב (ולמספר אסמכתה), או להנחיות כיצד להגיש בקשה מסודרת.

בברכה,
[שם מלא], [טלפון], [דוא״ל]

---

## English

**To:** Tel Aviv Stock Exchange, Data / MAYA
**Re:** Permission for limited automated reading of MAYA company filings for a non-commercial research site

Dear Sir or Madam,

My name is [full name], CPA. I run fox (https://fox-research-il.web.app), a free fundamentals research site, with no advertising and
no paywall, covering Israel's insurance groups and long-term savings managers. It shows figures from periodic reports only; every figure
links to the original MAYA filing and the page where it is printed. It shows no share prices and no recommendations.

MAYA's robots.txt says systematic extraction requires explicit authorisation, so we ask permission for the following limited use:

1. **What we read:** the filing list (`/api/v1/reports/companies`) of 15 reporting companies only ([list above, with MAYA company ids]);
   and from mayafiles only the files of new filings that are quarterly/annual reports (PDF and the ת930 XBRL instance), investor
   presentations, solvency reports and liabilities schedules (ת126).
2. **Frequency:** in filing season (about ten days either side of each expected report date) one request per company every 15 minutes
   on filing days, 07:00–22:00; outside the season one request per company per hour. Never faster than one request every two seconds.
   About 60 requests an hour in season, plus downloading the files of new filings only (about 75 filings a quarter). We will adapt to
   any limit you set.
3. **Identification:** every request carries a User-Agent naming fox and its URL; contact: [email]. A refused request (403/429) stops
   the run and is not retried; we never try to get around a block.
4. **Use and attribution:** the site shows figures extracted from the reports (not the files themselves), each linked to the MAYA filing
   and page and labelled "Source: MAYA, Tel Aviv Stock Exchange". The files are kept as a private archive for verification and are not
   redistributed. No model training, no sale or transfer to third parties.
5. **Alternative:** if you prefer, we would gladly use TASE DataHub's announcements product on non-commercial terms, or an official
   feed (RSS) of these companies' filings.

We would be grateful for written permission (with a reference number), or for directions on how to apply formally.

Kind regards,
[full name], [phone], [email]
