"""Deploy gate v1: every check the site's data must pass before it is published. Exit code 1 on any failed check.

python3 pipeline/gate.py            (standard library only; a few minutes on the Drive folder, faster once the page cache is warm)
Writes web/public/data/qa.json: {"built": ISO time, "checks": [{"id", "ok", "level", "n", "fail", "note"}]}.
level "fail" blocks the deploy; level "warn" is reported with its count and does not (a known gap outside the data build itself).

Checks
  workbook       pipeline/check_workbook.py (per-share range, blank labels, a renamed line left as two)
  prov           pipeline/verify_prov.py (every regulator aggregate equals the tracks of its source sheet)
  additivity     Q1+Q2=H1 and H1+Q3=9M on flow lines, IFRS 17 era (pipeline/check_additivity.py). Where the three figures come from
                 ONE report a miss is an extraction or merge error: fail above 0.5% of checks for any company (a report prints its own
                 figures additively; 0.5% allows a stray rounding of a figure printed in millions). Where they come from different
                 reports a miss is a restatement between reports (H1 reprinted by a later report, 9M not yet): warn, with the count.
  units          per-share values (unit "nis") within [0.01, 500] in absolute value; share-count lines carry unit "shares"
  latin          no label (with its dimension) carries three or more consecutive Latin words
  placeholder    no extractor placeholder caption ("ללא תווית", "ללא כותרת")
  derived        no derived figure (flag 1) on a line that is not a flow (balance, count, ratio, per-share)
  ifrs_page      every fact of web/public/data/ifrs_*.json with a page is printed on that page, where the page text exists under
                 data/work (same matching as pipeline/verify_fs.py); facts whose page text is missing are counted, not failed.
                 web/public/data/ifrs/<company>/<period>.json must be exactly the company's rows of ifrs_<period>.json.
  balance        on every balance sheet built from the reports, total assets = total equity and liabilities at every date, within the
                 rounding of figures printed in NIS millions (NIS 2m) or 0.05%: fail above 1% (a line read wrongly), warn between.
  nowcast        module M1 (unpublished): web/public/data/nowcast.json equals a rebuild (pipeline/build_nowcast.py --check), every
                 ledger entry's inputs hash recomputes, nothing about phoenix is stored, and the ledger is append-only: every file
                 under data/ledger/nowcast/ at git HEAD is still there, byte for byte (an estimate is never edited or removed once frozen).
  positions      module A6, the position book: web/public/data/positions.json equals a rebuild WITHOUT drafts (a --drafts dev build
                 fails), every ledger entry is valid (at least one falsifier, every evidence ref and metric resolves, horizon after the
                 revision date, revisions chained by `supersedes`, hashes recompute, outcomes dated and after the last revision, nothing
                 after a close; with ABSTAIN_PHOENIX on, no phoenix position), and `positions_ledger`: every file under
                 data/ledger/positions/ at git HEAD is still there, byte for byte (pipeline/build_positions.py --check).
  lens           web/public/data/lens.json equals a rebuild from market.json + lts.json (pipeline/build_lens.py --check), and every
                 derived Savings Lens figure equals its formula over the inputs printed beside it (lane 2C).
  flow_npv       web/public/data/flow_npv.json equals a rebuild (pipeline/build_flow_npv.py --check): inputs present, every NPV equals its
                 formula, NPV sign = flow sign x margin sign, LTM = the sum of its quarters, no NaN, ke constants = valuation.ts (M3).
  drivers        module A1: web/public/data/drivers/ equals a rebuild (pipeline/build_drivers.py --check): every edge has provenance or is
                 `missing` with a reason, no NaN, signs as expected, the identity nodes reconcile (op = fees − S&M − G&A, net profit =
                 PBT − tax, solvency = own funds ÷ SCR), disclosed points = csm/sens.json and csm/solvency.json, NPV per NIS 1bn = M3,
                 one policy -> 1Y pass-through in every file, nostro cash and bank-credit edges = their nodes ÷ 100, a cost fit constrained
                 at a = 0 only where the free fixed cost was negative, a variable cost above the fee yield always labelled, the policy ->
                 IFRS 17 gap labelled on every insurer; and the propagation library reproduces them (web/tests/drivers.unit.ts, in node)
  regulation     module A8: web/public/data/regulation/impact.json equals a rebuild (pipeline/build_regulation.py --check): every
                 initiative cites a public regulator document (gov.il) with a retrieval date, every date and fact points at a source,
                 every assumption carries a reason, every impact has its inputs with provenance, no NaN, the default-fund redistribution
                 sums to zero, the exposure = Σ weight × impact; and `regulation_lib`: drivers.ts re-propagates every product shock
                 (web/tests/regulation.unit.ts, run in node)
  warroom        module A5: web/public/data/warroom/ equals a rebuild (pipeline/build_warroom.py --check): every elasticity has n, se, t and
                 a quality label that follows its rule, no NaN, provenance down to a regulator dataset and window, B = the sum of its lags,
                 managers add to their category and tracks to their manager, allocation weights sum to 1; and the simulation library
                 (web/tests/warroom.unit.ts, run in node): zero-sum flows, the regression's own arithmetic, NPV = M3, provenance to the regulator
                 PBT − tax, solvency = own funds ÷ SCR), disclosed points = csm/sens.json and csm/solvency.json, NPV per NIS 1bn = M3;
                 and the propagation library reproduces them (web/tests/drivers.unit.ts, run in node)
  capital        module A7: web/public/data/capital/options.json equals a rebuild (pipeline/build_capital.py --check): distributable =
                 own funds − SCR × target − buffer on every constraint, own funds ÷ SCR = the printed ratio, every figure has provenance
                 down to a report page or is a labelled assumption, no NaN; and web/src/lib/capital.ts reproduces the option rows and
                 gives every A2 preset a finite stressed surplus or a gap (web/tests/capital.unit.ts, run in node)
  expectations   module A3: web/public/data/expectations/*.json equal a rebuild (pipeline/build_expectations.py --check): the forward model,
                 rebuilt from each file's stored inputs, reproduces the market value at every solved input within 0.5%; every figure carries
                 provenance; the price date and its label ("מחיר 22.10.26, קלט ידני") are shown; no NaN
  cross_layer    Q2'26 profit attributable to shareholders (quarter) and equity attributable (30.6.26): XBRL (kpi.json) = the
                 statements workbooks (lines.json), within rounding of a figure printed in NIS millions (NIS 1.5m) or 0.1%.
  consistency    every entity × period × metric served by more than one page (kpi, Report Day, statements, peer table, CSM capital/ledger)
                 shows one figure within rounding, last 8 quarters; labelled basis differences listed (pipeline/check_consistency.py, lane Q)
  fund_roles     fund houses: attributable profit and comprehensive income on the company page = XBRL, last 4 quarters
  schemas        every built JSON with a data contract (web/src/lib/schemas.json) matches it: pipeline/check_schemas.py, the same
                 contracts the site checks as each file arrives (lane 2H).
  facts          the fact table with vintage (web/public/data/facts/) reproduces every current figure of companies/<id>.json exactly
                 (value, page, report, flags) and every statement pair of restatements.json (both prints, reports, pages); one current
                 row per cell, derived rows equal their inputs, every line id in the taxonomy (pipeline/build_facts.py --check, lane FT).
  assets         quarterly asset lists (web/public/data/assets/): classes add up to the total, every quarter has its source files and
                 passed the file validation, and the files equal a rebuild from data/work/asset_lists (lane AL); a skipped rebuild warns.
  solvency … macro   the published layers outside the statements: source, type/unit, value on its cited page (pipeline/gate_layers.py, lane G)
  cards          report cards (web/public/data/cards/): every digit a card shows is a fact token, and every fact equals the published figure
                 it cites or its operation over cited inputs (pipeline/check_cards.py, lane S2)
  feed           the delta feed (web/public/data/feed.json, module M2): every event has a date, a source and a type, no event twice,
                 every figure re-read from the published file it cites (pipeline/check_feed.py)
  fragility      module A10, the Fragility Monitor: web/public/data/fragility.json equals a rebuild (pipeline/build_fragility.py --check);
                 every signal in a data state carries provenance and an as-of date and follows its stated rule; no composite field (score,
                 rating, index, total, rank ...) exists anywhere in the file; every event figure equals the history it cites. And
                 `fragility_lib`: the page's rules (web/src/lib/fragility.ts) give the same states, and the A2 engine (scenarios.ts) the same
                 worst-case headroom (web/tests/fragility.unit.ts, run in node)
  attribution    the attribution engine (web/public/data/attribution/, module A4) equals a rebuild (pipeline/build_attribution.py --check):
                 every bridge's contributions plus its residual sum to its total within rounding, from + total = to, ROE recomputes
                 from the facts it cites, and every contribution has inputs that open down to a report and page
"""
import collections
import datetime as dt
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
WORK = ROOT / "data" / "work"
KNOWN = Path(__file__).resolve().parent / "gate_known.json"  # misses already investigated and accepted as warnings (pipeline/gate.py --baseline)
CACHE = Path(os.environ.get("FOX_CACHE", Path.home() / ".cache" / "fox")) / "pages.json"  # page texts never change once split
POOL = ThreadPoolExecutor(48)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_additivity  # noqa: E402
import check_schemas  # noqa: E402
import gate_layers  # noqa: E402  (lane G: solvency, capital, adjusted, targets, decks, image notes, debt, ownership, macro)
import gate_s3  # noqa: E402  (lane S3: stress-lab reproduction, credibility ledger)

