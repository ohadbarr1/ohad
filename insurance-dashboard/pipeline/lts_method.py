"""Long-term savings sector comparison: the deck's METHOD, one definition per metric, shared by every company.

The deck "חיסכון ארוך טווח, השוואות ענפיות, Q2-2026" (transcribed in build_lts.py -> web/public/data/lts.json) is built
from the managing companies' own reports. The raw facts of those reports sit in data/extracted_lts/<company>/<period>.json.
A per-company script (lts_norm_<company>.py) only says WHICH printed facts make up each base series; everything else
(choice of report when two reports print the same thing, quarters, averages, annualisation, every ratio) is here.
The definitions and the evidence behind them are written out in LTS_METHOD.md.

Base series, per family ("pen" = pension funds, "gem" = provident funds):
  balance, key "YYYY-MM":      aum
  year to date, key (year, m): tr_in, tr_out, dep, nb, fees, fees_a, fees_d, sm, ga   (m = 3, 6, 9 or 12 months)
A base value is a V: the number in the deck's unit plus the printed facts it was summed from.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "extracted_lts"
OUT = ROOT / "data" / "lts_norm"

FAMILIES = ("pen", "gem")
BN = ("aum", "tr_in", "tr_out", "dep", "nb")  # NIS billions in the deck
MN = ("fees", "fees_a", "fees_d", "sm", "ga")  # NIS millions in the deck
FLOWS = BN[1:] + MN
UNIT = {"NIS thousands": 1e3, "NIS thousand": 1e3, "NIS millions": 1e6, "NIS million": 1e6, "NIS": 1.0}
PART_KEYS = ("file", "metric", "segment", "window", "date", "value", "unit", "page", "label")


class V:
    """A number with the printed facts behind it."""

    def __init__(self, value, parts, formula=""):
        self.value, self.parts, self.formula = value, list(parts), formula

    def __repr__(self):
        return f"V({self.value:.6g}, {len(self.parts)} parts)"


# ---------- reading the reports ----------

def load(company):
    """Every extracted fact of a company, each with the report it came from (`file`, e.g. 2025Q3) and its unit."""
    out = []
    for f in sorted((RAW / company).glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for x in d["facts"]:
            y = dict(x)
            y["file"] = f.stem
            y.setdefault("unit", d.get("unit"))
            out.append(y)
    return out


def file_end(file):
    """2025Q3 -> (2025, 9); 2025FY -> (2025, 12)."""
    y, t = int(file[:4]), file[4:]
    return y, {"Q1": 3, "Q2": 6, "Q3": 9, "FY": 12}[t]


def fact_key(x):
    """The base key a printed fact belongs to: a balance date, a year-to-date window, or a stand-alone quarter."""
    y, m = int(x["date"][:4]), int(x["date"][5:7])
    w = x["window"]
    if w == "instant":
        return f"{y}-{m:02d}"
    if w == "fy":
        return (y, 12)
    if w == "ytd" or (w == "q" and m == 3):
        return (y, m)
    if w == "q":
        return ("q", y, m)
    raise ValueError(w)


def collect(facts, where, scale, magnitude=False):
    """Sum the printed facts chosen by `where`, per base key and per report. -> {key: {file: V}}.
    `scale`: 1e9 for NIS billions, 1e6 for NIS millions. A fact printed twice in one report (two tables) counts once.
    `magnitude`: for gross flows (transfers), a figure printed in parentheses is taken as its absolute amount."""
    seen, acc = {}, {}
    for x in facts:
        if x["value"] is None or not where(x):  # a blank or '*' cell is not a figure
            continue
        ident = (x["file"], fact_key(x), x["metric"], x["segment"], x.get("component"), x.get("population"))
        if ident in seen:
            if seen[ident] != x["value"]:
                raise ValueError(f"same fact printed twice with different values: {ident} {seen[ident]} / {x['value']}")
            continue
        seen[ident] = x["value"]
        acc.setdefault(fact_key(x), {}).setdefault(x["file"], []).append(x)
    out = {}
    for key, per_file in acc.items():
        for file, xs in per_file.items():
            val = sum((abs(x["value"]) if magnitude else x["value"]) * UNIT[x["unit"]] for x in xs) / scale
            parts = [{k: x.get(k) for k in PART_KEYS} | {k: x[k] for k in ("component", "population") if x.get(k)} for x in xs]
            out.setdefault(key, {})[file] = V(val, parts)
    return out


def key_end(key):
    if isinstance(key, str):
        return int(key[:4]), int(key[5:7])
    return key[-2], key[-1]


def choose(cands, name, notes, n_parts=None):
    """RESTATEMENT RULE, part 1 (balances, interim windows, and both sides of a quarter difference): a figure is taken
    from the report OF ITS OWN PERIOD (the June-2025 figure from the Q2-2025 report). When that report is not in the
    extraction (periods before coverage), the earliest report that prints it as a comparative is used. Later
    comparatives that differ are recorded in `notes`, never used.
    `n_parts`: reports that print fewer components than this are ignored (an incomplete comparative column)."""
    out = {}
    for key, per_file in cands.items():
        files = sorted(per_file, key=file_end)
        if n_parts:
            files = [f for f in files if len(per_file[f].parts) >= n_parts.get(key, 0)] or files
        own = [f for f in files if file_end(f) == key_end(key)]
        pick = own[0] if own else files[0]
        out[key] = per_file[pick]
        differ(per_file, pick, name, key, notes, "report of the period itself (or the earliest comparative) is used")
    return out


def differ(per_file, pick, name, key, notes, rule):
    """Record every other value the reports print for the same thing."""
    other = {}
    for f in sorted(per_file, key=file_end):
        if f != pick and abs(per_file[f].value - per_file[pick].value) > 1e-9:
            other.setdefault(round(per_file[f].value, 6), []).append(f)
    for val, files in other.items():
        notes.append({"series": name, "key": label(key), "used": round(per_file[pick].value, 6), "used_file": pick,
                      "other": val, "other_files": files, "rule": rule})


def label(key):
    """Deck period key."""
    if isinstance(key, str):
        return key
    if key[0] == "q":
        return f"Q{key[2] // 3}-{key[1]}"
    y, m = key
    return {3: f"Q1-{y}", 6: f"H1-{y}", 9: f"9M-{y}", 12: f"FY{y}"}[m]


def choose_base(cands, name, notes, n_parts=None):
    """Apply the report-choice rule to one flow series. Returns
    `first`  = every year-to-date key from the report of its own period (see choose); used for interim windows and for
               quarter differences, so that a quarter is a difference of two figures of the same year's reports;
    `annual` = full years only, from the LATEST ANNUAL report that prints the year (a prior year therefore carries the
               reclassifications of the following annual report, as the deck does); never from an interim report;
    `q`      = stand-alone three-month figures where the report prints them (income statement, segment note);
    `all`    = every candidate, per report (used to keep the two sides of a fourth quarter in one vintage)."""
    ytd = {k: v for k, v in cands.items() if k[0] != "q"}
    qs = {(k[1], k[2]): v for k, v in cands.items() if k[0] == "q"}
    part = {k: v for k, v in ytd.items() if k[1] != 12}
    full = {k: v for k, v in ytd.items() if k[1] == 12}
    first = choose(part, name, notes, n_parts)
    first.update(choose(full, name, [], n_parts))
    annual = {}
    for key, per_file in full.items():
        files = sorted((f for f in per_file if f.endswith("FY")), key=file_end)
        if n_parts:
            files = [f for f in files if len(per_file[f].parts) >= n_parts.get(key, 0)] or files
        if files:
            annual[key] = per_file[files[-1]]
            differ(per_file, files[-1], name, key, notes, "full year: the latest annual report that prints it is used; "
                   "quarter differences use the annual report of the year itself")
        else:
            differ(per_file, sorted(per_file, key=file_end)[0], name, key, notes, "no annual report prints it: earliest comparative used")
    return {"first": first, "annual": annual, "q": choose(qs, name + " (quarter)", []), "all": ytd}


# ---------- the method ----------

DEC = {  # decimals the deck prints, per metric (an anchor is reproduced only if it matches at this rounding)
    "aum": 0, "tr_in": 1, "tr_out": 1, "tr_net": 1, "nb": 1, "dep": 0, "fees": 0, "sm": 0, "ga": 0, "op": 0,
    "fee_d": 2, "sm_fees": 0, "ga_fees": 0, "sm_aum": 2, "ga_aum": 2,
    ("pen", "fee_a"): 3, ("gem", "fee_a"): 3, ("pen", "gross_m"): 3, ("gem", "gross_m"): 2, ("pen", "op_m"): 3, ("gem", "op_m"): 2,
    ("pen", "out_rate", "ytd"): 1, ("gem", "out_rate", "ytd"): 2, ("pen", "out_rate", "q"): 1, ("gem", "out_rate", "q"): 1,
}
METRICS = {  # what the deck shows per family
    "pen": ["tr_in", "tr_out", "tr_net", "out_rate", "nb", "fee_a", "fee_d", "fees", "sm", "ga", "op", "gross_m", "op_m", "sm_fees", "sm_aum", "ga_fees", "ga_aum"],
    "gem": ["tr_in", "tr_out", "tr_net", "out_rate", "dep", "fee_a", "fees", "sm", "ga", "op", "gross_m", "op_m", "sm_fees", "sm_aum", "ga_fees", "ga_aum"],
}


def decimals(fam, metric, period):
    if metric == "out_rate":
        return DEC[(fam, metric, "q" if period.startswith("Q") else "ytd")]
    return DEC.get((fam, metric), DEC.get(metric))


def rnd(x, d):
    """Half-up rounding as a spreadsheet prints it."""
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(1).scaleb(-d)
    return float(Decimal(repr(round(x, 9))).quantize(q, rounding=ROUND_HALF_UP))


def prev_date(y, m, months):
    """Balance date `months` before the end of month m of year y."""
    t = y * 12 + (m - 1) - months
    return f"{t // 12}-{t % 12 + 1:02d}"


class Method:
    """All deck metrics of one family of one company, from its base series.

    base[name] = {"first": {key: V}, "annual": {(year, 12): V}} for flows, {date: V} for balances ("aum", "aum_new").
    aum      = assets as the deck's headline counts them (every fund of the family the company manages);
    aum_new  = assets of the funds the activity tables (transfers, deposits, collected fees) refer to. Pension: the new
               funds only (comprehensive + general, veteran funds excluded). When absent, aum is used.
    """

    def __init__(self, fam, base, notes=None):
        self.fam, self.b = fam, base
        self.notes = [] if notes is None else notes
        self.aum = base["aum"]
        self.aum_new = base.get("aum_new") or base["aum"]

    # windows: ("ytd", y, m) is January..m of year y; ("q", y, m) the three months ending in month m
    def windows(self):
        keys = set()
        for name in FLOWS:
            for k in self.b.get(name, {}).get("first", {}):
                keys.add(("ytd",) + k)
                keys.add(("q",) + k)
        return sorted(keys, key=lambda w: (w[1], w[2], w[0]))

    @staticmethod
    def wlabel(w):
        kind, y, m = w
        return f"Q{m // 3}-{y}" if kind == "q" else label((y, m))

    def flow(self, name, w):
        """Flow of a window in the deck's unit.
        Full year: the latest annual report. Other year-to-date windows: the report of the period.
        Quarter: the stand-alone three-month figure when the report of the period prints one; otherwise
        YTD(m) - YTD(m-3) from the reports of their own periods (Q1 = the Q1 figure). A negative difference of a gross
        flow means the two reports are not on one basis: no value is given and the case is logged."""
        s = self.b.get(name)
        if not s:
            return None
        kind, y, m = w
        if kind == "ytd":
            v = s["annual"].get((y, m)) if m == 12 else None
            v = v or s["first"].get((y, m))
            return v and V(v.value, v.parts, f"{name} printed for {label((y, m))}")
        a = s["first"].get((y, m))
        if a is None:
            return None
        if m == 3:
            return V(a.value, a.parts, f"{name} printed for Q1-{y}")
        if (y, m) in s.get("q", {}):
            v = s["q"][(y, m)]
            return V(v.value, v.parts, f"{name} printed for the three months Q{m // 3}-{y}")
        p = s["first"].get((y, m - 3))
        if p is None:
            return None
        if m == 12 and p.parts and a.parts:  # keep both sides in one vintage: 9M from a later year's comparative -> FY from that year's annual report
            py = file_end(p.parts[0]["file"])[0]
            if py > y and file_end(a.parts[0]["file"])[0] != py:
                a = s.get("all", {}).get((y, 12), {}).get(f"{py}FY", a)
        d = a.value - p.value
        if d < 0 and name in FLOWS:
            self.notes.append({"series": f"{self.fam}.{name}", "key": self.wlabel(w), "rule": "quarter not derived: year-to-date figure "
                               f"falls between reports ({label((y, m - 3))} {p.value:.4f} -> {label((y, m))} {a.value:.4f}, deck units)"})
            return None
        return V(d, a.parts + p.parts, f"{name} {label((y, m))} - {name} {label((y, m - 3))}")

    def avg(self, w, new=False):
        """AVERAGE ASSETS of a window = (assets at the start of the window + assets at its end) / 2.
        Start of a year-to-date window = 31 December of the previous year; start of a quarter = the previous quarter end."""
        kind, y, m = w
        s = self.aum_new if new else self.aum
        months = 3 if kind == "q" else m
        a, b = s.get(prev_date(y, m, months)), s.get(f"{y}-{m:02d}")
        if a is None or b is None:
            return None
        nm = "assets of the new funds" if new and self.aum_new is not self.aum else "assets"
        return V((a.value + b.value) / 2, a.parts + b.parts, f"({nm} {prev_date(y, m, months)} + {nm} {y}-{m:02d}) / 2")

    @staticmethod
    def ann(w):
        """ANNUALISATION factor of a part-year flow: 12 / months in the window (x2 for a half, x4 for a quarter, x4/3 for nine months)."""
        return 12 / (3 if w[0] == "q" else w[2])

    def metric(self, name, w):
        f = lambda n: self.flow(n, w)
        k = self.ann(w)
        ktxt = "" if k == 1 else f" x {k:.4g}"

        def ratio(num, den, scale, txt):
            if num is None or den is None or den.value == 0:
                return None
            return V(num.value / den.value * scale, num.parts + den.parts, txt)

        def diff(a, b, txt):
            if a is None or b is None:
                return None
            return V(a.value - b.value, a.parts + b.parts, txt)

        if name in ("tr_in", "tr_out", "nb", "dep", "fees", "sm", "ga"):
            return f(name)
        if name == "tr_net":
            return diff(f("tr_in"), f("tr_out"), "tr_in - tr_out")
        if name == "out_rate":  # annualised transfers out / average assets of the funds the transfers table covers, %
            return ratio(f("tr_out"), self.avg(w, new=True), 100 * k, f"tr_out{ktxt} / average assets, %")
        if name == "fee_a":
            if self.fam == "pen":  # fees collected from assets (members and pensioners) of the new funds / their average assets
                return ratio(f("fees_a"), self.avg(w, new=True), k / 10, f"fees collected from assets{ktxt} / average assets, %")
            return ratio(f("fees"), self.avg(w), k / 10, f"management fee income{ktxt} / average assets, %")
        if name == "fee_d":  # fees collected from deposits / current deposits (one-time deposits excluded), %
            return ratio(f("fees_d"), f("dep"), 1 / 10, "fees collected from deposits / deposits, %")
        gross = diff(f("fees"), f("sm"), "fees - sm")
        op = gross and f("ga") and V(gross.value - f("ga").value, gross.parts + f("ga").parts, "fees - sm - ga")
        if name == "op":
            return op
        if name == "gross_m":
            return ratio(gross, self.avg(w), k / 10, f"(fees - sm){ktxt} / average assets, %")
        if name == "op_m":
            return ratio(op, self.avg(w), k / 10, f"(fees - sm - ga){ktxt} / average assets, %")
        if name in ("sm_fees", "ga_fees"):
            return ratio(f(name[:2]), f("fees"), 100, f"{name[:2]} / fees, %")
        if name in ("sm_aum", "ga_aum"):
            return ratio(f(name[:2]), self.avg(w), k / 10, f"{name[:2]}{ktxt} / average assets, %")
        raise KeyError(name)

    def facts(self):
        out = []
        for d in sorted(self.aum):
            v = self.aum[d]
            out.append(fact(f"{self.fam}.aum", d, v.value, "sum of the printed assets at the balance date", v.parts))
        for w in self.windows():
            for name in METRICS[self.fam]:
                v = self.metric(name, w)
                if v is not None:
                    out.append(fact(f"{self.fam}.{name}", self.wlabel(w), v.value, v.formula, v.parts))
        return out


def fact(metric, period, value, formula, parts):
    seen, uniq = set(), []
    for p in parts:
        k = json.dumps(p, sort_keys=True, ensure_ascii=False)
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    return {"metric": metric, "period": period, "value": round(value, 6), "formula": formula, "parts": uniq}


def anchors(company, facts):
    """Compare with the deck (lts.json): reproduced only if equal at the deck's printed rounding."""
    deck = json.loads((ROOT / "web" / "public" / "data" / "lts.json").read_text(encoding="utf-8"))["facts"]
    ours = {(f["metric"], f["period"]): f["value"] for f in facts}
    out = []
    for m, c, p, v, _slide in deck:
        fam, _, name = m.partition(".")
        if c != company or fam not in FAMILIES or name not in METRICS[fam] + ["aum"]:
            continue
        o = ours.get((m, p))
        r = None if o is None else rnd(o, decimals(fam, name, p))
        out.append({"metric": m, "period": p, "deck": v, "ours": r, "ours_exact": o, "ok": r is not None and abs(r - v) < 1e-9})
    return out


def write(company, base, notes):
    facts = []
    for fam in FAMILIES:
        log = []
        facts += Method(fam, base[fam], log).facts()
        for n in log:
            if n not in notes:
                notes.append(n)
    anc = anchors(company, facts)
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{company}.json"
    row = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    body = ('{"company":%s,\n"facts":[\n%s\n],\n"anchors":[\n%s\n],\n"notes":[\n%s\n]}\n'
            % (row(company), ",\n".join(map(row, facts)), ",\n".join(map(row, anc)), ",\n".join(map(row, notes))))
    dest.write_text(body, encoding="utf-8")
    ok = sum(a["ok"] for a in anc)
    print(f"{company}: {len(facts)} facts, anchors {ok}/{len(anc)} -> {dest}")
    for a in anc:
        if not a["ok"]:
            print("  MISS", a["metric"], a["period"], "deck", a["deck"], "ours", a["ours"], a["ours_exact"])
    return facts, anc
