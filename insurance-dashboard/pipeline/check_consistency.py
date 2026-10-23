"""Cross-page consistency: one entity, one period, one metric shows one figure on every page that serves it.

python3 pipeline/check_consistency.py [--all] [--json]       (standard library only; reads web/public/data, a few seconds)
Writes web/public/data/consistency.json (the /data page panel). Exit code 1 on any failure. gate.py runs it as checks
`consistency` and `fund_roles`.

Surfaces (each is the figure as a page shows it, with that page's own arithmetic mirrored here):
  kpi          kpi.json after canon (printed figure where it and the tag differ by rounding)  → home, KPI cards, valuation inputs
  home         kpi.json `entity` where the listed filer is another entity: the company itself at 100% from its own statements through the
               Report Day roles (Yelin Lapidot; Atrao's XBRL stays under `kpi`, tagged `filer`)                   → home
               Q4 = canon Q4 (FY − printed 9M) or FY − Q1 − Q2 − Q3, LTM = four quarters (lib/kpi.ts)
  day          companies/<id>.json read through the Report Day roles (ROLES/linesOf/figAt/ltmAt of pages/ReportDay.tsx; the role
               patterns are read from that file, so a change there is checked here)                    → company home, KPI ledger
  lines        lines.json statement roles (build_workbook.py role mapping)                                → statements across companies
  peers.fs / peers.xbrl / peers.ifrs   peers/m/*.json cells; Q4 / Q2 / LTM as lib/registry.ts derives them → peer table
  capital      csm/capital.json (profit, comprehensive income, equity per quarter)                        → /industry/csm?view=capital
  csm          csm/summary.json `resolved` (the one CSM rule), csm/facts/<id>.json, peers ifrs-csm_closing  → ledger, company, peers, valuation
Comparable metrics: profit = net profit attributable to shareholders; oci = comprehensive income attributable; pretax; eps (basic);
equity = equity attributable; assets = total assets; np = profit for the period incl. minorities; csm = closing CSM (one rule).

Tolerance ("within rounding"): a figure is printed in NIS thousands or millions. Two figures of the same precision must be the same
number (a difference cannot be rounding: it is a different line, period, sign or derivation — e.g. Q4 as FY − 9M on one page and
FY − Q1 − Q2 − Q3 on another). Across precisions the allowance is half the coarser unit per rounded input (a sum of four quarters
printed in millions may differ from the thousands figure by NIS 2m).

Basis differences that are labelled on the page are exceptions, never failures, and are listed with their reason:
  filer        kpi.json `filer` (Yelin: XBRL of Atrao, which holds 50%, on the KPI cards and the peer table's XBRL columns; home and the
               company page show Yelin Lapidot at 100%, compared with each other without exception)
  std          one side IFRS 4 as originally reported, the other IFRS 17 (insurers before 2025)
  restated     one side read from a later report that reprints the period (flag 8 / 64, or another report than the period's own)
  alt          Report Day shows the profit-for-the-period row where the filer prints no attribution row (chip on the page)
  allow-list   pipeline/consistency_allow.json, each entry verified against the filing page, with its reason
Without --all only the comparisons of the last eight quarters are checked (older periods are reported, not failed).
"""
import collections
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reportday  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
ALLOW = Path(__file__).resolve().parent / "consistency_allow.json"
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "Q4": "12-31", "FY": "12-31"}
QOF = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}
PAGES = {"kpi": "בית · כרטיסי KPI · הערכת שווי", "home": "בית (החברה עצמה, 100%)", "day": "דף החברה · יום הדוח", "lines": "דוחות כספיים (השוואה)", "peers.fs": "טבלת עמיתים · דוחות",
         "peers.xbrl": "טבלת עמיתים · XBRL", "peers.ifrs": "טבלת עמיתים · IFRS 17", "capital": "CSM · הון", "csm": "CSM · ספר", "csm.co": "CSM · קובץ החברה", "csm.ts": "CSM · דף החברה והערכת שווי (lib/csmResolve.ts)",
         "peers.csm": "טבלת עמיתים · CSM"}