LATIN = re.compile(r"[A-Za-z][A-Za-z'\-]*(?:[\s,/&()\-]+[A-Za-z][A-Za-z'\-]*){2,}")
PROPER = ("S&P Global Ratings",)  # a proper name is not untranslated text
PLACEHOLDER = re.compile(r"ללא (תווית|כותרת)")
SHARES = re.compile(r"מספר ה?מניות|ממוצע ה?משוקלל|הממוצע המשוקלל")
NONFLOW = re.compile(r"לתחילת|לסוף|^יתרת|יתרה ל|מספר ה?מניות|משוקלל|למניה|שיעור|יחס |באחוזים|%|באלפים")
BIDI = re.compile(r"[‎‏‪-‮⁦-⁩]")
checks = []


def add(id_, ok, n, fail, note, level="fail"):
    checks.append({"id": id_, "ok": bool(ok), "level": level, "n": n, "fail": fail, "note": note})
    print(f"{'PASS' if ok else 'FAIL' if level == 'fail' else 'WARN'}  {id_:12} n={n} fail={fail}  {note}", flush=True)


def run_script(id_, script):
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / script)], capture_output=True, text=True)
    tail = [l for l in p.stdout.strip().splitlines() if l.strip()]
    probs = [l for l in tail if re.search(r"[1-9]\d* problems|differences", l)]
    add(id_, p.returncode == 0, len(tail), 0 if p.returncode == 0 else max(1, len([l for l in tail if not l.endswith(" 0 problems")])),
        (probs[-1] if probs else tail[-1] if tail else p.stderr.strip()[-200:])[:200])


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def workbooks():
    files = [f for f in sorted((DATA / "companies").glob("*.json")) if f.name.count(".") == 1 and f.stem != "index"]
    return dict(zip([f.stem for f in files], POOL.map(load, files)))


