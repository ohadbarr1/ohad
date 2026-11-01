# Automatic data updates and the report-day autopilot

Two things keep fox's data current without the owner:

1. **GitHub Actions, `.github/workflows/fox-data.yml` (the main path).** Three times a day it checks data.gov.il for a new regulator
   month (gemel-net, pensia-net, bituach-net). On a new month it fetches, rebuilds, runs the gate, commits, runs fox-ci on that exact
   commit, and (if `FOX_AUTODEPLOY = on`) publishes it, checks the live site and rolls back on failure. The Mac does not need to be on.
2. **The Mac autopilot** (launchd, below): report-day reminders, the owner's MAYA one-shot, and, **only if switched on**
   (`ops/autopilot.toml [deploy] auto = true`), its own auto-publish of a regulator month. Whoever pushes the month first wins; the
   other sees origin ahead and skips.

---

## מדריך לבעלים (עברית)

### ארבעה צעדים חד-פעמיים (כ-15 דקות)

לפני כן: ה-workflow `fox-data.yml` צריך להיות בענף הפריסה `claude/festive-ramanujan-7f9ihj` (הוא נכנס עם המיזוג של גל F1).

1. **ענף ברירת המחדל ב-GitHub.** github.com/ohadbarr1/ohad ← **Settings** ← **General** ← בשורה **Default branch** לוחצים על
   סמל החצים (⇄) ← בוחרים `claude/festive-ramanujan-7f9ihj` ← **Update** ← מאשרים "I understand, update the default branch".
   למה: תזמון (cron) וכפתור ההרצה הידנית עובדים רק מענף ברירת המחדל. `master` הוא מאגר תזה ישן שאינו קשור ל-fox; לא משנים את שם הענף.
2. **חשבון שירות לפריסה (Google Cloud).** console.cloud.google.com ← בוחרים את הפרויקט `fox-research-il` ← תפריט ☰ ← **IAM & Admin**
   ← **Service Accounts** ← **+ Create service account** ← שם: `fox-github-deployer` ← **Create and continue** ← בשדה Role מחפשים
   **Firebase Hosting Admin** ובוחרים רק אותו ← **Continue** ← **Done**. אחר כך לוחצים על החשבון החדש ← לשונית **Keys** ← **Add key**
   ← **Create new key** ← **JSON** ← **Create**. קובץ JSON יורד למחשב.
3. **סביבת `production` והסוד.** ב-GitHub: **Settings** ← **Environments** ← **New environment** ← שם `production` ←
   **Configure environment**. תחת **Deployment branches and tags** בוחרים **Selected branches and tags** ← **Add deployment branch or tag
   rule** ← `claude/festive-ramanujan-7f9ihj` ← **Add rule**. תחת **Environment secrets** ← **Add environment secret** ← Name:
   `FIREBASE_SERVICE_ACCOUNT`, Value: כל תוכן קובץ ה-JSON (פותחים בעורך טקסט, מעתיקים הכול) ← **Add secret**. **אחר כך מוחקים את קובץ
   ה-JSON מהמחשב.** אופציונלי לחודש הראשון: **Required reviewers** = את/ה, וכל פריסה אוטומטית תחכה ללחיצה אחת באפליקציית GitHub.
4. **מתג הפריסה.** **Settings** ← **Secrets and variables** ← **Actions** ← לשונית **Variables** ← **New repository variable** ← Name:
   `FOX_AUTODEPLOY`, Value: `off` בהתחלה ← **Add variable**. אחרי הרצת ניסיון אחת שעברה (למטה) משנים ל-`on`.

**הרצת ניסיון (מומלץ מיד אחרי הצעדים):** לשונית **Actions** ← **fox-data** ← **Run workflow** ← ענף `claude/festive-ramanujan-7f9ihj`,
`dry_run` מסומן ← **Run workflow**. ריצה ירוקה עם טבלת probe בסיכום מוכיחה ששרתי GitHub מגיעים ל-data.gov.il. (אם אין חודש חדש, הריצה
נעצרת אחרי ה-probe; כדי לבדוק גם את הבנייה מסמנים גם `force`.) אחר כך `FOX_AUTODEPLOY` = `on`.