M_HE = {"profit": "רווח נקי לבעלי המניות", "oci": "רווח כולל לבעלי המניות", "pretax": "רווח לפני מס", "eps": "רווח למניה", "equity": "הון לבעלי המניות",
        "assets": "סך הנכסים", "np": "רווח לתקופה", "teq": "סך ההון", "csm": "CSM"}
load = lambda p: json.loads(p.read_text(encoding="utf-8"))


class Obs:
    __slots__ = ("surf", "v", "prec", "n", "der", "rep", "std", "tag")

    def __init__(self, surf, v, prec, n=1, der=False, rep=None, std=None, tag=None):
        self.surf, self.v, self.prec, self.n, self.der, self.rep, self.std, self.tag = surf, v, prec, n, der, rep, std, tag


obs = collections.defaultdict(list)  # (entity, metric, period key) -> [Obs]


def put(ent, metric, pk, o):
    obs[(ent, metric, pk)].append(o)


def prec_m(v_m, unit="m"):
    """Precision of a figure in NIS millions: 1 when it is a whole number of millions (printed or tagged in millions), else 0.001."""
    if unit == "nis":
        return 0.01
    if v_m == 0:
        return 0.001
    return 1.0 if abs(v_m - round(v_m)) < 1e-6 else 0.1 if abs(v_m * 10 - round(v_m * 10)) < 1e-6 else 0.001


def qkey(end):
    return end[:4] + QOF[end[5:10]]


def rid_of(u):
    m = re.search(r"P(\d+)-\d+\.pdf", u or "") or re.search(r"reports/(\d+)", u or "")
    return int(m.group(1)) if m else None


def back(pk, k):
    y, q = int(pk[:4]), int(pk[5])
    i = y * 4 + q - 1 - k
    return f"{i // 4}Q{i % 4 + 1}"


# ------------------------------------------------------------------ kpi.json (lib/kpi.ts)
kpi = load(DATA / "kpi.json")["companies"]
KPI_M = {"profit": "profit", "oci": "oci", "pretax": "pretax", "eps": "eps", "equity": "equity", "assets": "assets"}
FLOW = {"profit", "oci", "pretax", "eps", "np"}  # "teq" (total equity) is a balance
kpi_rid = {}


def kpi_obs(ent, c, surf="kpi", tag=None):
    """The figures lib/kpi.ts serves from one kpi.json block (the filer's XBRL, or the company's own statements under `entity`)."""
    canon = c.get("canon") or {}
    status = c.get("status") or [None] * len(c["periods"])
    fix = c.get("fix") or {}
    rids = {}
    for i, p in enumerate(c["periods"]):
        rids[(ent, p if not p.endswith("FY") else p[:4] + "Q4")] = (c.get("rid") or [None] * len(c["periods"]))[i]
    if surf == "kpi":
        kpi_rid.update(rids)
    for key, metric in KPI_M.items():
        vals = c["values"].get(key)
        if not vals:
            continue
        unit = "nis" if key == "eps" else "m"
        raw = {}
        for i, p in enumerate(c["periods"]):
            v = vals[i]
            v = canon.get(key, {}).get(p, [v])[0]
            if v is None or status[i] == "withheld" or fix.get(p, {}).get("t") == "withheld":
                continue
            raw[p] = v if unit == "nis" else v / 1000
        std = lambda p: "4" if int(p[:4]) < 2025 and ent in ("phoenix", "harel", "migdal", "clal", "menora", "hachshara", "ayalon", "idi") else "17"
        if metric in FLOW:
            def quarter(y, q):
                if q < 4:
                    return raw.get(f"{y}Q{q}"), 1
                c4 = canon.get(key, {}).get(f"{y}Q4")
                if c4:
                    return c4[0] / (1 if unit == "nis" else 1000), 2
                parts = [raw.get(f"{y}FY")] + [raw.get(f"{y}Q{k}") for k in (1, 2, 3)]
                return (None, 4) if None in parts else (parts[0] - sum(parts[1:]), 4)
            for p, v in raw.items():
                pk = p[:4] + "FY" if p.endswith("FY") else p
                emit(ent, metric, pk, Obs(surf, v, prec_m(v, unit), std=std(p), tag=tag, rep=rids.get((ent, p if not p.endswith("FY") else p[:4] + "Q4"))))
                if p.endswith("FY"):
                    v4, n = quarter(int(p[:4]), 4)
                    if v4 is not None and unit != "nis":
                        emit(ent, metric, p[:4] + "Q4", Obs(surf, v4, prec_m(v, unit), n, True, std=std(p), tag=tag))
            if unit != "nis":
                qs = [p[:4] + "Q4" if p.endswith("FY") else p for p in c["periods"]]
                for i in range(3, len(qs)):
                    if qs[i].endswith("Q4") and f"{qs[i][:4]}FY" in raw:  # lib/kpi.ts: at a year end the annual figure
                        fy = raw[f"{qs[i][:4]}FY"]
                        emit(ent, metric, "LTM" + qs[i], Obs(surf, fy, prec_m(fy, unit), 1, False, std=std(qs[i]), tag=tag))
                        continue
                    parts = [quarter(int(x[:4]), int(x[5])) for x in qs[i - 3:i + 1]]
                    if any(v is None for v, _ in parts) or len({std(x) for x in qs[i - 3:i + 1]}) > 1:
                        continue
                    v = sum(x for x, _ in parts)
                    emit(ent, metric, "LTM" + qs[i], Obs(surf, v, max(prec_m(x) for x, _ in parts), sum(n for _, n in parts), True, std=std(qs[i]), tag=tag))
        else:
            for p, v in raw.items():
                pk = p[:4] + "Q4" if p.endswith("FY") else p
                emit(ent, metric, pk, Obs(surf, v, prec_m(v, unit), std=std(p), tag=tag, rep=rids.get((ent, pk))))



