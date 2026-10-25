"""Report card per filing, v1, numbers only (lane S2): web/public/data/cards/<company>/<period>.json + cards/index.json.

python3 pipeline/build_cards.py          (standard library only; reads published files only)
python3 pipeline/check_cards.py          the digit validator: every digit on a card maps to a published fact (gate check `cards`)

One card per report period of every company with statements (insurers and fund houses): the headline figures of the filing against a
year earlier and the previous quarter, restated-vs-original flags, the solvency ratio against the board target, targets against actuals,
each figure with its source page. Nothing is re-derived here in a new way:
  profit, comprehensive income, equity   the Report Day roles (pipeline/reportday.py reads them from pages/ReportDay.tsx), same rows,
                                         same alt fallback, same comparison columns, same delta rule (Delta in ReportDay.tsx)
  ROE                                    lib/kpi.ts: LTM profit ÷ average equity (end and a year earlier), on the Report Day rows
  CSM                                    pipeline/csm_resolve.py (the one rule every page uses), over csm/facts/<id>.json
  new business, release                  the Peer Table's published cells (peers/m/ifrs-csm_new_business.json, ifrs-csm_release.json)
  solvency ratio, board target           the report's own extracted facts, as Report Day (ratio) and the capital table (target) read them
  targets vs actual                      targets.json (actual and status as build_targets.py scores them)
  restatements                           companies/<id>.json `restated`, as ReportDay.restatedBy reads them
No prose generation: fixed Hebrew sentence templates; every digit on the card is a fact token. A token is {"f": fact id}; literal text
carries no digit (except the fixed terms in check_cards.ALLOWED). Facts: {v, u, t (the text shown), s (source)}; a source is
  {"k": "pg", "u": url index, "pg": page, "dp": period of the document, "dt": document type, "fl": [flags], "ref": {...}}   printed
  {"k": "calc", "op": op, "in": [fact ids], "fx": formula}                                                           computed here
  {"k": "xbrl", "rid": report id, "ref": {...}}                                         the T+0 skeleton (status "unverified")
`ref` says where the validator re-reads the figure in the published files.
"""
import datetime as dt
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import csm_resolve  # noqa: E402
import reportday as rd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "cards"
MINUS = "−"
QE = ["03-31", "06-30", "09-30", "12-31"]
YTD = {"03-31": "Q", "06-30": "H", "09-30": "9M", "12-31": "FY"}
BIG = 2  # % of the figure first reported: the materiality threshold of Report Day's restatement panel
TARGET_RE = re.compile(r"^target_solvency_ratio(_board|_min(imum)?(_with(out)?_transitional)?|_with_transitional_minimum)?$")  # IndustryCapital.tsx COLS tg


# ---------------------------------------------------------------- formatting (the text a fact shows; check_cards.py re-derives it)
def nf(v, d=1):
    t = f"{v:,.{d}f}"
    if re.fullmatch(r"-[0.]+", t):
        return t[1:]
    return t.replace("-", MINUS)


def signed(x, d=1):
    r = round(x, d) or 0.0
    return ("+" if r > 0 else "") + nf(r, d)


def fmt(v, u):
    """u: m (NIS m, one decimal) · pct (%, one decimal) · pp (points, signed) · dpct (signed %) · dm (signed NIS m) · x (multiple) · n (count)
    · tpct (a target as printed: integer when whole)"""
    if u == "m":
        return nf(v, 1)
    if u == "pct":
        return nf(v, 1) + "%"
    if u == "pp":
        return f"{signed(v)} נק׳"
    if u == "dpct":
        return signed(v) + "%"
    if u == "dm":
        return f"{signed(v)} מ׳"
    if u == "x":
        return "×" + nf(v, 1)
    if u == "n":
        return nf(v, 0)
    if u == "tpct":
        return nf(v, 0 if float(v).is_integer() else 1) + "%"
    raise ValueError(u)


def qshift(end, k):
    n = int(end[:4]) * 4 + QE.index(end[5:]) + k
    return f"{n // 4}-{QE[n % 4]}"


def shift_year(end, k):
    return f"{int(end[:4]) + k}{end[4:]}"


def key_of(end):
    return f"{end[:4]}FY" if end.endswith("12-31") else f"{end[:4]}Q{QE.index(end[5:]) + 1}"


def end_of(p):
    return f"{p[:4]}-{'12-31' if p.endswith('FY') else QE[int(p[5:]) - 1]}"


def plabel(t, end):
    y, m = end[2:4], int(end[5:7])
    return {"FY": f"FY'{y}", "H": f"H1'{y}" if m == 6 else f"H2'{y}", "9M": f"9M'{y}"}.get(t, f"Q{(m + 2) // 3}'{y}")