### שימוש שוטף

- **מתי זה רץ:** 06:17, 12:17 ו-18:17 שעון ישראל, כל יום (GitHub עלול לאחר ב-5 עד 30 דקות). ריצה שלא מצאה חודש חדש נגמרת אחרי
  ה-probe, תוך פחות מדקה.
- **השהיה:** משנים את `FOX_AUTODEPLOY` ל-`off` (Settings ← Secrets and variables ← Actions ← Variables ← עריכה). הריצות ממשיכות לבנות
  ולבדוק, ולא מפרסמות. עצירה מלאה: Actions ← fox-data ← ⋯ ← **Disable workflow**.
  במצב `off` החודש החדש נשמר בענף `autodata/<yyyymm>` (עבר את fox-ci); לפרסום ידני: `git fetch && git merge --ff-only origin/autodata/<yyyymm>`,
  `git push`, `./deploy.sh`. עד שמפרסמים, כל ריצה בונה ובודקת אותו מחדש.
- **לראות ריצות:** לשונית **Actions** ← **fox-data**. בכל ריצה: טבלת ה-probe, ה-commit שנבנה, תוצאת fox-ci והפריסה. כשל פותח (או
  מעדכן) issue בשם "fox-data: automated data run failed", ו-GitHub שולח מייל למי שערך אחרון את שורת התזמון בקובץ (ודאו ב-Settings
  האישיים ← Notifications ← Actions שמסומן "Send notifications for failed workflows only").
- **איך עובד ה-rollback:** לפני הפריסה נרשמת הגרסה שבאוויר. אחרי הפריסה נבדק האתר החי: lens.json, funds.json ו-market_home.json
  מראים את החודש החדש, ו-qa.json זהה לזה שב-commit. אם משהו נכשל, הגרסה הקודמת חוזרת לאוויר (`firebase hosting:clone`), הריצה
  נצבעת באדום ונפתח issue. ידנית: Firebase console ← Hosting ← Release history ← ⋮ ליד הגרסה הקודמת ← **Rollback**.
  אחרי rollback ה-commit עדיין בענף הפריסה; כדי לנסות שוב: Actions ← fox-data ← Run workflow עם `force` ובלי `dry_run`, או מה-Mac:
  `git pull` ואז `./deploy.sh`.
- **מה נשאר ידני:** כל מה שנגזר מ-MAYA: דוחות החברות (PDF/XBRL) וכל מה שמחולץ מהם (רווח והפסד ב-lts.json, savings_econ.json, IFRS,
  סולבנסי, מצבת התחייבויות, בעלי שליטה, AUM מודפס ב-recon), מחירי הבורסה (`fetch_prices`), רשימות נכסים של מנהלים שחוסמים גישה
  אוטומטית, וחילוץ LLM. החצי הרגולטורי של העדשה (נכסים, תזרימים, דמי ניהול, nowcast) מתעדכן לבד; חצי הרווח והפסד מתעדכן כשמריצים את
  MAYA one-shot והחילוץ.
- **שימו לב:** החודש הראשון שנכנס אוטומטית מקפיא שלב nowcast ביומן (append-only). זה מכוון ואי אפשר לבטל.
- **מה-Mac:** `./deploy.sh` מסרב עכשיו לפרוס HEAD שמאחורי origin (אחרי שה-CI פרסם חודש: `git pull --ff-only` קודם), ומקבל commit נתונים
  של ה-CI לפי הסטטוס "fox-ci (fox-data)".

---

## Owner runbook (English)

### Four one-time steps (≈15 minutes)

Precondition: `fox-data.yml` is on the deploy branch `claude/festive-ramanujan-7f9ihj` (it arrives with the F1 merge).