def emit(ent, metric, pk, o):
    """A row the page names differently is checked under that name: the bottom line where no attribution row is printed (`alt`: like
    Report Day, it is the profit for the period, and stands for the shareholders' profit with the label), total equity where no attributable equity is."""
    if o.surf == "home" and metric in ALT_NOW:
        put(ent, "np" if metric == "profit" else metric, pk, o)
        if metric == "profit":
            put(ent, "profit", pk, Obs(o.surf, o.v, o.prec, o.n, o.der, o.rep, o.std, "alt"))
        return
    put(ent, "teq" if (o.surf == "home" and metric == "equity" and EQ_ALT_NOW) else metric, pk, o)


ALT_NOW, EQ_ALT_NOW = set(), False
for ent, c in kpi.items():
    ALT_NOW, EQ_ALT_NOW = set(), False
    kpi_obs(ent, c, tag="filer" if c.get("filer") else None)
    if c.get("entity"):  # the front page: the company itself at 100% (kpi.json `entity`, pipeline/canon_kpi.py)
        e = c["entity"]
        ALT_NOW, EQ_ALT_NOW = set(e.get("alt") or []), bool(e.get("eq_alt"))
        kpi_obs(ent, dict(e, status=["verified"] * len(e["periods"]), rid=[(e["src"].get("profit") or {}).get(p, [None])[0] for p in e["periods"]]), surf="home")
        ALT_NOW, EQ_ALT_NOW = set(), False

# ------------------------------------------------------------------ lines.json (build_workbook.py roles)
lines = load(DATA / "lines.json")
L_M = {"np_attr": "profit", "np": "np", "pbt": "pretax", "eps": "eps", "equity_attr": "equity", "total_equity": "teq", "total_assets": "assets"}
for role, metric in L_M.items():
    for ent, line in (lines["data"].get(role) or {}).items():
        unit = "nis" if line["unit"] == "nis" else "m"
        for pi, v, pg, ui, fl in line["cells"]:
            t, end = lines["periods"][pi]
            if end[5:10] not in QOF:
                continue
            pk = {"Q": qkey(end), "I": qkey(end), "FY": end[:4] + "FY", "H": end[:4] + ("H1" if end[5:7] == "06" else "H2" if end[5:7] == "12" else "")}.get(t)
            if not pk or pk.endswith("H") or (metric in FLOW) == (t == "I") or (metric not in FLOW and t != "I"):
                continue
            vm = v if unit == "nis" else v / 1000
            u = lines["urls"][ui] if ui is not None else None
            put(ent, metric, pk, Obs("lines", vm, prec_m(vm, unit), 2 if fl & 1 else 1, bool(fl & 1), rid_of(u), "4" if fl & 2 else "17", "restated" if fl & 8 else None))