class Book(rd.Book):
    """reportday.Book whose fig_at also says where the figure sits (metric and period index, document): the validator re-reads it there."""

    def fig_at(self, rows, typ, end):
        pi = self.pidx.get((typ, end))
        if pi is None:
            return None
        for l in rows:
            f = self.facts.get((l["mi"], pi))
            if f:
                u = self.urls[f[2]] if f[2] is not None and f[2] < len(self.urls) else None
                return {"v": f[0] / 1000, "rid": rd.rid_of(u), "pg": f[1], "der": bool(f[3] & 1), "std": "4" if f[3] & 2 else l["std"], "re": bool(f[3] & 8),
                        "row": l["raw"], "mi": l["mi"], "pi": pi, "url": u, "sheet": self.d["metrics"][l["mi"]]["sheet"], "typ": typ, "end": end}
        return None


class Card:
    def __init__(self, c, name, kind, p):
        self.c, self.p, self.end = c, p, end_of(p)
        self.urls, self.facts, self.n = [], {}, 0
        self.d = {"v": 1, "c": c, "name": name, "kind": kind, "p": p, "end": self.end}

    def url(self, u):
        if u is None:
            return None
        if u not in self.urls:
            self.urls.append(u)
        return self.urls.index(u)

    def add(self, fid, v, u, s):
        self.facts[fid] = {"v": round(v, 6), "u": u, "t": fmt(v, u), "s": s}
        return fid

    def page(self, fid, v, u, url, pg, dp, dt_, ref, fl=(), lab=None):
        s = {"k": "pg", "u": self.url(url), "pg": pg, "dp": dp, "dt": dt_, "ref": ref}
        if fl:
            s["fl"] = sorted(set(fl))
        if lab:
            s["l"] = lab
        return self.add(fid, v, u, s)

    def calc(self, fid, v, u, op, ins, fx):
        return self.add(fid, v, u, {"k": "calc", "op": op, "in": ins, "fx": fx})


def delta(card, fid, a, b, la, lb):
    """Delta of ReportDay.tsx: points between two ratios; a percent only between two positive figures (a multiple beyond a tripling);
    otherwise the difference in NIS millions; nothing across standards. Returns the fact id or None (and why)."""
    fa, fb = card.facts.get(a), card.facts.get(b)
    if not fa or not fb:
        return None, None
    if fa.get("std") and fb.get("std") and fa["std"] != fb["std"]:
        return None, "std"
    va, vb = fa["v"], fb["v"]
    if fa["u"] in ("pct",):
        return card.calc(fid, va - vb, "pp", "diff", [a, b], f"{la} − {lb} (נק׳)"), None
    if va > 0 and vb > 0:
        x = (va / vb - 1) * 100
        if x > 300:
            return card.calc(fid, va / vb, "x", "ratio", [a, b], f"{la} ÷ {lb}"), None
        return card.calc(fid, x, "dpct", "pct", [a, b], f"{la} ÷ {lb} − 1"), None
    return card.calc(fid, va - vb, "dm", "diff", [a, b], f"{la} − {lb}"), None