1. **GitHub default branch.** github.com/ohadbarr1/ohad → **Settings** → **General** → **Default branch**: click the switch icon (⇄) →
   pick `claude/festive-ramanujan-7f9ihj` → **Update** → confirm "I understand, update the default branch". Why: schedules and the
   manual Run button only exist on the default branch. `master` is an unrelated thesis repo; do not rename the deploy branch.
2. **Deploy identity (Google Cloud).** console.cloud.google.com → project `fox-research-il` → ☰ → **IAM & Admin** → **Service Accounts**
   → **+ Create service account** → name `fox-github-deployer` → **Create and continue** → Role: search **Firebase Hosting Admin**, pick
   only that → **Continue** → **Done**. Open the account → **Keys** → **Add key** → **Create new key** → **JSON** → **Create** (a JSON
   file downloads).
3. **Environment `production` and the secret.** GitHub **Settings** → **Environments** → **New environment** → `production` →
   **Configure environment**. **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** →
   `claude/festive-ramanujan-7f9ihj` → **Add rule**. **Environment secrets** → **Add environment secret** → Name
   `FIREBASE_SERVICE_ACCOUNT`, Value = the whole JSON file → **Add secret**. **Then delete the JSON file from the Mac.** Optional for the
   first month: **Required reviewers** = you, so each auto-deploy waits for one tap in the GitHub app.
4. **The switch.** **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable** →
   `FOX_AUTODEPLOY` = `off` → **Add variable**. After one good dry run (below), change it to `on`.

**Dry run (right after):** **Actions** → **fox-data** → **Run workflow** → branch `claude/festive-ramanujan-7f9ihj`, `dry_run` ticked →
**Run workflow**. A green run with the probe table in its summary proves GitHub's runners reach data.gov.il. With no new month upstream
the run stops after the probe; tick `force` as well to exercise the fetch, build and gate.

### Day to day

- **When:** 06:17, 12:17 and 18:17 Israel time daily (GitHub may start 5–30 min late). A run with nothing new ends after the probe.
- **Pause:** set `FOX_AUTODEPLOY` to `off`: runs still build and check, nothing is published. Stop everything: Actions → fox-data → ⋯ →
  **Disable workflow**.
  While `off`, the month waits on branch `autodata/<yyyymm>` (fox-ci green); to publish it by hand: `git fetch && git merge --ff-only
  origin/autodata/<yyyymm>`, `git push`, `./deploy.sh`. Until then each run rebuilds and rechecks it.
- **See runs:** **Actions** → **fox-data** (probe table, data commit, fox-ci, deploy). A failure opens or comments on the issue
  "fox-data: automated data run failed"; GitHub also emails whoever last edited the schedule line (personal Settings → Notifications →
  Actions: "failed workflows only").
- **Rollback:** before deploying, the job records the live Firebase version. After `./deploy.sh --ci` it checks the live site:
  `lens.json` `meta.asof`, `funds.json` `asof` and `market_home.json` `meta.asof` = the month, and `qa.json` `built` = the commit's. On any
  failure it clones the recorded version back to live (`firebase hosting:clone fox-research-il@<version> fox-research-il:live`), fails the
  run and opens the issue. By hand: Firebase console → Hosting → Release history → ⋮ on the previous release → **Rollback**. The deploy
  branch keeps the data commit; to retry, run fox-data with `force` and without `dry_run`, or on the Mac `git pull && ./deploy.sh`.
- **Stays manual (MAYA-derived):** company filings (PDF/XBRL) and everything extracted from them (`lts.json` P&L, `savings_econ.json`,
  IFRS, solvency, liabilities, ownership/holders, printed AUM in `recon`), TASE prices (`fetch_prices`), holdings of WAF-blocked
  managers, LLM extraction. The Lens updates its regulator half by itself and its P&L half when the owner runs the MAYA one-shot.
- **Note:** the first automated month appends a nowcast stage to the append-only ledger. Intended, and irreversible.

### How the workflow decides (engineer's notes)