# ------------------------------------------------------------------ Report Day roles over the workbooks (pages/ReportDay.tsx, via reportday.py)
DAY_M = {"net": "profit", "comp": "oci", "pbt": "pretax", "eq": "equity", "assets": "assets"}
day_roles = {}  # (entity, role) -> (row labels, alt)
BOOKS = reportday.books()
for ent, bk in BOOKS.items():
    for key, metric in DAY_M.items():
        role = reportday.BY_KEY[key]
        rows, alt = bk.resolve(role)
        day_roles[(ent, key)] = ([r["raw"] for r in rows[:2]], alt)
        for end in bk.ends:
            types = ([("Q", qkey(end))] + ([("FY", end[:4] + "FY")] if end.endswith("12-31") else []) + ([("H", end[:4] + "H1")] if end.endswith("06-30") else [])) if role["flow"] else [("I", qkey(end))]
            for typ, pk in types:
                cur = bk.headline(key, typ, end)
                if not cur:
                    continue
                o = Obs("day", cur["v"], prec_m(cur["v"]), 2 if cur["der"] else 1, cur["der"], cur["rid"], cur["std"], "restated" if cur["re"] else None)
                put(ent, metric if not cur["alt"] else "np", pk, o)
                if cur["alt"] and metric == "profit":
                    put(ent, "profit", pk, Obs("day", cur["v"], o.prec, o.n, o.der, o.rep, o.std, "alt"))
            if role["flow"]:
                lt = bk.ltm(key, end)
                if lt:
                    put(ent, metric if not lt["alt"] else "np", "LTM" + qkey(end), Obs("day", lt["v"], max([prec_m(x) for x in lt.get("parts", [lt["v"]])]), lt["n"], lt["der"],
                                                                                      std=lt["std"], tag="alt" if lt["alt"] else "restated" if lt["re"] else None))

# ------------------------------------------------------------------ peer table (lib/registry.ts)
reg = load(DATA / "peers" / "registry.json")
P_M = {"xbrl:profit": "profit", "xbrl:oci": "oci", "xbrl:pretax": "pretax", "xbrl:eps": "eps", "xbrl:equity": "equity", "xbrl:assets": "assets",
       "fs:np_attr": "profit", "fs:np": "np", "fs:pbt": "pretax", "fs:eps": "eps", "fs:equity_attr": "equity", "fs:total_assets": "assets",
       "ifrs:profit_attributable": "profit", "ifrs:comprehensive_income_attributable": "oci", "ifrs:profit_before_tax": "pretax",
       "ifrs:equity_attributable": "equity", "ifrs:total_assets": "assets", "ifrs:csm_closing": "csm"}