def additivity(wbs):
    res = check_additivity.run(2024)
    same, mixed, worst = collections.Counter(), collections.Counter(), []
    n_by = collections.Counter()
    for comp, x in res.items():
        d = wbs[comp]
        P = d["periods"]
        src = {}
        for f in d["facts"]:
            p = P[f[1]]
            src[(f[0], p["type"], p["end"])] = f[4] if len(f) > 4 else None
        ids = collections.defaultdict(list)
        for i, m in enumerate(d["metrics"]):
            ids[(m["sheet"], m["label"])].append(i)
        n_by[comp] = x["checks"]["IFRS 17"][0]
        for sh, lab, t, e, xs in x["fails"]:
            y = e[:4]
            parts = [("Q", f"{y}-03-31"), ("Q", f"{y}-06-30"), ("H", f"{y}-06-30")] if t == "H" else [("H", f"{y}-06-30"), ("Q", f"{y}-09-30"), ("9M", f"{y}-09-30")]
            one = any(len({src.get((i,) + p) for p in parts}) == 1 and None not in {src.get((i,) + p) for p in parts} for i in ids[(sh, lab)])
            (same if one else mixed)[comp] += 1
            if one:
                worst.append(f"{comp} {lab[:30]} {t} {e}")
    ins = [c for c in res if res[c]["checks"]["IFRS 17"][0]]
    bad = [c for c in ins if same[c] > 0.005 * n_by[c]]
    n = sum(n_by[c] for c in ins)
    add("additivity", not bad, n, sum(same[c] for c in ins),
        "same-report misses (IFRS 17, 2024+): " + (", ".join(f"{c} {same[c]}" for c in ins if same[c]) or "none") + (f"; e.g. {worst[0]}" if worst else ""))
    m = sum(mixed[c] for c in ins)
    add("additivity_vintage", m == 0, n, m, "misses across reports (restated between reports; full vintage model is Phase 3): "
        + ", ".join(f"{c} {mixed[c]}/{n_by[c]}" for c in ins if mixed[c]), level="warn")
    fh = [c for c in res if not res[c]["checks"]["IFRS 17"][0]]
    nf = sum(res[c]["checks"]["one"][0] for c in fh)
    ff = sum(res[c]["checks"]["one"][1] for c in fh)
    sf = sum(same[c] for c in fh)
    add("additivity_funds", ff == 0, nf, ff, f"fund houses, 2024+: {sf} same-report misses, {ff - sf} across reports", level="warn")