def main():
    built = dt.date.today().isoformat()
    reg = {c["id"]: c for c in json.loads((DATA / "companies" / "index.json").read_text(encoding="utf-8"))}
    kpi = json.loads((DATA / "kpi.json").read_text(encoding="utf-8"))["companies"]
    targets = json.loads((DATA / "targets.json").read_text(encoding="utf-8"))
    ifrs_meta = json.loads((DATA / "ifrs.json").read_text(encoding="utf-8"))
    ifrs_url = {(f["company"], f["period"]): f.get("url") for f in ifrs_meta["files"]}
    peer = {k: json.loads((DATA / "peers" / "m" / f"ifrs-{k}.json").read_text(encoding="utf-8")) for k in ("csm_new_business", "csm_release")}
    ifrs_cache = {}

    def ifrs_of(c, p):
        if p not in ifrs_cache:
            f = DATA / f"ifrs_{p}.json"
            ifrs_cache[p] = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
        return [x for x in ifrs_cache[p] if x["c"] == c and not x.get("tr") and not x.get("model") and not x.get("bk")]

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    index, total = {}, 0
    for c in sorted(reg):
        wb = DATA / "companies" / f"{c}.json"
        if not wb.exists() or not reg[c].get("has_financials"):
            continue
        bk = Book(c)
        e = reg[c]
        kind = "fund" if e["kind"] == "fund_house" else "ins"
        docs_p = DATA / "companies" / f"{c}.docs.json"
        docs = json.loads(docs_p.read_text(encoding="utf-8"))["docs"] if docs_p.exists() else []
        rep_docs = [d for d in docs if d["type"] in ("quarterly", "annual") and not d.get("en")]
        per_of_url = {d["url"]: d["period"] for d in docs if re.fullmatch(r"\d{4}(Q[1-3]|FY)", d["period"])}
        # report periods: every quarter end with a quarterly P&L column (ReportDay.reportsOf)
        ends, pl_mi = set(), set(bk.by_sheet.get(rd.SHEETS["PL"], []))
        for (m, pi) in bk.facts:
            if m in pl_mi:
                p = bk.d["periods"][pi]
                if p["type"] == "Q" and p["end"][5:] in QE:
                    ends.add(p["end"])
        reports = sorted({key_of(x) for x in ends}, key=lambda p: (p[:4], p[4:].replace("FY", "Q4")), reverse=True)
        # CSM ledger (csm/facts/<id>.json), the reports Report Day resolves the balance over
        led_p = DATA / "csm" / "facts" / f"{c}.json"
        led = json.loads(led_p.read_text(encoding="utf-8")) if led_p.exists() else None
        rs = [(p, [f for f in F if f["c"] == c]) for p, F in led["reports"].items()] if led else []
        led_url = {f["period"]: f["url"] for f in led["files"]} if led else {}
        made = []
        for P in reports:
            card = build_card(c, e, kind, P, bk, rep_docs, per_of_url, rs, led_url, peer, ifrs_of, ifrs_url, targets)
            write(card)
            made.append(P)
        # the T+0 skeleton: a period the XBRL tags already give (kpi.json t0, unverified) and the statements do not yet carry
        k = kpi.get(c) or {}
        unv = []
        for p, t0 in (k.get("t0") or {}).items():
            i = k["periods"].index(p) if p in k["periods"] else -1
            if i < 0 or p in made or k["status"][i] != "unverified":
                continue
            card = skeleton(c, e, kind, p, k, i, t0)
            write(card)
            unv.append(p)
        index[c] = {"p": sorted(made + unv, key=lambda p: (p[:4], p[4:].replace("FY", "Q4")), reverse=True), **({"u": unv} if unv else {})}
        total += len(made) + len(unv)
    (OUT / "index.json").write_text(json.dumps({"v": 1, "built": built, "co": index}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.rglob("*.json"))
    print(f"cards: {total} cards for {len(index)} companies, {size / 1024:.0f} KB")


def write(card):
    card.d["u"] = card.urls
    card.d["f"] = card.facts
    d = OUT / card.c
    d.mkdir(exist_ok=True)
    (d / f"{card.p}.json").write_text(json.dumps(card.d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def F(fid):
    return {"f": fid}


def build_card(c, e, kind, P, bk, rep_docs, per_of_url, rs, led_url, peer, ifrs_of, ifrs_url, targets):
    card = Card(c, e["name_he"], kind, P)
    end = card.end
    annual, first = P.endswith("FY"), end.endswith("03-31")
    T = "FY" if annual else "Q"  # Report Day's default window: an annual report on the year, an interim report on the quarter
    card.d["w"] = T
    card.d["st"] = "verified"
    # the filing itself: the Hebrew periodic report of the period, preferring the file the figures were read from
    mine = [d for d in rep_docs if d["period"] == P]
    doc = next((d for d in mine if d["url"] in bk.urls), mine[0] if mine else None)
    card.d["doc"] = {"rid": doc["id"], "pub": doc["date"], "u": card.url(doc["url"]), "pages": doc.get("pages")} if doc else None
    yoy_end, qoq_end = shift_year(end, -1), qshift(end, -1)
    card.d["cmp"] = {"y": key_of(yoy_end), "q": key_of(qoq_end)}
    cur_l, yoy_l, qoq_l = plabel(T, end), plabel(T, yoy_end), plabel("Q", qoq_end)

    def late(f):
        p = per_of_url.get(f.get("url") or "")
        return p if p and end_of(p) > end else None

    def wbfact(fid, f, lab):
        fl = (["der"] if f["der"] else []) + (["ifrs4"] if f["std"] == "4" else []) + (["re"] if f["re"] else [])
        lt = late(f)
        dp = per_of_url.get(f.get("url") or "")
        fid = card.page(fid, f["v"], "m", f["url"], f["pg"], dp, "report", {"l": "wb", "mi": f["mi"], "pi": f["pi"]}, fl, lab)
        card.facts[fid]["std"] = f["std"]
        if lt:
            card.facts[fid]["s"]["late"] = lt
        return fid

    rows, lines, chips_of = [], [], {}
    figs = {}
    for key, lab in (("net", "רווח נקי לבעלי המניות"), ("comp", "רווח כולל לבעלי המניות"), ("eq", "הון לבעלי המניות")):
        role = rd.BY_KEY[key]
        t = T if role["flow"] else "I"
        rows_, alt = bk.resolve(role)
        cur = bk.fig_at(rows_, t, end)
        if not cur and not alt and role["alt"]:
            a, _ = bk.resolve(role, True)
            cc = bk.fig_at(a, t, end)
            if cc:
                rows_, alt, cur = a, True, cc
        if not cur:
            continue
        yoy = bk.fig_at(rows_, t, yoy_end)
        qoq = bk.fig_at(rows_, "I", qoq_end) if not role["flow"] else bk.fig_at(rows_, "Q", qoq_end) if T == "Q" else None
        r = {"k": key, "l": lab, "cur": wbfact(f"{key}.c", cur, cur["row"])}
        figs[key] = (cur, yoy, rows_)
        if alt:
            r["alt"] = 1
        if yoy:
            r["yoy"] = wbfact(f"{key}.y", yoy, yoy["row"])
            r["dy"], why = delta(card, f"{key}.dy", r["cur"], r["yoy"], cur_l if role["flow"] else "סוף התקופה", yoy_l if role["flow"] else "שנה קודם")
            if why:
                r["dyx"] = why
            if yoy["re"]:
                o = original(bk, yoy, card, f"{key}.y0")
                if o:
                    r["y0"] = o
        if qoq:
            r["qoq"] = wbfact(f"{key}.q", qoq, qoq["row"])
            r["dq"], why = delta(card, f"{key}.dq", r["cur"], r["qoq"], cur_l, qoq_l)
            if why:
                r["dqx"] = why
        rows.append(r)

    # ROE, LTM (lib/kpi.ts): LTM profit ÷ average of the equity at the end and a year earlier, on the Report Day rows
    def ltm(rows_, e_, fid):
        if e_.endswith("12-31"):
            fy = bk.fig_at(rows_, "FY", e_)
            if fy:
                return wbfact(fid, fy, fy["row"])
        qs = [bk.fig_at(rows_, "Q", qshift(e_, -k)) for k in (3, 2, 1, 0)]
        if not all(qs) or len({q["std"] for q in qs}) > 1:
            return None
        ins = [wbfact(f"{fid}.{i}", q, q["row"]) for i, q in enumerate(qs)]
        fid = card.calc(fid, sum(card.facts[x]["v"] for x in ins), "m", "sum", ins, "LTM = " + " + ".join(plabel("Q", qshift(e_, -k)) for k in (3, 2, 1, 0)))
        card.facts[fid]["std"] = qs[0]["std"]
        return fid

    def roe(e_, tag):
        if "net" not in figs or "eq" not in figs:
            return None
        nrows, erows = figs["net"][2], figs["eq"][2]
        n = ltm(nrows, e_, f"roe{tag}.n")
        e1, e0 = bk.fig_at(erows, "I", e_), bk.fig_at(erows, "I", shift_year(e_, -1))
        if not n or not e1 or not e0:
            return None
        a, b = wbfact(f"roe{tag}.e1", e1, e1["row"]), wbfact(f"roe{tag}.e0", e0, e0["row"])
        if card.facts[a]["v"] + card.facts[b]["v"] <= 0:
            return None
        v = card.facts[n]["v"] / ((card.facts[a]["v"] + card.facts[b]["v"]) / 2) * 100
        return card.calc(f"roe{tag}", v, "pct", "roe", [n, a, b], "רווח נקי LTM ÷ ממוצע ההון (סוף התקופה ושנה קודם)")

    rc = roe(end, ".c")
    if rc:
        r = {"k": "roe", "l": "ROE, LTM", "cur": rc, "der": 1}
        ry = roe(yoy_end, ".y")
        if ry:
            r["yoy"] = ry
            r["dy"], _ = delta(card, "roe.dy", rc, ry, f"LTM {plabel('Q', end)}", f"LTM {plabel('Q', yoy_end)}")
        rows.append(r)

    # CSM: the one rule (csm_resolve), with the page of the printed row (or the two segment rows added)
    if kind == "ins" and rs:
        def csm_at(d, fid):
            x = csm_resolve.resolve(rs, csm_resolve.own_period(d), d)
            if not x:
                return None, None
            def part(f, i):
                url = f.get("u") or led_url.get(x["rp"]) or ifrs_url.get((c, x["rp"]))
                return card.page(f"{fid}.{i}" if x["sum"] else fid, abs(f["dv"] if f.get("dv") is not None else f["v"]), "m", url, f.get("pg"), x["rp"],
                                 "deck" if f.get("u") else "report", {"l": "csm", "d": d, "i": i}, (["der"] if x["flags"] & 1 else []) + (["chart"] if f.get("src") in ("chart", "text") else []),
                                 x["label"])
            if x["sum"]:
                ins = [part(f, i) for i, f in enumerate(x["fs"])]
                return card.calc(fid, x["v"], "m", "sum", ins, f"חיים ועוד בריאות, {csm_resolve.BASIS_HE[x['b']]}"), x
            return part(x["fs"][0], 0), x
        cc, cx = csm_at(end, "csm.c")
        if cc:
            r = {"k": "csm", "l": "CSM, יתרת סגירה", "cur": cc, "basis": cx["label"]}
            cy, yx = csm_at(yoy_end, "csm.y")
            if cy and yx["b"] == cx["b"]:
                r["yoy"] = cy
                r["dy"], _ = delta(card, "csm.dy", cc, cy, "סוף התקופה", "שנה קודם")
            cq, qx = csm_at(qoq_end, "csm.q")
            if cq and qx["b"] == cx["b"]:
                r["qoq"] = cq
                r["dq"], _ = delta(card, "csm.dq", cc, cq, "סוף התקופה", "רבעון קודם")
            rows.append(r)
        # new business and release, the Peer Table's cells for the window
        pk = P if annual else P
        flows = {}
        for k, lab, fid in (("csm_new_business", "CSM: עסק חדש", "nb"), ("csm_release", "CSM: שחרור לרווח", "rel")):
            ent = peer[k]["e"].get(c)
            if not ent:
                continue
            for per, tag in ((pk, ".c"), (key_of(yoy_end) if not annual else f"{int(P[:4]) - 1}FY", ".y")):
                cell = next((x for x in ent["c"] if x[0] == per), None)
                if not cell:
                    continue
                if cell[2] is None and len(cell) > 6 and cell[6]:
                    ins = [card.page(f"{fid}{tag}.{i}", pv, "m", peer[k]["u"][pu] if pu is not None else None, ppg, per, "report",
                                     {"l": "peer", "f": k, "k": per, "i": i}, [], pl) for i, (pl, pv, ppg, pu) in enumerate(cell[6])]
                    flows[(fid, tag)] = card.calc(f"{fid}{tag}", cell[1], "m", "sum", ins, "חיים וחיסכון ועוד בריאות")
                else:
                    flows[(fid, tag)] = card.page(f"{fid}{tag}", cell[1], "m", peer[k]["u"][cell[3]] if cell[3] is not None else None, cell[2], per, "report",
                                                  {"l": "peer", "f": k, "k": per}, (["der"] if cell[4] & 1 else []) + (["cmp"] if cell[4] & 64 else []))
                flows[(fid, "b")] = ent.get("b")
            if (fid, ".c") in flows:
                r = {"k": fid, "l": lab, "cur": flows[(fid, ".c")]}
                if (fid, ".y") in flows:
                    r["yoy"] = flows[(fid, ".y")]
                    r["dy"], _ = delta(card, f"{fid}.dy", r["cur"], r["yoy"], cur_l, yoy_l)
                rows.append(r)
        if (("nb", ".c") in flows and ("rel", ".c") in flows and flows.get(("nb", "b")) == flows.get(("rel", "b"))
                and card.facts[flows[("rel", ".c")]]["v"] > 0):
            card.calc("nbrel", card.facts[flows[("nb", ".c")]]["v"] / card.facts[flows[("rel", ".c")]]["v"] * 100, "pct", "nbrel",
                      [flows[("nb", ".c")], flows[("rel", ".c")]], "עסק חדש ÷ שחרור לרווח")

        # solvency ratio as Report Day reads it (latest date the report gives, up to the period end), and the board target as the capital table
        F_ = ifrs_of(c, P)
        M = "solvency_ratio_with_transitional"
        dates = sorted({f["d"] for f in F_ if f["m"] == M and f["w"] == "instant" and f["d"] <= end})
        if dates:
            at = dates[-1]
            s0 = next(f for f in F_ if f["m"] == M and f["w"] == "instant" and f["d"] == at)["s"]
            hits = [f for f in F_ if f["m"] == M and f["s"] == s0 and f["w"] == "instant" and f["d"] == at]
            f0 = hits[0]
            url = f0.get("u") or ifrs_url.get((c, P))
            sr = card.page("sr.c", f0["v"], "pct", url, f0.get("pg"), P, "deck" if f0.get("u") else "report",
                           {"l": "ifrs", "p": P, "m": M, "d": at, "pg": f0.get("pg"), "s": s0}, ["text"] if f0.get("src") == "text" else [], f0.get("l"))
            r = {"k": "sr", "l": "יחס כושר פירעון, עם הוראות מעבר", "cur": sr, "at": at}
            if len({f["v"] for f in hits}) > 1:
                r["multi"] = 1
            else:
                prev = [f for f in F_ if f["m"] == M and f["s"] == s0 and f["w"] == "instant" and f["d"] == shift_year(at, -1)]
                if prev and len({f["v"] for f in prev}) == 1:
                    p0 = prev[0]
                    r["yoy"] = card.page("sr.y", p0["v"], "pct", p0.get("u") or ifrs_url.get((c, P)), p0.get("pg"), P, "report",
                                         {"l": "ifrs", "p": P, "m": M, "d": p0["d"], "pg": p0.get("pg"), "s": s0}, [], p0.get("l"))
                    r["dy"], _ = delta(card, "sr.dy", sr, r["yoy"], "סוף התקופה", "שנה קודם")
            rows.append(r)
            # the board target: the latest target fact of the report dated up to the period end; headroom only where one value is printed,
            # measured on the ratio of the same basis (a target "without transitional" against the ratio without transitional)
            tg = [f for f in F_ if TARGET_RE.match(f["m"]) and f["d"] <= end]
            if tg:
                td = max(f["d"] for f in tg)
                vals = []
                for f in tg:
                    if f["d"] == td and f["v"] not in [x["v"] for x in vals]:
                        vals.append(f)
                tfs = [card.page(f"tg.{i}", f["v"], "tpct", f.get("u") or ifrs_url.get((c, P)), f.get("pg"), P, "report",
                                 {"l": "ifrs", "p": P, "m": f["m"], "d": f["d"], "pg": f.get("pg"), "s": f["s"], "w": f.get("w")}, [], f.get("l")) for i, f in enumerate(vals[:3])]
                card.d["board"] = {"t": tfs, "d": td}
                if len(vals) == 1:
                    wo = "without" in vals[0]["m"]
                    base = sr
                    if wo:
                        M0 = "solvency_ratio_without_transitional"
                        z = [f for f in F_ if f["m"] == M0 and f["w"] == "instant" and f["d"] == at]
                        base = card.page("sr0.c", z[0]["v"], "pct", z[0].get("u") or ifrs_url.get((c, P)), z[0].get("pg"), P, "report",
                                         {"l": "ifrs", "p": P, "m": M0, "d": at, "pg": z[0].get("pg"), "s": z[0]["s"]}, [], z[0].get("l")) if z and len({f["v"] for f in z}) == 1 else None
                    if base:
                        card.d["board"]["hd"] = card.calc("tg.hd", card.facts[base]["v"] - vals[0]["v"], "pp", "diff", [base, tfs[0]], "יחס כושר פירעון − יעד הדירקטוריון")
                        card.d["board"]["base"] = "wo" if wo else "w"

    # restatements made by this report (ReportDay.restatedBy): count, material count, the three largest
    rest = [(i, r) for i, r in enumerate(bk.d.get("restated") or []) if r[11] == end]
    unit_of = {(m["sheet"], m["label"]): m.get("unit") for m in bk.d["metrics"]}
    if rest:
        big = [x for x in rest if x[1][5] == 0 or abs(x[1][8] - x[1][5]) / abs(x[1][5]) >= BIG / 100]
        card.d["rest"] = {"n": card.add("rest.n", len(rest), "n", {"k": "count", "ref": {"l": "count", "q": "rest"}}),
                          "big": card.add("rest.big", len(big), "n", {"k": "count", "ref": {"l": "count", "q": "rest_big"}}), "top": []}
        for j, (i, r) in enumerate(sorted(rest, key=lambda x: -abs(x[1][8] - x[1][5]))[:3]):
            unit = unit_of.get((r[0], r[2])) or ("nis" if "למניה" in r[2] else "k")
            if unit != "k":
                continue
            u0 = bk.urls[r[7]] if r[7] is not None and r[7] < len(bk.urls) else None
            u1 = bk.urls[r[10]] if r[10] is not None and r[10] < len(bk.urls) else None
            a = card.page(f"rest.{j}.0", r[5] / 1000, "m", u0, r[6], per_of_url.get(u0 or ""), "report", {"l": "rest", "i": i, "x": 0}, [], r[2])
            b = card.page(f"rest.{j}.1", r[8] / 1000, "m", u1, r[9], per_of_url.get(u1 or ""), "report", {"l": "rest", "i": i, "x": 1}, [], r[2])
            dd = card.calc(f"rest.{j}.d", (r[8] - r[5]) / 1000, "dm", "diff", [b, a], "הוצג מחדש − כפי שדווח אז")
            card.d["rest"]["top"].append({"i": i, "l": r[2], "pl": [r[3], r[4]], "a": a, "b": b, "d": dd})
    card.d["rows"] = rows

    # targets: stated in this filing or its deck (same period), and for an annual report the actual of the year as build_targets scores it
    tl = []
    # one row per target (metric, entity, horizon): the statement in force at the filing, i.e. the latest stated up to its publication
    pub = card.d["doc"]["pub"] if card.d["doc"] else "9999"
    pick = {}
    for i, t in enumerate(targets["rows"]):
        if t["c"] != c:
            continue
        st1 = t.get("st1") or [None, None, None]
        sdoc = targets["docs"].get(str(st1[1])) if st1[1] else None
        stated_here = bool(sdoc and sdoc[2] == P)
        act = t.get("act")
        scored = annual and act and act.get("y") == int(P[:4]) and (st1[0] or "") <= pub
        if not (stated_here or scored):
            continue
        k_ = (t["m"], t.get("e"), t.get("h"))
        if k_ not in pick or (st1[0] or "", stated_here) > (pick[k_][2] or "", pick[k_][3]):
            pick[k_] = (i, t, st1[0], stated_here, sdoc, st1)
    for i, t, _d, stated_here, sdoc, st1 in sorted(pick.values(), key=lambda x: x[0]):
        act = t.get("act")
        scored = annual and act and act.get("y") == int(P[:4])
        ref = lambda x: {"l": "tg", "i": i, "x": x}
        unit = "tpct" if t["u"] == "pct" else "m" if t["u"] == "m" else None
        if unit is None:
            continue
        url = targets["files"] + sdoc[4] if sdoc else None
        item = {"i": i, "l": t["l"], "e": t.get("e") or "", "src": t.get("src")}
        for x in ("v", "lo", "hi"):
            if t.get(x) is not None:
                item[x] = card.page(f"t{i}.{x}", t[x], unit, url, st1[2], sdoc[2] if sdoc else None, "deck" if t.get("src") == "pres" else "report", ref(x), [], t["l"])
        if t.get("h"):
            item["h"] = t["h"]
        if scored:
            au = "pct" if act["k"] in ("roe", "sr", "payout") else "m"
            ins = []
            for j, row in enumerate(act.get("in") or []):
                lab_, v_, url_, pg_, per_, solv_ = (list(row) + [None] * 6)[:6]
                ins.append(card.page(f"t{i}.a.{j}", v_, "pct" if str(lab_).startswith("יחס") else "m", url_, pg_, None, "solvency" if solv_ else "report",
                                     {"l": "tgin", "i": i, "j": j}, [], f"{lab_} · {per_}"))
            item["act"] = card.add(f"t{i}.a", act["v"], au, {"k": "calc", "op": "tgact", "in": ins, "fx": act.get("f") or "", "ref": {"l": "tg", "i": i, "x": "act"}})
            item["st"] = t.get("st")
            item["y"] = act["y"]
        if not any(x in item for x in ("v", "lo", "hi")):
            continue
        tl.append(item)
    card.d["tg"] = tl[:6]

    # the lead: fixed templates, every digit a fact
    by = {r["k"]: r for r in rows}
    if "net" in by:
        r = by["net"]
        s = ["רווח נקי לבעלי המניות ", {"pl": [T, end]}, ": ", F(r["cur"]), " מ׳ ש״ח"]
        if r.get("dy"):
            s += [", ", F(r["dy"]), " מול ", {"pl": [T, yoy_end]}]
        lines.append(s)
    if "comp" in by:
        r = by["comp"]
        s = ["רווח כולל לבעלי המניות: ", F(r["cur"]), " מ׳ ש״ח"]
        if r.get("dy"):
            s += [", ", F(r["dy"]), " מול ", {"pl": [T, yoy_end]}]
        lines.append(s)
    if "eq" in by:
        r = by["eq"]
        s = ["הון לבעלי המניות ליום ", {"d": end}, ": ", F(r["cur"]), " מ׳ ש״ח"]
        if "roe" in by:
            s += [" · ROE, LTM: ", F(by["roe"]["cur"])]
            if by["roe"].get("dy"):
                s += [" (", F(by["roe"]["dy"]), ")"]
        lines.append(s)
    if "csm" in by:
        r = by["csm"]
        s = ["יתרת CSM ליום ", {"d": end}, ": ", F(r["cur"]), " מ׳ ש״ח, ", r["basis"]]
        if r.get("dy"):
            s += ["; ", F(r["dy"]), " מול שנה קודם"]
        lines.append(s)
    if "nb" in by and "rel" in by:
        s = ["עסק חדש ", F(by["nb"]["cur"]), " מ׳ ש״ח מול שחרור לרווח ", F(by["rel"]["cur"]), " מ׳ ש״ח"]
        if "nbrel" in card.facts:
            s += [" · יחס ", F("nbrel")]
        lines.append(s)
    if "sr" in by:
        r = by["sr"]
        s = ["יחס כושר פירעון, עם הוראות מעבר, ליום ", {"d": r["at"]}, ": ", F(r["cur"])]
        b = card.d.get("board")
        if b and b.get("hd"):
            s += ["; יעד הדירקטוריון", " (ללא הוראות מעבר)" if b["base"] == "wo" else "", " ", F(b["t"][0]), ", מרווח ", F(b["hd"])]
        elif b:
            s += ["; יעדי הדירקטוריון בדוח: "] + sum(([F(x), " · "] for x in b["t"]), [])[:-1]
        lines.append(s)
    if card.d.get("rest"):
        R = card.d["rest"]
        lines.append(["הדוח הציג מחדש ", F(R["n"]), " נתונים של תקופות קודמות, ", F(R["big"]), " מהם בשינוי של 2% ומעלה"])
    else:
        lines.append(["הדוח לא הציג מחדש נתונים של תקופות קודמות"])
    card.d["lead"] = lines
    # the stamp: how many printed figures the card was checked against
    npg = sum(1 for f in card.facts.values() if f["s"]["k"] == "pg")
    card.d["chk"] = card.add("chk", npg, "n", {"k": "count", "ref": {"l": "count", "q": "facts"}})
    return card


def original(bk, f, card, fid):
    """The figure first reported for a comparative that a later report restated (workbook `restated`, flag 8): the earliest print."""
    rows = [(i, r) for i, r in enumerate(bk.d.get("restated") or []) if r[0] == f["sheet"] and r[2] == f["row"] and r[3] == f["typ"] and r[4] == f["end"]]
    if not rows:
        return None
    i, r = min(rows, key=lambda x: x[1][11])
    u0 = bk.urls[r[7]] if r[7] is not None and r[7] < len(bk.urls) else None
    return card.page(fid, r[5] / 1000, "m", u0, r[6], None, "report", {"l": "rest", "i": i, "x": 0}, [], r[2])


def skeleton(c, e, kind, p, k, i, t0):
    """The T+0 card: what the XBRL tags of a report filed today give, before its printed figures are extracted (status unverified)."""
    card = Card(c, e["name_he"], kind, p)
    card.d.update({"w": "FY" if p.endswith("FY") else "Q", "st": "unverified", "doc": {"rid": t0.get("rid"), "pub": t0.get("pub"), "u": None, "pages": None}, "t0": {"how": t0.get("how")}})
    yp = f"{int(p[:4]) - 1}{p[4:]}"
    card.d["cmp"] = {"y": yp, "q": None}
    rows, lines = [], []
    for key, lab, kk in (("net", "רווח נקי לבעלי המניות", "profit"), ("comp", "רווח כולל לבעלי המניות", "oci"), ("eq", "הון לבעלי המניות", "equity")):
        vals = k["values"].get(kk) or []
        v = vals[i] if i < len(vals) else None
        if v is None:
            continue
        r = {"k": key, "l": lab, "cur": card.add(f"{key}.c", v / 1000, "m", {"k": "xbrl", "rid": t0.get("rid"), "ref": {"l": "kpi", "key": kk, "p": p}})}
        j = k["periods"].index(yp) if yp in k["periods"] else -1
        if j >= 0 and j < len(vals) and vals[j] is not None:
            r["yoy"] = card.add(f"{key}.y", vals[j] / 1000, "m", {"k": "xbrl", "rid": k["rid"][j] if j < len(k.get("rid") or []) else None, "ref": {"l": "kpi", "key": kk, "p": yp}})
            r["dy"], _ = delta(card, f"{key}.dy", r["cur"], r["yoy"], "התקופה", "שנה קודם")
        rows.append(r)
    card.d["rows"] = rows
    if rows:
        r = rows[0]
        s = [r["l"] + ", לפי תיוג XBRL: ", F(r["cur"]), " מ׳ ש״ח"]
        if r.get("dy"):
            s += [", ", F(r["dy"]), " מול ", {"p": yp}]
        lines.append(s)
    card.d["lead"] = lines
    card.d["tg"] = []
    card.d["chk"] = card.add("chk", 0, "n", {"k": "count", "ref": {"l": "count", "q": "facts"}})
    return card


if __name__ == "__main__":
    main()