for md in reg["metrics"]:
    metric = P_M.get(md["id"])
    if not metric:
        continue
    f = load(DATA / "peers" / "m" / f"{md['f']}.json")
    surf = "peers.csm" if metric == "csm" else "peers." + md["src"]
    unit = md["u"]
    for ent, e in f["e"].items():
        cells = {c[0]: c for c in e["c"]}
        val = lambda p: cells[p][1] if p in cells else None

        sd = lambda c: "4" if (c[4] or 0) & 2 else "17"

        def quarter(q):
            """(value, rounded inputs, standards of the inputs, precision), the way lib/registry.ts derives a quarter it does not store."""
            if q in cells:
                c = cells[q]
                return c[1], (2 if (c[4] or 0) & 1 else 1), {sd(c)}, prec_m(c[1], unit), bool((c[4] or 0) & (8 | 64))
            if md["k"] != "f":
                return None, 0, set(), 0, False
            y, n = q[:4], q[5]
            combos = ([[f"{y}H2", f"{y}Q3"], [f"{y}FY", f"{y}Q1", f"{y}Q2", f"{y}Q3"]] if n == "4" else [[f"{y}H1", f"{y}Q1"]] if n == "2" else [])
            for ks in combos:
                if all(k in cells for k in ks):
                    cs = [cells[k] for k in ks]
                    return cs[0][1] - sum(c[1] for c in cs[1:]), len(cs), {sd(c) for c in cs}, max(prec_m(c[1], unit) for c in cs), any((c[4] or 0) & (8 | 64) for c in cs)
            return None, 0, set(), 0, False
        filer = "filer" if md["src"] == "xbrl" and kpi.get(ent, {}).get("filer") else None
        for p, c in cells.items():
            fl = c[4] or 0
            if metric not in FLOW and p.endswith("FY"):
                continue
            rep = rid_of(f["u"][c[3]]) if len(c) > 3 and c[3] is not None and c[3] < len(f["u"]) else (c[5] if len(c) > 5 and isinstance(c[5], int) else None)
            tag = (c[5] if len(c) > 5 else None) if metric == "csm" else filer or ("restated" if fl & (8 | 64) else None)  # a CSM cell carries its basis label in aux
            put(ent, metric, p, Obs(surf, c[1], 0.001 if metric == "csm" else prec_m(c[1], unit), 2 if fl & 1 else 1, bool(fl & 1), rep, sd(c), tag))
        if md["k"] == "f":
            qs = sorted({p[:4] + "Q" + str(k) for p in cells for k in (1, 2, 3, 4)})
            for q in qs:
                if q not in cells:
                    v, n, stds, pr, rs = quarter(q)
                    if v is not None and len(stds) == 1:  # a derivation across IFRS 4 and IFRS 17 is not shown
                        put(ent, metric, q, Obs(surf, v, pr, n, True, std=stds.pop(), tag=filer or ("restated" if rs else None)))
                if q.endswith("Q4") and q[:4] + "FY" in cells:
                    fy = cells[q[:4] + "FY"]
                    put(ent, metric, "LTM" + q, Obs(surf, fy[1], prec_m(fy[1], unit), 1, False, std=sd(fy), tag=filer or ("restated" if (fy[4] or 0) & (8 | 64) else None)))
                    continue
                parts = [quarter(back(q, k)) for k in (3, 2, 1, 0)]
                stds = set().union(*[x[2] for x in parts])
                if all(x[0] is not None for x in parts) and len(stds) == 1:
                    put(ent, metric, "LTM" + q, Obs(surf, sum(x[0] for x in parts), max(x[3] for x in parts), sum(x[1] for x in parts), True, std=stds.pop(),
                                                    tag=filer or ("restated" if any(x[4] for x in parts) else None)))

# ------------------------------------------------------------------ CSM: the one rule, as every CSM surface publishes it
cap = load(DATA / "csm" / "capital.json")["companies"]
C_M = {"profit_attributable": "profit", "comprehensive_income_attributable": "oci", "equity_attributable": "equity"}
for ent, ms in cap.items():
    for key, metric in C_M.items():
        for p, x in (ms.get(key) or {}).items():
            if metric == "equity" and p.endswith("FY"):
                continue
            put(ent, metric, p, Obs("capital", x["v"], prec_m(x["v"]), 1, False, rid_of(x.get("u")), "4" if x.get("std") == "IFRS 4" else "17", "restated" if x.get("cmp") else None))
summary = load(DATA / "csm" / "summary.json")
for ent, dates in summary.get("resolved", {}).items():
    for d, (v, lab, rp, fl) in dates.items():
        if d[5:10] in QOF:
            put(ent, "csm", qkey(d), Obs("csm", v, 0.001, 1, bool(fl & 1), tag=lab))
for f in sorted((DATA / "csm" / "facts").glob("*.json")):
    for d, (v, lab, rp, fl) in (load(f).get("resolved") or {}).items():
        if d[5:10] in QOF:
            put(f.stem, "csm", qkey(d), Obs("csm.co", v, 0.001, 1, bool(fl & 1), tag=lab))

# the browser's own rule (lib/csmResolve.ts, run by web/scripts/csm-parity.mjs): what the company page and the valuation pages show
NODE = shutil.which("node") or next((str(p) for p in sorted(Path.home().glob(".nvm/versions/node/v2*/bin/node"))), None)
TS_NOTE = None
try:
    ts = json.loads(subprocess.run([NODE, str(ROOT / "web" / "scripts" / "csm-parity.mjs")], capture_output=True, text=True, timeout=120, cwd=ROOT / "web").stdout) if NODE else None