def units_labels(wbs):
    nis_bad, sh_bad, lat, ph, der = [], [], [], [], []
    n_nis = n_lab = n_der = 0
    for comp, d in wbs.items():
        vals = collections.defaultdict(list)
        flags = collections.defaultdict(list)
        for x in d["facts"]:
            vals[x[0]].append(x[2])
            if len(x) > 5 and x[5] & 1:
                flags[x[0]].append(x)
        for i, m in enumerate(d["metrics"]):
            lab = m["label"] + (f" · {m['dim']}" if m.get("dim") else "")
            n_lab += 1
            t = lab
            for p in PROPER:
                t = t.replace(p, "")
            if LATIN.search(t):
                lat.append(f"{comp}: {lab[:60]}")
            if PLACEHOLDER.search(lab):
                ph.append(f"{comp}: {lab[:60]}")
            if m["unit"] == "nis":
                for v in vals[i]:
                    n_nis += 1
                    if abs(v) > 500 or 0 < abs(v) < 0.01:
                        nis_bad.append(f"{comp}: {m['label'][:40]} {v}")
            if m["sheet"].startswith("X.") and not m["header"] and m["unit"] != "shares" and SHARES.search(m["label"]):
                sh_bad.append(f"{comp}: {m['label'][:50]} ({m['unit']})")
            if flags[i]:
                n_der += len(flags[i])
                if m["unit"] in ("nis", "shares", "pct") or (m["sheet"].startswith("X.") and NONFLOW.search(m["label"])):
                    der.append(f"{comp}: {m['label'][:40]} ×{len(flags[i])}")
    add("units", not nis_bad and not sh_bad, n_nis, len(nis_bad) + len(sh_bad),
        f"{len(nis_bad)} per-share values outside [0.01, 500], {len(sh_bad)} share-count lines not tagged shares" + (f"; e.g. {(nis_bad + sh_bad)[0]}" if nis_bad or sh_bad else ""))
    add("latin", not lat, n_lab, len(lat), "labels with 3+ consecutive Latin words" + (f"; e.g. {lat[0]}" if lat else ""))
    add("placeholder", not ph, n_lab, len(ph), "placeholder captions" + (f"; e.g. {ph[0]}" if ph else ""))
    add("derived", not der, n_der, len(der), "derived Q4/H2 figures on non-flow lines" + (f"; e.g. {der[0]}" if der else ""))


def page_texts(paths):
    cache = {}
    try:
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    todo = [p for p in paths if p not in cache]

    def read(p):
        f = ROOT / p
        try:
            return p, BIDI.sub("", f.read_text(encoding="utf-8"))
        except OSError:
            return p, None
    for p, t in POOL.map(read, todo):
        cache[p] = t
    if todo:
        try:
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    return cache


def on_page(v, text):
    a = abs(v)
    # as converted (NIS millions from thousands: x 1000), as printed in millions, or in billions (AUM tables)
    forms = {f"{a:,.0f}", f"{a:,.1f}", f"{a:,.2f}", f"{round(a * 1000):,}", f"{a / 1000:,.0f}", f"{a / 1000:,.1f}", f"{a / 1000:,.2f}"}
    if a == int(a):
        forms.add(str(int(a)))
    # not part of a longer number; a comma or full stop of the right-to-left text layer may stand right before it (",9.25%", ".12%")
    return any(re.search(rf"(?<!\d)(?<!\d[.,]){re.escape(x)}(?![\d])", text) for x in forms if x not in ("0", "0.0", "0.00"))


def ifrs_pages():
    files = sorted(DATA.glob("ifrs_*.json"))
    combined = dict(zip([f.stem[5:] for f in files], POOL.map(load, files)))
    # the per-company slices are copies of the combined file
    slices = sorted((DATA / "ifrs").glob("*/*.json"))
    loaded = list(POOL.map(load, slices))
    mism = sum(1 for f, rows in zip(slices, loaded) if rows != [r for r in combined.get(f.stem, []) if r["c"] == f.parent.name])
    add("ifrs_slices", mism == 0, len(slices), mism, "web/public/data/ifrs/<company>/<period>.json equal to the company's rows of ifrs_<period>.json")
    manifest = load(WORK / "manifest_quarters.json") if (WORK / "manifest_quarters.json").exists() else {}
    folders = {}

    def subdirs(key):
        try:
            return key, [p.name for p in (WORK / key).iterdir() if p.is_dir()]
        except OSError:
            return key, []
    keys = {f"{r['c']}_{p}" for p, rows in combined.items() for r in rows}
    folders = dict(POOL.map(subdirs, sorted(keys)))

    def folder(r, period):
        key = f"{r['c']}_{period}"
        subs = folders.get(key, [])
        kind = "he"
        if r.get("u"):
            rid = re.search(r"P(\d+)-", r["u"])
            rid = int(rid.group(1)) if rid else None
            kind = next((k for k, v in manifest.get(key, {}).items() if isinstance(v, dict) and v.get("report_id") == rid), "pres" if r.get("src") == "pres" else "en")
        hit = [s for s in subs if s == kind or s.startswith(kind + "_")]
        return f"data/work/{key}/{hit[0]}" if hit else None

    want = {}
    for period, rows in combined.items():
        for r in rows:
            if r.get("pg") is None or not isinstance(r.get("v"), (int, float)) or r["v"] == 0:
                continue  # a zero is printed as a dash
            fo = folder(r, period)
            want.setdefault(f"{fo}/p{int(r['pg']):03d}.txt" if fo else None, []).append((period, r))
    texts = page_texts([p for p in want if p])
    n = found = missing_text = 0
    misses = []
    for p, rs in want.items():
        t = texts.get(p) if p else None
        for period, r in rs:
            if t is None:
                missing_text += 1
                continue
            n += 1
            if on_page(r["v"], t) or ("v0" in r and on_page(r["v0"], t)):
                found += 1
            else:
                misses.append(f"{r['c']} {period} p{r['pg']} {r['m'][:30]} {r['v']} [{p.split('/')[-2]}]")
    miss = n - found
    by_c = collections.Counter(x.split()[0] for x in misses)
    # Known misses (a CSM bridge drawn as a graphic, a target written in words, a table that is an image in the PDF) were investigated and
    # are listed in gate_known.json: they warn. Any other miss fails: a new extraction put a figure on the wrong page.
    known = set(load(KNOWN).get("ifrs_page", [])) if KNOWN.exists() else set()
    new = [x for x in misses if x not in known]
    add("ifrs_page", not new, n, len(new), f"{found}/{n} on the cited page; {len(new)} new misses" + (f", e.g. {new[0]}" if new else "")
        + f"; {missing_text} facts without page text (not checked)")
    add("ifrs_page_known", miss == len(new), n, miss - len(new), f"known misses, extraction layer (graphics, image pages, targets in words): {dict(by_c)}", level="warn")
    return misses