| job | what | permissions |
|---|---|---|
| probe | Israel-time slot gate (two UTC schedules, one per DST offset; `TZ=Asia/Jerusalem date +%z` picks the one in force), then `pipeline/autopilot/regulator.py` (6 CKAN requests, retried; an unreachable dataset fails the run, never reads as "nothing new") | contents: read |
| build | `actions/cache` restores the frozen resources (key = hash of their ids + last_modified), `FOX_REGRAW_CACHE` makes `fetch_regulator.py` reuse them; `dag.py --only [fetch_transfer_bank,]fetch_regulator,fetch_macro,build_market,build_funds,build_recon,build_lens,build_flow_npv,build_roster,build_nowcast --no-deps --manual`, then `--only deploy --no-deps`; month check (funds.json and lens.json as-of = the month); `check_funds_contract.py`; `gate.py`; commit; push `autodata/<yyyymm>` | contents: write |
| checks | `fox-ci.yml` via `workflow_call` on that sha | contents: read |
| verified | commit status `fox-ci (fox-data)` = success on the sha (deploy.sh accepts it) | statuses: write |
| deploy | `FOX_AUTODEPLOY == 'on'`, environment `production`; skip if the deploy branch already has the month; refuse unless a fast-forward; push; record the live version; `./deploy.sh --ci`; `live.py verify`; roll back on failure | contents: write (+ the environment secret) |
| alert | any failure → issue | issues: write |

`data/raw` is not in git; in CI it is a plain folder of the checkout, and every builder already reads `ROOT/data/raw`, so no path
override was needed (the Drive symlink exists only on the Mac). Builders run with `TZ=Asia/Jerusalem` so stamped dates match the Mac.
`concurrency: fox-live` keeps two runs from overlapping. `deploy.sh --ci` needs HEAD = the verified sha = the tip of origin's deploy
branch, does not rerun the DAG or the gate (live = that commit byte for byte) and commits nothing.

**Not verified before the first run:** that GitHub's (Azure) runners can reach data.gov.il, edge.boi.gov.il and api.cbs.gov.il (the dry
run answers it); that Firebase Hosting Admin alone suffices for `firebase deploy --only hosting`, `hosting:channel:list` and
`hosting:clone` with this project (if the deploy step fails with a permission error naming another role, add only that role).

---

## The Mac autopilot

The autopilot also runs on the owner's Mac as a per-user launchd agent. It
discovers new data **only through channels fox may use automatically**, lands it in the owner's working copy, rebuilds, runs the gate,
writes `web/public/data/autopilot/status.json` and shows a macOS notification with the exact publish command. By default it never
commits, pushes or deploys: publishing stays `./deploy.sh`, which refuses anything but a clean, pushed, CI-green commit that is not behind
origin. The opt-in exception is `[deploy] auto` (below).

**It runs only on the deploy branch.** `ops/autopilot.toml [repo] branch` names it; while `~/code/ohad` has any other branch checked out
(a feature branch, `sa2-integration`, ...) every tick skips with "on branch X, the autopilot runs on <deploy branch> only", reminders
included in the log. Check out the deploy branch in `~/code/ohad` (or point `[repo] path` at a checkout that stays on it) for it to act.

## Which channels are permitted (checked 25.10.26)

