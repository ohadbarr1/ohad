# Report Day · יום הדוח

**Goal (fox 3.0, P1).** Within ≤ 6 hours of a filing on MAYA the company page opens on "Q3'26 · 10 שינויים", each change with both
figures and the page it is printed on; the xlsx and the JSON files are rebuilt; a feed item "Q3'26 הראל · 10 שינויים" is in `/feed`,
`/feed.xml` and `/feed/<company>.xml`.

Pieces: `pipeline/build_changes.py` (the engine, rule in its docstring) → `web/public/data/changes/<company>.json` + `index.json` →
`components/ChangesPanel.tsx` (first panel of `/company/:id`, anchor `#rd-changes`) · `components/home/SeasonStrip.tsx` (Pro home: companies
that reported in the last 7 days, each a link to its changes) · `pipeline/build_feed.py` (event type `chg`) → `build_rss.py` · runbook
`scripts/reportday.sh` · gate check `changes` (`build_changes.py --check`: rebuild equals the files, every printed figure found on its page).

## The rule (what "material" means)

score = |Δ| ÷ shareholders' equity at the start of the window × 100 (ratio rows: points × 0.2, so 5 points of solvency or ROE = 1% of
equity) × the line's volatility weight: z = |Δ| ÷ RMS of the line's last 8 changes of the same kind (≥ 4 needed), weight = z ÷ 2 clamped to
[0.5, 2]; gross lines (insurance revenue/expenses, gross reinsurance) × 0.5. Enters at score ≥ 0.5 and |Δ| ≥ NIS 1m; top 10 published.
Comparisons: P&L lines YoY (quarter for an interim report, year for an annual), balance-sheet lines and CSM QoQ, new business and release
YoY, solvency ratio against the previous disclosed date, ROE LTM YoY. The comparative is the figure the new report itself prints (a line the
new report does not reprint for the year-earlier quarter is not compared); a restated comparative carries its first print (chip "הוצג מחדש").
Left out: yield-dependent pass-through lines, profit before tax and total profit when the attributable profit is there, block totals,
per-share rows, plain income/expense lines whose sign flips (presentation). A ratio read from the report's prose (a company estimate) is
chipped "מטקסט הדוח". A one-line reason appears only from `data/registry/changes_why.json` (the report's own words, with its page); nothing
is generated.

---

## נוהל יום הדוח (עברית)

**לפני העונה (פעם אחת):** `scripts/reportday.sh <company> --t0 --no-fetch` על חברה אחת כדי לחמם את מטמון ה-DAG בעותק העבודה (הרצה
ראשונה בעותק חדש בונה הכול, כ-70 שניות); לוודא ש-`FOX_VENV_PY` מצביע על ה-.venv עם duckdb; לאשר תקציב טוקנים לעונה (למטה).

**ביום הדוח, לכל חברה:**

| שלב | מה | מי | זמן (שעון קיר) |
|---|---|---|---|
| 0 | התזכורת של האוטופיילוט ("דוח צפוי") או MAYA/אפליקציה ← הפעלת הרנבוק | בעלים | 0–30 דק׳ מהפרסום |
| A | `scripts/reportday.sh harel 2026Q3`: מעבר MAYA יחיד (≤ בקשה ל-2 שניות; 403/429 עוצר), רישום XBRL, שלד T+0 ב-kpi.json, כרטיס, "שינויים" לפי XBRL (לא מאומת), פיד, gate | סקריפט | 3–5 דק׳ (gate כ-80 שנ׳) |
| B | חילוץ: טקסט לעמודים (דקה), ואז מעברי חילוץ לפי `EXTRACT_SPEC.md` במקביל: v6 דוחות עיקריים, v1 עיקרי הדוח + CSM + כושר פירעון, v10 IFRS 17 לפי קבוצות (רשות), ובדיקת עמודים | סוכן LLM + בדיקה אנושית | 1.5–2.5 ש׳ |
| C | הרצה חוזרת עם `--no-fetch`: בדיקת עמודים, facts, kpi/ifrs (duckdb), CSM, כרטיסים, שינויים, פיד/RSS, xlsx, gate, `deploy.sh --check-only` | סקריפט | 10–20 דק׳ |
| D | עיון בשינויים (`build_changes.py --show harel 2026Q3`) מול ה-PDF, commit, push, fox-ci, `./deploy.sh` | בעלים | 30–45 דק׳ |

**סה״כ 2.5–4 שעות** מהפרסום לאתר: מרווח של 2–3.5 שעות מול יעד 6 השעות. המרווח נאכל כשהדוח יורד אחרי 16:00, כשה-PDF סרוק או משובש
(החילוץ ארוך ב-30–60%), או כשכמה חברות מדווחות באותו ערב (שלב B מקבילי לפי חברה; שלב D אחד לכולן). שלב A לבדו כבר מעלה פריט
"לא מאומת" (XBRL: רווח, רווח כולל, הון).

**מה עוד דורש אדם/LLM:** כל מה שמודפס רק ב-PDF: שורות הדוחות העיקריים מעבר ל-26 תגי ה-XBRL, גשר ה-CSM (עסק חדש, שחרור, יתרה), יחס
כושר הפירעון ויעדי ההנהלה בדוח הדירקטוריון; הצגות מחדש נגזרות אוטומטית אחרי החילוץ. סיבה לשינוי רק כלשון הדוח, עם עמוד, ידנית
ל-`changes_why.json`.

---

## Season-day procedure (English)

**Before the season (once):** run `scripts/reportday.sh <company> --t0 --no-fetch` once to warm the DAG cache of the checkout (a fresh
checkout rebuilds everything once, ~70 s); point `FOX_VENV_PY` at the .venv with duckdb; get the season's token budget approved (below).

**On the day, per company:** stage 0, the owner sees the autopilot's "report due" reminder or MAYA (0–30 min); stage A,
`scripts/reportday.sh <company> [period]` (3–5 min: one MAYA pass at ≤ 1 request / 2 s that stops on 403/429 and never works around the bot
wall, XBRL registry, T+0 skeleton, card, unverified XBRL changes, feed, gate); stage B, extraction (1.5–2.5 h: page text, then the
EXTRACT_SPEC passes v6 primary statements, v1 headline + CSM + solvency, optional v10, in parallel, then the page checks); stage C, the
`--no-fetch` re-run (10–20 min); stage D, review against the PDF, commit, push, CI, deploy (30–45 min). **Total 2.5–4 h**, 2–3.5 h of slack
against 6 h. The script exits 2 while it waits for stage B and prints the output files it expects.

### Measured (this Mac, 05.11.26, warm cache)

| step | wall clock |
|---|---|
| `build_changes.py` (13 companies, 78 reports) | 0.4 s |
| `build_changes.py --check` (rebuild + every figure re-read) | 0.6 s |
| `build_feed.py` | 1.0 s |
| `build_rss.py` | < 1 s |
| `gate.py` (81 checks) | 82 s |
| `vite build` | 9–10 s |

Runbook on real data (`scripts/reportday.sh harel 2026Q2 --no-fetch`, 05–06.11.26; Q2'26 treated as the new report): stage A 146 s on a cold
DAG cache (deploy steps 65 s, gate 81 s), 100 s warm (deploy steps 7–12 s, gate 78–88 s); stage C: `verify_fs` 14 s, facts 58 s, deploy
steps 14 s, gate 68 s, `deploy.sh --check-only` 1,303 s (≈ 22 min: the whole-site route check at 390 and 1440 px dominates); the run end to
end 26 min. **The duckdb steps stalled on the .venv that lives on the synced drive** (`verify_extraction.py` sat at 0% CPU for 6 min and was
stopped; the measured run used `FOX_VENV_PY=/nonexistent`, which skips build_kpi / build_ifrs / verify_extraction): before the season,
a local venv now exists at `~/code/venvs/fox` (Python 3.11, same pinned packages as the Drive .venv; built 06.11.26) and `scripts/reportday.sh` uses it by default (`FOX_VENV_PY` overrides).

### LLM extraction budget per report (estimate)

Input is the page text the agent reads (a statement page ≈ 7k characters ≈ 2.5–3.5k tokens; a 180-page report is not read whole); output
is the JSON (harel / phoenix / clal Q2'26: primary statements 18–23k characters, IFRS 17 + CSM + solvency 70–133k characters).

| pass | input | output | with re-reads and checks |
|---|---|---|---|
| v6 primary statements | 25–40k | 8–10k | 40–80k |
| v1 headline + CSM roll-forward + solvency (board report, notes) | 60–150k | 25–50k | 120–250k |
| v10 IFRS 17 by portfolio group (optional on the day) | 30–60k | 10–20k | 50–100k |
| **per report** | | | **≈ 200–430k** |

Past estimates ran 30–60% low on garbled or scanned PDFs: plan **260–690k per report**. A season of 17 reports: **3.4–7.3M tokens**, up to
**≈ 11M** if every report is garbled. The autopilot's LLM hook defaults (`ops/autopilot.toml`: 120k per filing, 1M per season) are far below
this and would stop after the first pass; raise them only with the owner's approval.