def cross_layer():
    kpi = load(DATA / "kpi.json")["companies"]
    lines = load(DATA / "lines.json")
    periods = [tuple(p) for p in lines["periods"]]
    n = bad = 0
    notes, skipped = [], []
    for key, kk, typ in (("np_attr", "profit", "Q"), ("equity_attr", "equity", "I")):
        for comp, x in lines["data"][key].items():
            k = kpi.get(comp)
            if not k or "2026Q2" not in k["periods"]:
                skipped.append(f"{comp}:{kk}")
                continue
            xv = k["values"][kk][k["periods"].index("2026Q2")]
            cell = next((c for c in x["cells"] if periods[c[0]] == (typ, "2026-06-30")), None)
            if cell is None or xv is None:
                skipped.append(f"{comp}:{kk}")
                continue
            n += 1
            if abs(cell[1] - xv) > max(1500, 0.001 * abs(xv)):
                bad += 1
                notes.append(f"{comp} {kk}: statements {cell[1]:,.0f} vs XBRL {xv:,.0f}")
    add("cross_layer", bad == 0, n, bad, "Q2'26 attributable profit and equity, XBRL = statements"
        + (f"; {'; '.join(notes[:4])}" if notes else "") + (f"; not comparable: {', '.join(skipped)}" if skipped else ""))


A_RE = re.compile(r"^סך (כל )?ה?נכסים$")
LE_RE = re.compile(r"^סך (כל )?ה?(הון וה?התחייבויות|התחייבויות וה?הון)$")


def balance(wbs):
    """Total assets against total equity and liabilities, each assets row paired with the equity-and-liabilities row of its own block."""
    n = warn = bad = 0
    worst = []
    for comp, d in wbs.items():
        ms = [(i, m) for i, m in enumerate(d["metrics"]) if m.get("sheet") == "X.מאזן" and not m.get("header")]
        cap = lambda m: re.sub(r"\s+", " ", re.sub(r"[\"'״׳*,]", "", re.sub(r"סה\s*כ|סך\s+ה?כל", "סך", m["label"]))).strip()
        assets = [i for i, m in ms if A_RE.match(cap(m))]
        les = [i for i, m in ms if LE_RE.match(cap(m))]
        val = collections.defaultdict(dict)
        for f in d["facts"]:
            val[f[0]][f[1]] = f[2]
        for a in assets:
            le = min((x for x in les if x > a), default=None)
            if le is None:
                continue
            for pi, va in val[a].items():
                vl = val[le].get(pi)
                if vl is None or not va:
                    continue
                n += 1
                diff = abs(va - vl)
                if diff > max(2000, 0.0005 * abs(va)):
                    rel = diff / abs(va)
                    if rel > 0.01:
                        bad += 1
                    else:
                        warn += 1
                    worst.append((rel, comp, d["periods"][pi]["id"], va, vl))
    worst.sort(reverse=True)
    note = "; ".join(f"{c} {p}: {a:,.0f} vs {l:,.0f}" for _, c, p, a, l in worst[:4])
    add("balance", bad == 0, n, bad, f"A = L+E at every balance date; >1% off: {bad}" + (f" ({note})" if bad else ""))
    if warn:
        add("balance_round", False, n, warn, f"off by more than rounding but under 1%: {note}", level="warn")


def lens():
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_lens.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    add("lens", p.returncode == 0, 1, 0 if p.returncode == 0 else 1, out[0][:200])


def flow_npv():
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_flow_npv.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    add("flow_npv", p.returncode == 0, 1, 0 if p.returncode == 0 else 1, " · ".join(out[:2])[:200])


def drivers():
    """module A1: the driver graph files rebuild byte-equal and verify; the TS propagation library reproduces them"""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_drivers.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    add("drivers", p.returncode == 0, 1, 0 if p.returncode == 0 else max(1, len(out) - 1), " · ".join(out[:2])[:200])
    node = gate_s3.NODE
    if not node:
        return add("drivers_lib", False, 0, 1, "node not found: drivers.ts not checked", level="warn")
    q = subprocess.run([node, "scripts/drivers-test.mjs"], cwd=ROOT / "web", capture_output=True, text=True)
    lines = [l for l in q.stdout.strip().splitlines() if l.strip()]
    tail = next((l for l in lines if " passed, " in l), (q.stderr.strip() or "no output")[-160:])
    fails = [l.strip() for l in lines if l.strip().startswith("FAIL")]
    add("drivers_lib", q.returncode == 0, int(re.search(r"(\d+) passed", tail).group(1)) if " passed" in tail else 0, len(fails) or (0 if q.returncode == 0 else 1),
        (tail.replace("drivers: ", "") + (f"; e.g. {fails[0][5:]}" if fails else ""))[:200])