| source | automated use | evidence |
|---|---|---|
| data.gov.il CKAN (Capital Market Authority: gemel-net, pensia-net, insurance-net) | **yes**, daily, ≈6 requests | documented API, open licence. `robots.txt` disallows `/api/` for crawlers; the API is the documented access path, so fox keeps it to a probe a day plus the fetch when a month is new, with a User-Agent naming fox |
| MAYA list API (`maya.tase.co.il/api/…`) | **no** | `robots.txt`: `Disallow: /api/` and "Systematic scraping, bulk extraction, or model training require explicit authorization"; our Python client gets 403 |
| MAYA RSS | does not exist | `maya.tase.co.il/rss`, `/rss.xml`, `/feed`, `/he/rss` answer 403 (the site's bot wall); no feed is linked or documented; `sitemap.xml` lists only static section pages |
| TASE DataHub API | **no free channel** | the free products are Funds, Indices Basic, Indices Online and Securities Basic; the company-announcements feed is a paid product |
| `mayafiles.tase.co.il` | **no** (no permitted feed points to it) | even `/robots.txt` answers 403 (Incapsula "security violation"); terms cannot be read, so nothing is scheduled against it |
| TASE mobile app push / MAYA email alerts | human channel | free, for a person; fox does not read the owner's phone or mail |

So the schedule covers the regulator months automatically, and company filings get a **reminder** (not a fetch) when they are due.
Filings come in through the owner's own one-shot command (below) until TASE answers `docs/TASE_REQUEST.md`.

## Cadence

launchd wakes `pipeline/autopilot/tick.py` on every quarter hour; `schedule.py` decides whether the tick acts:

- **every 15 min** inside a filing window, on filing days (Sun–Fri), 07:00–22:00 Israel time. A window is each active company's expected
  date of its next report in `calendar.json`, widened by its own lo/hi range and ±10 days; overlapping windows merge
  (Q3'26: 26.10–10.12.26);
- **hourly** at every other time;
- **data.gov.il daily**: max `REPORT_PERIOD` and `last_modified` of the current resource of each dataset; a month newer than the one in
  `market.json` triggers `dag.py --only fetch_regulator,build_market,build_funds --manual`, then the rest as below. A revision of an
  old month (the resources refresh daily) is shown, not fetched.

Each acting tick: permitted discovery → fetch → XBRL T+0 skeleton (`status: unverified` until the printed figure agrees) → optional LLM
hook → `python3 pipeline/dag.py --only deploy` → `pipeline/gate.py` → `status.json` → notification. A tick that finds nothing writes
nothing in the repo (its heartbeat is `~/.cache/fox/autopilot/state.json`). Reminders: one notification a day per company whose report
is due and not in fox yet, with the command for it.

Skips (logged, exit 0): the previous tick still running; a merge/rebase/cherry-pick in progress or a held `index.lock`; the checkout on a
branch other than `[repo] branch` (the deploy branch; auto-publish skips too).

## What runs automatically, what the owner runs

| automatic (schedule) | manual (owner) |
|---|---|
| data.gov.il probe + fetch + rebuild + gate | `python3 pipeline/autopilot/run.py --maya-once [--companies harel,clal]`: one MAYA pass at ≤ 1 request / 2 s, fetches the new filings' PDFs/XBRL, then the same run; a 403/429 stops it and says so. `--maya-once --dry-run` lists what is new and writes nothing |
| local pickup: XBRL instances already in `data/sources/xbrl` that the registry has not parsed | publishing: `git add web/public/data data/registry pipeline/taxonomy && git commit`, `git push`, wait for fox-ci, `./deploy.sh` (the notification and `/data/autopilot` show the exact lines) |
| "report due" reminders | turning on the LLM hook, granting MAYA scheduling after TASE's written permission |

## Install

From the local working copy (not the synced drive):

```
cd ~/code/ohad/insurance-dashboard
./ops/install-autopilot.sh --print     # optional: the rendered plist
./ops/install-autopilot.sh             # runs the tests, shows what the next tick would do, loads the agent
./ops/install-autopilot.sh --kick      # same, then one tick now and the log
/usr/bin/python3 pipeline/autopilot/tick.py --status    # heartbeat, last result, the next tick's decision
./ops/uninstall-autopilot.sh [--purge]
```

Log: `~/Library/Logs/fox-autopilot/tick.log`. The first regulator fetch reads/writes `data/raw` (a symlink into Google Drive): macOS may
ask whether `python3` may access that folder; allow it (System Settings › Privacy & Security › Files and Folders), or the fetch fails
with "Operation not permitted" in the log and the notification says the run failed.

## Switches and budget (`ops/autopilot.toml`)

Edit by hand and commit; no script flips a switch.

- `[schedule]`: days, hours, window width, the two cadences, the regulator interval.
- `[discovery]`: `regulator = true`; `maya_scheduled = false` and `maya_permission_ref = ""`: the schedule calls MAYA only with **both**
  set (TASE's written permission on record), then at `maya_interval_seconds` ≥ 2.
- `[notify]`: notifications and daily reminders.
- `[deploy]`: `auto = false` (opt-in auto-publish from this Mac, section below), `remote`, `ci_wait_minutes`,
  `deploy_timeout_minutes`. Acts only on `[repo] branch`.
- `[llm]`: the optional extraction by the Claude Code CLI in headless mode (`claude -p`, fixed prompt, `pipeline/EXTRACT_SPEC.md`, tools
  limited to `Read` and writing its one output file). **Off.** Budget, in tokens as the CLI reports them (input + output + cache):
  `season_budget_tokens = 1000000` for the `season` named (a new season name starts a new budget), `per_filing_tokens = 120000` (a
  filing starts only if the season and the run still have that much left, and only if its estimate is within it), `per_run_tokens =
  300000`, and `per_filing_max_usd = 4.0` passed to the CLI as `--max-budget-usd` (the hard stop inside one call). Ledger:
  `data/registry/autopilot_llm_ledger.json`. Output: `data/extracted_autopilot/<company>/<period>_<rid>.json`, `status: unverified`;
  it reaches the site only after `verify_extraction.py` and the owner moving it into `data/extracted*/`.

  **To turn it on:** set `enabled = true`, `approved_by = "<name>"`, `approved_on = "<date>"`, check `season` and the caps, commit.
  The CLI must be logged in on this Mac (`claude` on the launchd PATH: `~/.local/bin`). `/data/autopilot` shows spent / budget.

## Auto-publish from the Mac (opt-in, `[deploy] auto`)

Off by default. With `auto = true` in `ops/autopilot.toml` (commit it), and only on the `[repo] branch`:

1. **Before an acting tick:** `git fetch`; if origin is ahead, the tree is clean and there are no local commits, `git pull --ff-only`
   (a month CI already published is not fetched and rebuilt again).
2. **After a regulator month lands and the gate passes,** on a tree that was clean before the tick: fetch again. Origin ahead (CI got
   there first) → the run's regenerated files are put back, `pull --ff-only`, no publish, notification "CI הקדים". Local commits not on
   origin → skip (it never pushes the owner's work). Otherwise: commit the data (`data: regulator MM/YY ..., autopilot on the Mac`),
   push, notification "נדחף, ממתין ל-CI".
3. **Every later tick** (whatever the cadence): fox-ci on that commit still running → wait (up to `ci_wait_minutes`, 120); green →
   `./deploy.sh` (all its checks run again), and a data commit it makes is pushed too; notification "עלה לאתר". Red, timed out, the
   checkout moved, or origin moved past the commit → dropped, with a notification.

Needs on the Mac: `git push` to origin without a prompt (keychain or ssh agent available to launchd), `gh auth login`, `firebase login`.
State: `~/.cache/fox/autopilot/state.json` → `deploy.pending` / `deploy.last`. Tests: `pipeline/autopilot/tests/test_publish.py`
(temp git repos, fake gh and deploy.sh, no network).

## Files

`pipeline/autopilot/`: `tick.py` (launchd entry), `schedule.py` (cadence), `regulator.py` (data.gov.il; also the CI probe CLI), `run.py` (the run),
`publish.py` (opt-in auto-publish), `live.py` (the CI deploy's rollback point and live check),
`llm.py` (hook + ledger), `notify.py` (osascript), `conf.py` (toml), `poll.py`/`t0.py`/`deltas.py` (MAYA pass, skeleton, headline
deltas). `ops/`: `com.fox.autopilot.plist` (template), `install-autopilot.sh`, `uninstall-autopilot.sh`, `autopilot.toml`. Tests:
`/usr/bin/python3 -m unittest discover -s pipeline/autopilot/tests` (fixtures, no network).
