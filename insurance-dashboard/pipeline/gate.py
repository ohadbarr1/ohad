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
  lens           web/public/data/lens.json equals a rebuild from market.json + lts.json (pipeline/build_lens.py --check), and every
                 derived Savings Lens figure equals its formula over the inputs printed beside it (lane 2C).
  cross_layer    Q2'26 profit attributable to shareholders (quarter) and equity attributable (30.6.26): XBRL (kpi.json) = the
                 statements workbooks (lines.json), within rounding of a figure printed in NIS millions (NIS 1.5m) or 0.1%.
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


def main():
    t0 = dt.datetime.now()
    if "--baseline" in sys.argv:  # accept today's value-on-page misses as known (after reviewing them)
        misses = ifrs_pages()
        KNOWN.write_text(json.dumps({"ifrs_page": sorted(misses)}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(len(misses), "misses written to", KNOWN)
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
    out = {"built": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "checks": checks}
    (DATA / "qa.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    failed = [c["id"] for c in checks if not c["ok"] and c["level"] == "fail"]
    print(f"{len(checks)} checks, {len(failed)} failed{': ' + ', '.join(failed) if failed else ''}; "
          f"{sum(1 for c in checks if not c['ok'] and c['level'] == 'warn')} warnings; {(dt.datetime.now() - t0).seconds}s -> web/public/data/qa.json")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