def regulation():
    """module A8: the impact file rebuilds equal and verifies; the TS propagation library reproduces every product shock"""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_regulation.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    add("regulation", p.returncode == 0, 1, 0 if p.returncode == 0 else max(1, len(out) - 1), " · ".join(out[:2])[:200])
    node = gate_s3.NODE
    if not node:
        return add("regulation_lib", False, 0, 1, "node not found: regulation impacts not re-propagated", level="warn")
    q = subprocess.run([node, "scripts/regulation-test.mjs"], cwd=ROOT / "web", capture_output=True, text=True)
    lines = [l for l in q.stdout.strip().splitlines() if l.strip()]
    tail = next((l for l in lines if " passed, " in l), (q.stderr.strip() or "no output")[-160:])
    fails = [l.strip() for l in lines if l.strip().startswith("FAIL")]
    add("regulation_lib", q.returncode == 0, int(re.search(r"(\d+) passed", tail).group(1)) if " passed" in tail else 0, len(fails) or (0 if q.returncode == 0 else 1),
        (tail.replace("regulation: ", "") + (f"; e.g. {fails[0][5:]}" if fails else ""))[:200])


def warroom():
    """module A5: the war room's elasticities and board rebuild byte-equal and verify"""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_warroom.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    m = re.findall(r" n (\d+) ", out[0])
    add("warroom", p.returncode == 0, sum(int(x) for x in m), 0 if p.returncode == 0 else max(1, len(out) - 1), " · ".join(out[:2])[:200])
    node = gate_s3.NODE
    if not node:
        return add("warroom_lib", False, 0, 1, "node not found: warroom.ts not checked", level="warn")
    q = subprocess.run([node, "scripts/warroom-test.mjs"], cwd=ROOT / "web", capture_output=True, text=True)
    lines = [l for l in q.stdout.strip().splitlines() if l.strip()]
    tail = next((l for l in lines if " passed, " in l), (q.stderr.strip() or "no output")[-160:])
    fails = [l.strip() for l in lines if l.strip().startswith("FAIL")]
    add("warroom_lib", q.returncode == 0, int(re.search(r"(\d+) passed", tail).group(1)) if " passed" in tail else 0, len(fails) or (0 if q.returncode == 0 else 1),
        (tail.replace("warroom: ", "") + (f"; e.g. {fails[0][5:]}" if fails else ""))[:200])


def capital():
    """module A7: the capital options file rebuilds equal and verifies; the TS library reproduces it and runs the A2 overlay"""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_capital.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    add("capital", p.returncode == 0, 1, 0 if p.returncode == 0 else max(1, len(out) - 1), " · ".join(out[:2])[:200])
    node = gate_s3.NODE
    if not node:
        return add("capital_lib", False, 0, 1, "node not found: capital.ts not checked", level="warn")
    q = subprocess.run([node, "scripts/capital-test.mjs"], cwd=ROOT / "web", capture_output=True, text=True)
    lines = [l for l in q.stdout.strip().splitlines() if l.strip()]
    tail = next((l for l in lines if " passed, " in l), (q.stderr.strip() or "no output")[-160:])
    fails = [l.strip() for l in lines if l.strip().startswith("FAIL")]
    add("capital_lib", q.returncode == 0, int(re.search(r"(\d+) passed", tail).group(1)) if " passed" in tail else 0, len(fails) or (0 if q.returncode == 0 else 1),
        (tail.replace("capital: ", "") + (f"; e.g. {fails[0][5:]}" if fails else ""))[:200])


def expectations():
    """module A3: the expectations files rebuild equal and verify (solved inputs reproduce the market value, provenance, price date, no NaN)"""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_expectations.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    m = re.search(r"(\d+) solved inputs", out[0])
    add("expectations", p.returncode == 0, int(m.group(1)) if m else 0, 0 if p.returncode == 0 else max(1, len(out) - 1), " · ".join(out[:2])[:200])


def nowcast():
    """module M1: the rebuild check plus the append-only ledger, compared with the committed files at HEAD"""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_nowcast.py"), "--check"], capture_output=True, text=True)
    out = (p.stdout.strip() or p.stderr.strip() or "no output").splitlines()
    add("nowcast", p.returncode == 0, 1, 0 if p.returncode == 0 else 1, out[0][:200])
    append_only("nowcast_ledger", "data/ledger/nowcast", "frozen estimates")