except (OSError, ValueError, subprocess.SubprocessError) as e:
    ts, TS_NOTE = None, str(e)[:80]
for ent, dates in (ts or {}).items():
    for d, (v, lab, rp, fl) in dates.items():
        if d[5:10] in QOF:
            put(ent, "csm", qkey(d), Obs("csm.ts", v, 0.001, 1, bool(fl & 1), tag=lab))
if ts is None:
    TS_NOTE = TS_NOTE or "node not found: lib/csmResolve.ts parity not checked"

# ------------------------------------------------------------------ compare
allow = {(a["entity"], a["metric"], a["period"], a["a"], a["b"]): a for a in (load(ALLOW).get("allow", []) if ALLOW.exists() else [])}
used_allow = set()
latest = max(p for (e, m, p) in obs if re.match(r"^\d{4}Q\d$", p))
recent = {back(latest, k) for k in range(8)}


def recent_of(pk):
    core = pk[3:] if pk.startswith("LTM") else pk
    if re.match(r"^\d{4}(FY|H\d)$", core):
        core = core[:4] + ("Q4" if core.endswith(("FY", "H2")) else "Q2")
    return core in recent


def basis(a, b, ent, metric, pk):
    """Why two figures may differ, when the page says so; None when they are meant to be the same figure."""
    key = (ent, metric, pk, a.surf, b.surf)
    for k in (key, (ent, metric, pk, b.surf, a.surf)):
        if k in allow:
            used_allow.add(k)
            return "allow", allow[k]["reason"]
    if "filer" in (a.tag, b.tag):
        return "filer", kpi[ent]["filer"]["note"]
    if a.std and b.std and a.std != b.std:
        return "std", "IFRS 4 כפי שדווח מול IFRS 17 (הצגה מחדש)"
    if "alt" in (a.tag, b.tag):
        return "alt", "יום הדוח: שורת הרווח לתקופה (אין שורת ייחוס), מסומן בדף"
    if "restated" in (a.tag, b.tag) or (a.rep and b.rep and a.rep != b.rep and not pk.startswith("LTM")):
        return "restated", "נקרא מדוח מאוחר יותר שהציג את התקופה מחדש"
    return None


def tol(a, b, unit):
    if unit == "nis":
        return 1e-6 if a.prec == b.prec else 0.006
    if a.prec == b.prec and a.prec >= 0.1:
        return 1e-6  # both printed in (tenths of) millions: the same printed inputs, so the same number
    if a.prec == b.prec:
        return 0.0015 * max(a.n, b.n)  # both in thousands: a thousand per input
    return 0.5 * a.prec * a.n + 0.5 * b.prec * b.n + 1e-6


def run(full=False):
    pairs = passed = 0
    fails, excs, old = [], collections.defaultdict(list), []
    by_pair = collections.Counter()
    for (ent, metric, pk), os_ in sorted(obs.items()):
        # one figure per surface: a surface that serves two (a later report's comparative) keeps the period's own
        best = {}
        for o in os_:
            cur = best.get(o.surf)
            if cur is None or (cur.tag in ("restated", "alt") and o.tag not in ("restated", "alt")):
                best[o.surf] = o
        surfs = sorted(best)
        if len(surfs) < 2:
            continue
        unit = "nis" if metric == "eps" else "m"
        for i, sa in enumerate(surfs):  # every pair of pages that serve the figure
            for sb in surfs[i + 1:]:
                a, b = best[sa], best[sb]
                pairs += 1
                by_pair[(a.surf, b.surf)] += 1
                if abs(a.v - b.v) <= tol(a, b, unit) and (metric != "csm" or a.tag == b.tag):  # a CSM carries its basis label: the same on every page
                    passed += 1
                    continue
                why = basis(a, b, ent, metric, pk)
                row = {"entity": ent, "metric": metric, "period": pk, "a": a.surf, "va": round(a.v, 3), "b": b.surf, "vb": round(b.v, 3), "diff": round(a.v - b.v, 3)}
                if why:
                    excs[why[0]].append({**row, "reason": why[1]})
                elif full or recent_of(pk):
                    fails.append(row)
                else:
                    old.append(row)
    return pairs, passed, fails, excs, old, by_pair


