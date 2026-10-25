# Report-day autopilot on a schedule

The autopilot runs on the owner's Mac (the data lives on the synced drive, so not GitHub Actions) as a per-user launchd agent. It
discovers new data **only through channels fox may use automatically**, lands it in the owner's working copy, rebuilds, runs the gate,
writes `web/public/data/autopilot/status.json` and shows a macOS notification with the exact publish command. It never commits, pushes
or deploys: publishing stays `./deploy.sh`, which refuses anything but a clean, pushed, CI-green commit.

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
branch other than `[repo] branch`.

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
- `[llm]`: the optional extraction by the Claude Code CLI in headless mode (`claude -p`, fixed prompt, `pipeline/EXTRACT_SPEC.md`, tools
  limited to `Read` and writing its one output file). **Off.** Budget, in tokens as the CLI reports them (input + output + cache):
  `season_budget_tokens = 1000000` for the `season` named (a new season name starts a new budget), `per_filing_tokens = 120000` (a
  filing starts only if the season and the run still have that much left, and only if its estimate is within it), `per_run_tokens =
  300000`, and `per_filing_max_usd = 4.0` passed to the CLI as `--max-budget-usd` (the hard stop inside one call). Ledger:
  `data/registry/autopilot_llm_ledger.json`. Output: `data/extracted_autopilot/<company>/<period>_<rid>.json`, `status: unverified`;
  it reaches the site only after `verify_extraction.py` and the owner moving it into `data/extracted*/`.

  **To turn it on:** set `enabled = true`, `approved_by = "<name>"`, `approved_on = "<date>"`, check `season` and the caps, commit.
  The CLI must be logged in on this Mac (`claude` on the launchd PATH: `~/.local/bin`). `/data/autopilot` shows spent / budget.

## Files

`pipeline/autopilot/`: `tick.py` (launchd entry), `schedule.py` (cadence), `regulator.py` (data.gov.il), `run.py` (the run),
`llm.py` (hook + ledger), `notify.py` (osascript), `conf.py` (toml), `poll.py`/`t0.py`/`deltas.py` (MAYA pass, skeleton, headline
deltas). `ops/`: `com.fox.autopilot.plist` (template), `install-autopilot.sh`, `uninstall-autopilot.sh`, `autopilot.toml`. Tests:
`/usr/bin/python3 -m unittest discover -s pipeline/autopilot/tests` (fixtures, no network).