def append_only(id_, led, what):
    """an append-only ledger: every file under `led` at git HEAD is still there, byte for byte (new files may be added)"""
    ls = subprocess.run(["git", "ls-tree", "-r", "--name-only", "HEAD", "--", led], cwd=ROOT, capture_output=True, text=True)
    if ls.returncode:
        return add(id_, False, 0, 1, "git HEAD not readable: ledger immutability not checked", level="warn")
    top = subprocess.run(["git", "rev-parse", "--show-prefix"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    files = [f[len(top):] if top and f.startswith(top) else f for f in ls.stdout.split()]
    bad = []
    for f in files:
        head = subprocess.run(["git", "show", f"HEAD:./{f}"], cwd=ROOT, capture_output=True)
        cur = ROOT / f
        if not cur.exists():
            bad.append(f"{f} removed")
        elif head.returncode or head.stdout != cur.read_bytes():
            bad.append(f"{f} changed")
    add(id_, not bad, len(files), len(bad), (f"{len(files)} {what} at HEAD unchanged" if not bad else "; ".join(bad))[:200])


def positions():
    """module A6: positions.json equals a rebuild without drafts, every ledger entry is valid (at least one falsifier, every evidence
    ref and metric resolves, revisions chained, outcomes dated), and the ledger is append-only against git HEAD"""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_positions.py"), "--check"], capture_output=True, text=True)
    out = (p.stdout.strip() or p.stderr.strip() or "no output").splitlines()
    add("positions", p.returncode == 0, 1, 0 if p.returncode == 0 else max(1, len(out) - 1), out[0][:200])
    append_only("positions_ledger", "data/ledger/positions", "position ledger entries")


def consistency():
    """Lane Q: one figure per entity, period and metric on every page that serves it (pipeline/check_consistency.py)."""
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "check_consistency.py")], capture_output=True, text=True)
    try:
        r = load(DATA / "consistency.json")
    except (OSError, ValueError):
        add("consistency", False, 0, 1, (p.stdout + p.stderr).strip()[-200:])
        return
    ex = r["exceptions"]
    c = r["conflicts"]
    c = c + [{"entity": k[0], "metric": k[1], "period": k[2], "a": "allow-list", "va": 0, "b": "no longer needed", "vb": 0} for k in r.get("stale_allow", [])]
    add("consistency", not c, r["pairs"], len(c), f"{r['passed']} equal within rounding, {sum(x['n'] for x in ex.values())} labelled basis differences ("
        + ", ".join(f"{k} {x['n']}" for k, x in ex.items()) + f"), last 8 quarters" + (f"; e.g. {c[0]['entity']} {c[0]['metric']} {c[0]['period']}: {c[0]['a']} {c[0]['va']:,} vs {c[0]['b']} {c[0]['vb']:,}" if c else "")
        + (f"; {p.stdout.strip().splitlines()[-1][:80]}" if p.returncode and not c and p.stdout.strip() else ""))
    f = r["fund_roles"]
    bad = [x for x in f["rows"] if not x["ok"] and not x["basis"]]
    add("fund_roles", not bad, f["n"], len(bad), "fund houses, last 4 quarters: attributable profit and comprehensive income on the company page = XBRL"
        + (f"; e.g. {bad[0]['entity']} {bad[0]['metric']} {bad[0]['period']}: page {bad[0]['page']:,} vs XBRL {bad[0]['xbrl']:,}" if bad else ""))
    if r["older"]:
        add("consistency_old", False, r["pairs"], r["older"], "conflicts older than 8 quarters (IFRS 4 era, tag corrections; python3 pipeline/check_consistency.py --all)", level="warn")


def schemas():
    n, bad, summary = check_schemas.run(quiet=True)
    add("schemas", not bad, n, len(bad), summary + (f"; e.g. {bad[0][0]}: {bad[0][2][0]}" if bad else ""))


def cards():  # lane S2: the digit validator of the report cards
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "check_cards.py"), "--quiet"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()]
    m = re.search(r"(\d+) cards, (\d+) facts, (\d+) problems", out[-1] if out else "")
    add("cards", p.returncode == 0 and bool(m), int(m.group(2)) if m else 0, int(m.group(3)) if m else 1,
        (f"{m.group(1)} report cards, every digit a published fact" if m and p.returncode == 0 else (out[-1] if out else p.stderr.strip()[-200:]))[:200])


def feed():  # module M2: the delta feed
    import check_feed
    try:
        n, n_fig, probs, summary = check_feed.run(quiet=True)
    except (OSError, ValueError, KeyError) as e:
        return add("feed", False, 0, 1, f"feed.json unreadable: {e}"[:200])
    add("feed", not probs, n, len(probs), (summary + (f"; e.g. {probs[0]}" if probs else ""))[:200])