def fund_roles():
    """Fund houses: attributable net profit and comprehensive income on the company page (Report Day roles) = XBRL, last four quarters."""
    funds = [c["id"] for c in load(DATA / "companies" / "index.json") if c["kind"] == "fund_house" and c["id"] in kpi]
    n, bad, rows = 0, [], []
    for ent in funds:
        qs = [p for p in kpi[ent]["periods"]][-4:]
        for metric in ("profit", "oci"):
            labels, alt = day_roles.get((ent, "net" if metric == "profit" else "comp"), ([], False))
            for p in qs:
                pk = p[:4] + "Q4" if p.endswith("FY") else p
                k = next((o for o in obs.get((ent, metric, pk), []) if o.surf == "kpi"), None)
                w = next((o for o in obs.get((ent, metric, pk), []) if o.surf == "day" and o.tag != "restated"), None) \
                    or next((o for o in obs.get((ent, metric, pk), []) if o.surf == "day"), None)
                if not k or not w:
                    continue
                n += 1
                ok = abs(k.v - w.v) <= tol(k, w, "m")
                why = None if ok else basis(k, w, ent, metric, pk)
                rows.append({"entity": ent, "metric": metric, "period": pk, "xbrl": round(k.v, 3), "page": round(w.v, 3), "row": labels[0] if labels else None, "alt": alt, "ok": ok, "basis": why[1] if why else None})
                if not ok and not why:
                    bad.append(rows[-1])
    return n, bad, rows


def main():
    full = "--all" in sys.argv
    pairs, passed, fails, excs, old, by_pair = run(full)
    fn, fbad, frows = fund_roles()
    stale = [k for k in allow if k not in used_allow]
    print(f"consistency: {pairs} pairs, {passed} equal within rounding, {sum(len(v) for v in excs.values())} labelled basis differences "
          f"({', '.join(f'{k} {len(v)}' for k, v in sorted(excs.items()))}), {len(fails)} conflicts, {len(old)} older than 8 quarters (not failed)")
    if fails:
        print(f"  {'entity':10} {'metric':7} {'period':10} {'surface a':11} {'value a':>12} {'surface b':11} {'value b':>12} {'diff':>9}")
        for r in fails[:60]:
            print(f"  {r['entity']:10} {r['metric']:7} {r['period']:10} {r['a']:11} {r['va']:>12,.3f} {r['b']:11} {r['vb']:>12,.3f} {r['diff']:>9,.3f}")
        if len(fails) > 60:
            print(f"  … {len(fails) - 60} more")
    if stale:
        print(f"  allow-list entries no longer needed: {stale}")
    if TS_NOTE:
        print("  " + TS_NOTE)
    print(f"fund_roles: {fn} checks, {len(fbad)} mismatches")
    for r in fbad:
        print(f"  {r['entity']:10} {r['metric']:7} {r['period']} XBRL {r['xbrl']:,.3f} page {r['page']:,.3f} row «{r['row']}»{' (alt)' if r['alt'] else ''}")
    out = {"built": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "window": sorted(recent), "pairs": pairs, "passed": passed,
           "surfaces": PAGES, "metrics": M_HE,
           "by_pair": [[a, b, n] for (a, b), n in sorted(by_pair.items(), key=lambda x: -x[1])],
           "exceptions": {k: {"n": len(v), "reason": v[0]["reason"] if k != "allow" else None, "rows": v if k == "allow" else v[:12]} for k, v in sorted(excs.items())},
           "conflicts": fails, "older": len(old), "stale_allow": [list(k) for k in stale],
           "notes": [TS_NOTE] if TS_NOTE else [],
           "fund_roles": {"n": fn, "bad": len(fbad), "rows": frows}}
    (DATA / "consistency.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if "--json" in sys.argv:
        print(json.dumps(out, ensure_ascii=False)[:2000])
    return 1 if fails or fbad or stale else 0


if __name__ == "__main__":
    sys.exit(main())