def fragility():  # module A10
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_fragility.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    add("fragility", p.returncode == 0, 1, 0 if p.returncode == 0 else max(1, len(out) - 1), out[0][:200])
    node = gate_s3.NODE
    if not node:
        return add("fragility_lib", False, 0, 1, "node not found: fragility.ts not checked", level="warn")
    q = subprocess.run([node, "scripts/fragility-test.mjs"], cwd=ROOT / "web", capture_output=True, text=True)
    lines = [l for l in q.stdout.strip().splitlines() if l.strip()]
    tail = next((l for l in lines if " passed, " in l), (q.stderr.strip() or "no output")[-160:])
    fails = [l.strip() for l in lines if l.strip().startswith("FAIL")]
    add("fragility_lib", q.returncode == 0, int(re.search(r"(\d+) passed", tail).group(1)) if " passed" in tail else 0, len(fails) or (0 if q.returncode == 0 else 1),
        (tail.replace("fragility: ", "") + (f"; e.g. {fails[0][5:]}" if fails else ""))[:200])


def attribution():  # module A4
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_attribution.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()] or [p.stderr.strip()[-200:]]
    m = re.search(r"(\d+) decompositions", out[-1])
    add("attribution", p.returncode == 0, int(m.group(1)) if m else 0, 0 if p.returncode == 0 else 1, out[-1][:200])


def facts():
    p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_facts.py"), "--check"], capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()]
    m = re.search(r"(\d+) workbook figures", out[-1] if out else "")
    add("facts", p.returncode == 0, int(m.group(1)) if m else 0, 0 if p.returncode == 0 else max(1, len(out) - 1),
        ((out[-1] if out else p.stderr.strip()[-200:]) if p.returncode == 0 else " · ".join(out[:2]))[:200])


def assets():  # lane AL
    """quarterly asset lists: every published quarter adds up (classes = total within rounding), carries its source files and passed
    the file validation; the files equal a rebuild from data/work/asset_lists (skipped with a warning where data/work is absent)."""
    d = DATA / "assets"
    if not (d / "index.json").exists():
        return add("assets", False, 0, 1, "no asset-list files", level="warn")
    n, bad = 0, []
    for m in load(d / "index.json")["managers"]:
        if not m["latest"]:
            continue
        doc = load(d / f"{m['id']}.json")
        for q, s in doc["series"].items():
            n += 1
            if abs(sum(s["cls"].values()) - s["total"]) > 0.05 * len(s["cls"]) + 0.1:
                bad.append(f"{m['id']} {q}: classes {sum(s['cls'].values()):.1f} vs total {s['total']}")
            if not s["src"] or not all(x.get("url") and x.get("retrieved") for x in s["src"]):
                bad.append(f"{m['id']} {q}: source file missing")
            if not s["val"]["ok"]:
                bad.append(f"{m['id']} {q}: file validation failed")
    note = f"{n} manager-quarters"
    if (ROOT / "data" / "work" / "asset_lists").exists():
        p = subprocess.run([sys.executable, str(ROOT / "pipeline" / "build_assets.py"), "--check"], capture_output=True, text=True)
        if p.returncode and ("OSError" in p.stderr or "Errno" in p.stderr):
            # the work cache sits on the synced drive: an unreadable or half-synced parquet is a cache problem, not a data error
            note += "; rebuild skipped (work cache unreadable: " + p.stderr.strip().splitlines()[-1][:80] + ")"
        elif p.returncode:
            bad.append((p.stdout.strip() or p.stderr.strip())[-160:])
        note += "; rebuild equal" if not p.returncode else ""
    else:
        note += "; rebuild skipped (no data/work/asset_lists)"
    if bad:
        add("assets", False, n, len(bad), bad[0][:200])
    elif "skipped" in note:  # the sums and sources passed but the rebuild-equality step did not run: a warning, never a pass
        add("assets", False, n, 1, note[:200], level="warn")
    else:
        add("assets", True, n, 0, note[:200])


def main():
    t0 = dt.datetime.now()
    if "--baseline" in sys.argv:  # accept today's value-on-page misses as known (after reviewing them)
        misses = ifrs_pages()
        gate_layers.run(lambda *a, **k: None)
        known = {"ifrs_page": sorted(misses), **{k: sorted(v) for k, v in gate_layers.MISSES.items() if v}}
        KNOWN.write_text(json.dumps(known, ensure_ascii=False, indent=1), encoding="utf-8")
        print(sum(len(v) for v in known.values()), "misses written to", KNOWN)
        return 0
    run_script("workbook", "check_workbook.py")
    run_script("prov", "verify_prov.py")
    wbs = workbooks()
    additivity(wbs)
    units_labels(wbs)
    ifrs_pages()
    balance(wbs)
    cross_layer()
    lens()
    flow_npv()
    drivers()
    regulation()
    warroom()
    capital()
    expectations()
    nowcast()
    positions()
    consistency()
    schemas()
    cards()
    feed()
    fragility()
    attribution()
    facts()
    assets()
    gate_layers.run(add)
    gate_s3.run(add)
    out = {"built": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "checks": checks}
    (DATA / "qa.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    failed = [c["id"] for c in checks if not c["ok"] and c["level"] == "fail"]
    print(f"{len(checks)} checks, {len(failed)} failed{': ' + ', '.join(failed) if failed else ''}; "
          f"{sum(1 for c in checks if not c['ok'] and c['level'] == 'warn')} warnings; {(dt.datetime.now() - t0).seconds}s -> web/public/data/qa.json")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
