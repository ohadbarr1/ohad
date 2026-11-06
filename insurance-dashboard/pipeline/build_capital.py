"""A7 · Capital & Strategic Options: per insurer, the surplus capital, the option set over it and its ranking.

    Distributable capital = own funds − SCR × board target − management buffer          (each printed basis; the binding one is the lower)

    Options                    Capacity   ROIC                     Solvency cost                  Accretion
      Dividend / buyback        ₪m         ke (valuation.ts)        capital ÷ SCR, pp              ROE and EPS effect
      Organic growth capital    ₪m         LTM ROE (labelled est)   OF ÷ (SCR + capital ÷ target)   EPS effect of the return over rf
      Bolt-on                   A9: the best-ranked target the insurer can afford (consolidation/bolt.json, pipeline/build_consolidation.py):
                                price at a 20% premium, ROIC with run-rate synergies, solvency cost − cash ÷ SCR
      Hold against stress       on the page: the A2 presets through web/src/lib/drivers.ts propagate (web/src/lib/capital.ts)

Inputs (all built and gated already; nothing is extracted here)
  web/public/data/csm/solvency.json    the separate economic-solvency reports: own funds, SCR, ratio and surplus with / without transitional
  web/public/data/csm/facts/<co>.json  the same lines as the financial statements print them, the dividend lines and the payout policy
  web/public/data/csm/capital.json     the ratio series (with / without transitional) for the buffer's drift
  web/public/data/drivers/<co>.json    A1: board targets as printed (with page), LTM net profit, equity, ROE, ke, rf, tax, justified P/B
  web/public/data/consolidation/bolt.json   A9: the bolt-on row (its provenance table travels with the row: refs `bolt.<pointer>`)
Output
  web/public/data/capital/options.json

The management buffer is a labelled, overridable assumption: the median absolute change of the printed ratio between consecutive
half-year calculation dates (the binding basis, last three years), i.e. the ordinary drift between two calculation dates. Stress is the
A2 overlay, not the buffer. Where a company prints no board target for the insurer, the constraint is the regulatory 100% (labelled).
Phoenix (the owner's employer) is computed like every other company.

python3 pipeline/build_capital.py           build
python3 pipeline/build_capital.py --check   rebuild in memory, compare with the file, and verify: the identity (distributable = own funds −
                                            SCR × target − buffer) on every constraint, own funds ÷ SCR = the printed ratio, every figure
                                            carries provenance down to a report page (or is labelled an assumption), no NaN
"""
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "capital" / "options.json"
BOLT = WEB / "consolidation" / "bolt.json"
MM = 'מיליוני ש"ח'
MINUS = "−"
INSURERS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara", "idi"]
BUFFER_YEARS = 3          # the drift window of the buffer
BUFFER_FALLBACK = 5.0     # pp of SCR when fewer than two half-year moves are printed (an assumption, labelled)
RATIO_TOL = 1.5           # pp: own funds ÷ SCR against the printed (rounded) ratio
ID_TOL = 0.5              # NIS m: the identities


# ---------------------------------------------------------------- formats
def fm(v, d=0):
    if v is None or not math.isfinite(v):
        return "–"
    t = f"{v:,.{d}f}"
    return t[1:] if re.fullmatch(r"-[0.,]+", t) else t.replace("-", MINUS)


def fs(v, d=0):
    return ("+" if v is not None and round(v, d) > 0 else "") + fm(v, d)


def pct(v, d=1):
    return f"{fm(v, d)}%"


def r6(v):
    return None if v is None else round(v, 6)


def qname(rp):
    """2026Q1 -> Q1'26, 2025FY -> FY'25"""
    return f"FY'{rp[2:4]}" if rp.endswith("FY") else f"{rp[4:]}'{rp[2:4]}"


def dlab(d):
    return f"{ {'03': 'Q1', '06': 'Q2', '09': 'Q3', '12': 'Q4'}.get(d[5:7], d[5:7]) }'{d[2:4]}"


def dperiod(d):
    """the solvency date as the site names a balance: 2025-12-31 -> FY'25, 2025-06-30 -> Q2'25"""
    return f"FY'{d[2:4]}" if d[5:] == "12-31" else dlab(d)


def rp_end(rp):
    return f"{rp[:4]}-{ {'Q1': '03-31', 'Q2': '06-30', 'Q3': '09-30', 'Q4': '12-31', 'FY': '12-31'}[rp[4:]] }"


def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


# ---------------------------------------------------------------- provenance (drivers.ts ProvJ: report | calc with inputs {label, v, p?})
def rep(title, value, url, pg, doc, period, note=None, unit=MM, src=None):
    p = {"k": "report", "title": title, "value": value, "unit": unit, "url": url, "pg": pg, "doc": doc, "period": period}
    if note:
        p["note"] = note
    if src:
        p["srcType"] = src
    return p


def calc(title, value, formula, inputs, unit=MM, est=False, note=None):
    p = {"k": "calc", "title": title, "value": value, "unit": unit, "formula": formula, "inputs": inputs}
    if est:
        p["est"] = True
    if note:
        p["note"] = note
    return p


def inp(label, v, p=None):
    x = {"label": label, "v": v}
    if p is not None:
        x["p"] = p
    return x


def fig(v, p):
    return {"v": r6(v), "prov": p}


def ref(path):
    """a pointer to another figure's provenance in the same company (web/src/lib/capital.ts resolves it): keeps the file small"""
    return {"k": "ref", "r": path}


# ---------------------------------------------------------------- bases of a printed line
WO = re.compile(r"without transi|without[ _](the )?(application of )?(the )?(transitional|tmtp)|without (taking into account|regard to|applying) the (transitional|provisions)|ללא (התחשבות ב|יישום |)הוראות", re.I)
WI = re.compile(r"\bwith transi|takes the transitional|transitional deduction|\bwith[ _](the )?(application of )?(the )?(transitional|tmtp)|taking (into account )?the (transitional|provisions)|taking transitional|בתקופת הפריסה|ביישום הוראות|בהתחשב בהוראות|תוך התחשבות בהוראות", re.I)
SUBS = re.compile(r"wesure|ווישור|shomera|שומרה|credit_cards|^max$|non-controlling|mcr", re.I)


def basis_of(m, s, l, n):
    if re.search(r"without_(transitional|tmtp)", m):
        return "wo"
    if re.search(r"with_(transitional|tmtp)", m):
        return "w"
    for t in (s or "", l or "", n or ""):
        if WO.search(t):
            return "wo"
        if WI.search(t):
            return "w"
    return "?"


def is_after(m, l, n):
    return bool(re.search(r"_after_|pro_forma", m) or (re.search(r"\bafter\b|לאחר|pro forma", l or "", re.I) and not re.search(r"before|לפני", l or "", re.I))
                or re.search(r"incl\. (NIS )?[\d.]+ (mn )?(Tier|issuance)|pro forma|after (effect|capital|equity|material)", n or "", re.I))


BH = {"w": "עם הוראות מעבר", "wo": "ללא הוראות מעבר"}


# ---------------------------------------------------------------- inputs
class Inputs:
    def __init__(self):
        self.S = json.loads((WEB / "csm" / "solvency.json").read_text(encoding="utf8"))
        self.cap = json.loads((WEB / "csm" / "capital.json").read_text(encoding="utf8"))["companies"]
        self.reg = {c["id"]: c for c in json.loads((WEB / "companies" / "index.json").read_text(encoding="utf8"))}
        self.facts, self.drv = {}, {}
        for c in self.reg:
            fp = WEB / "csm" / "facts" / f"{c}.json"
            if fp.exists():
                self.facts[c] = json.loads(fp.read_text(encoding="utf8"))
            dp = WEB / "drivers" / f"{c}.json"
            if dp.exists():
                self.drv[c] = json.loads(dp.read_text(encoding="utf8"))


class Co:
    def __init__(self, I, c):
        self.I, self.c = I, c
        self.name = I.reg[c]["name_he"]
        self.f = I.drv.get(c)
        F = I.facts.get(c)
        self.urls = {x["period"]: x["url"] for x in (F or {}).get("files", [])}
        self.F = []   # every fact with its report period
        for rp, xs in sorted((F or {}).get("reports", {}).items(), key=lambda kv: rp_end(kv[0]) + ("0" if kv[0].endswith("FY") else "1")):
            for x in xs:
                self.F.append({**x, "rp": rp})

    # --- one printed line as a provenance leaf
    def fact_prov(self, x, title, value, unit=MM):
        url = x.get("u") or self.urls.get(x["rp"])
        return rep(title, value, url, x.get("pg"), "דוח כספי" if not x.get("u") else "מצגת", qname(x["rp"]), note=x.get("l"), unit=unit)

    def solv_prov(self, cell, title, d, value, unit=MM):
        S = self.I.S
        r = S["reports"].get(str(cell["r"]), {})
        return rep(title, value, S["files"] + r["f"] if r.get("f") else None, cell.get("pg"), f"{r.get('e') or 'חברת הביטוח'}, דוח כושר פירעון כלכלי ליום {dlab(r.get('as_of', d))}",
                   dperiod(d), note=cell.get("l"), unit=unit, src="דוח כושר פירעון כלכלי (MAYA)")

    # --- own funds and SCR per basis at the newest calculation date
    def solvency(self):
        cand = {}   # date -> basis -> {of, scr, sr, su}: (value, prov)
        S = self.I.S["companies"].get(self.c, {})
        for d, row in S.items():
            for b in ("w", "wo"):
                for k, key in (("of", f"of_{b}"), ("scr", f"scr_{b}"), ("sr", f"sr_{b}"), ("su", f"su_{b}")):
                    if key in row:
                        cell = row[key]
                        what = {"of": "הון עצמי לעניין SCR", "scr": "SCR", "sr": "יחס כושר פירעון", "su": "עודף הון"}[k]
                        cand.setdefault(d, {}).setdefault(b, {}).setdefault(k, (cell["v"], self.solv_prov(cell, f"{what}, {BH[b]} · {self.name} · {dperiod(d)}", d,
                                                                                                         pct(cell["v"], 0 if float(cell["v"]).is_integer() else 1) if k == "sr" else fm(cell["v"]), "%" if k == "sr" else MM)))
        # the financial statements: the newest report first; plain lines only (no capital actions after the date, no MCR, no subsidiaries)
        for x in reversed(self.F):
            m = x["m"]
            k = "of" if re.match(r"^own_funds", m) else "scr" if re.match(r"^scr", m) else "sr" if re.match(r"^solvency_ratio_(with|without)_transitional", m) else \
                "su" if re.match(r"^solvency_surplus(_with_transitional|_without_transitional)?$", m) else None
            if not k or SUBS.search(x.get("s", "")) or "mcr" in m or is_after(m, x.get("l"), x.get("n")):
                continue
            b = basis_of(m, x.get("s"), x.get("l"), x.get("n"))
            if b == "?" and any(y["d"] == x["d"] and y.get("s") == f"{x.get('s')}_without_transitional" for y in self.F):
                b = "w"   # the entity's without-transitional lines carry their own entity name: the plain one is with the transitional measures
            if b == "?":
                continue
            what = {"of": "הון עצמי לעניין SCR", "scr": "SCR", "sr": "יחס כושר פירעון", "su": "עודף הון"}[k]
            slot = cand.setdefault(x["d"], {}).setdefault(b, {})
            if k not in slot:
                slot[k] = (x["v"], self.fact_prov(x, f"{what}, {BH[b]} · {self.name} · {dperiod(x['d'])}", pct(x["v"], 0 if float(x["v"]).is_integer() else 1) if k == "sr" else fm(x["v"]),
                                                  "%" if k == "sr" else MM))
        # a missing own funds or SCR: from the printed surplus (exact), else from the surplus and the rounded ratio (labelled)
        for d, bs in cand.items():
            for b, s in bs.items():
                if "su" not in s or ("of" in s and "scr" in s):
                    continue
                su = s["su"][0]
                t = lambda k: f"{'SCR' if k == 'scr' else 'הון עצמי לעניין SCR'}, {BH[b]} · {self.name} · {dperiod(d)}"
                if "of" in s:
                    v = s["of"][0] - su
                    s["scr"] = (v, calc(t("scr"), fm(v), "SCR = הון עצמי − עודף", [inp("הון עצמי", fm(s["of"][0]), s["of"][1]), inp("עודף הון", fm(su), s["su"][1])], note="נגזר משני סכומים מודפסים"))
                elif "scr" in s:
                    v = s["scr"][0] + su
                    s["of"] = (v, calc(t("of"), fm(v), "הון עצמי = SCR + עודף", [inp("SCR", fm(s["scr"][0]), s["scr"][1]), inp("עודף הון", fm(su), s["su"][1])], note="נגזר משני סכומים מודפסים"))
                elif "sr" in s and s["sr"][0] > 100:
                    sr = s["sr"][0]
                    scr = su / (sr / 100 - 1)
                    note = "נגזר: היחס הודפס מעוגל, ולכן SCR והון עצמי מקורבים"
                    s["scr"] = (scr, calc(t("scr"), fm(scr), "SCR = עודף ÷ (יחס ÷ 100 − 1)", [inp("עודף הון", fm(su), s["su"][1]), inp("יחס כושר פירעון", pct(sr, 0), s["sr"][1])], est=True, note=note))
                    s["of"] = (su + scr, calc(t("of"), fm(su + scr), "הון עצמי = עודף + SCR", [inp("עודף הון", fm(su), s["su"][1]), inp("SCR (נגזר)", fm(scr), s["scr"][1])], est=True, note=note))
        full = sorted(d for d, bs in cand.items() if any("of" in s and "scr" in s for s in bs.values()))
        if not full:
            return None, None
        d = full[-1]
        return d, {b: s for b, s in cand[d].items() if "of" in s and "scr" in s}

    # --- the constraints: the board's targets and the dividend thresholds as printed (A1's list, with its pages)
    def targets(self, end):
        out, rows = {}, []
        for t in self.f["targets"] if self.f else []:
            m, l, n, s = t["m"], t.get("l") or "", t.get("n") or "", t.get("s") or ""
            if not re.match(r"^target_(solvency_ratio|dividend_threshold|solvency_dividend_threshold)", m) or SUBS.search(s) or SUBS.search(l):
                continue
            if not (90 <= t["v"] <= 250) or t["d"] > "2027-12-31" or re.search(r"בתום תקופת הפריסה|end of (the )?(phase-in|transition)|2032|end_20", l + m):
                continue
            kind = "div" if re.search(r"dividend|לחלוקת דיבידנד|for dividend distribution", m + " " + l) else "board"
            rows.append((kind, basis_of(m, s, l, n), t))
        stated = {k for k, b, _ in rows if b != "?"}
        # the target that applies to this calculation: the newest one stated as effective on or before `end` (the solvency report's
        # publication when the figures come from one, else the calculation date). A target raised after that (Phoenix: 123% in the FY'25
        # solvency report, 125% decided 24.08.26 from 30.06.26) is never applied to the earlier own funds and SCR: it is carried as `later`,
        # so the page can say so. Only when no target is effective by then does the earliest later one stand in (labelled by its period).
        # build() then prefers the target the solvency report itself prints for the date (csm/solvency.json tg_<basis>).
        later = {}
        for kind, b, t in rows:
            if b == "?" and kind in stated:
                continue   # the company states the basis of this target elsewhere: an unstated restatement is the same target
            rp = t.get("rp") or ""
            key = (rp_end(rp) if rp else t["d"], 0 if rp.endswith("FY") else 1, t["d"])
            for bb in (["w", "wo"] if b == "?" else [b]):
                if t["d"] > end:
                    cur = later.get((kind, bb))
                    if cur is None or (t["d"], key) < (cur[1]["d"], cur[0]):
                        later[(kind, bb)] = (key, t, b)
                    continue
                cur = out.get((kind, bb))
                if cur is None or (t["d"], key) > (cur[1]["d"], cur[0]):
                    out[(kind, bb)] = (key, t, b)
        res = {}
        for k in set(out) | set(later):
            if k in out:
                res[k] = (out[k][1], out[k][2], later[k][1] if k in later and later[k][1]["v"] != out[k][1]["v"] else None)
            else:
                res[k] = (later[k][1], later[k][2], None)
        return res

    def target_prov(self, t):
        rp = t.get("rp")
        return rep(f"{'סף לחלוקת דיבידנד' if 'div' in t['m'] or 'dividend' in (t.get('l') or '') else 'יעד הדירקטוריון'} · {self.name}", pct(t["v"], 0 if float(t["v"]).is_integer() else 1),
                   t.get("u"), t.get("pg"), "דוח כספי", qname(rp) if rp else t["d"], note=t.get("l"), unit="%")

    # --- the ordinary drift of the ratio: |Δ| between consecutive half-year calculation dates
    def drift(self, b, d0):
        pts = {}
        S = self.I.S["companies"].get(self.c, {})
        for d, row in S.items():
            if f"sr_{b}" in row:
                pts[d] = (row[f"sr_{b}"]["v"], self.solv_prov(row[f"sr_{b}"], f"יחס כושר פירעון, {BH[b]} · {self.name} · {dperiod(d)}", d, pct(row[f"sr_{b}"]["v"], 0), "%"))
        C = self.I.cap.get(self.c, {}).get(f"sr_{b}", {})
        for rp, cell in C.items():
            d = rp_end(rp)
            if d not in pts and cell.get("v") is not None:
                pts[d] = (cell["v"], rep(f"יחס כושר פירעון, {BH[b]} · {self.name} · {dperiod(d)}", pct(cell["v"], 0), cell.get("u"), cell.get("pg"), "דוח כספי", qname(rp), unit="%"))
        lo = f"{int(d0[:4]) - BUFFER_YEARS}{d0[4:]}"
        ds = sorted(d for d in pts if d[5:] in ("06-30", "12-31") and lo <= d <= d0)
        moves = [(a, z, pts[z][0] - pts[a][0]) for a, z in zip(ds, ds[1:]) if months_between(a, z) == 6]
        return moves, pts

    # --- LTM dividend declared (group): the quarter column where printed, else cumulative less the cumulative before it
    def dividends(self, quarters):
        def flow(p, ws):
            d = rp_end(p)
            order = [x for x in reversed(self.F) if x["rp"] == p] + [x for x in reversed(self.F) if x["rp"] != p]
            xs = [x for x in order if x["m"] == "dividend_declared" and x.get("g") == "group" and x.get("s") == "group" and x["d"] == d and x.get("w") in ws]
            xs.sort(key=lambda x: (x.get("src") == "text", ws.index(x["w"])))
            return xs[0] if xs else None
        out = []
        for p in quarters:
            first, annual = p.endswith("Q1"), p.endswith("FY")
            q = None if annual else flow(p, ["q", "ytd"] if first else ["q"])
            title = f"דיבידנד שהוכרז · {self.name} · {qname(p).replace('FY', 'Q4')}"
            if q:
                out.append((abs(q["v"]), self.fact_prov(q, title, fm(abs(q["v"]), 1))))
                continue
            if first:   # a first quarter the report does not print: the half-year column less the second-quarter column of the next report
                n2 = f"{p[:4]}Q2"
                cum, pr = flow(n2, ["ytd"]), flow(n2, ["q"])
            else:
                prev = f"{p[:4]}Q3" if annual else f"{p[:4]}Q{int(p[5]) - 1}"
                cum, pr = flow(p, ["fy" if annual else "ytd"]), flow(prev, ["ytd", "q"] if prev.endswith("Q1") else ["ytd"])
            if not (cum and pr):
                out.append(None)
                continue
            v = abs(cum["v"]) - abs(pr["v"])
            out.append((v, calc(title, fm(v, 1), "מצטבר פחות המצטבר שלפניו (Q4 = FY פחות 9M)",
                                [inp(f"{cum.get('l', '')[:60]} · {qname(cum['rp'])}", fm(abs(cum["v"]), 1), self.fact_prov(cum, title, fm(abs(cum["v"]), 1))),
                                 inp(f"פחות: {pr.get('l', '')[:60]} · {qname(pr['rp'])}", fm(abs(pr["v"]), 1), self.fact_prov(pr, title, fm(abs(pr["v"]), 1)))])))
        return out

    def policy(self):
        out = {}
        HE = {"target_dividend_payout_min": "דיבידנד, מינימום מהרווח", "target_dividend_payout": "דיבידנד, מינימום מהרווח", "target_total_payout_min": "דיבידנד ורכישה עצמית, מינימום מהרווח"}
        for x in reversed(self.F):
            m = x["m"]
            k = "payout" if m in ("target_dividend_payout_min", "target_dividend_payout") else "total" if m == "target_total_payout_min" else "buyback" if m.startswith("target_share_buyback") else None
            if not k or k in out or (x.get("s") not in ("group", None) and k != "payout"):
                continue
            if k == "payout" and x.get("s") != "group" and any(y["m"] == m and y.get("s") == "group" and y["rp"] == x["rp"] for y in self.F):
                continue
            he = HE.get(m, "תוכנית רכישה עצמית")
            unit = MM if k == "buyback" else "%"
            out[k] = {"he": he, "v": r6(x["v"]), "unit": unit, "d": x["d"], "prov": self.fact_prov(x, f"מדיניות חלוקה · {self.name} · {he}", fm(x["v"]) if k == "buyback" else pct(x["v"], 0), unit)}
        return [out[k] for k in ("payout", "total", "buyback") if k in out]

    def printed_over(self):
        """the surplus over the target the company prints itself (newest date), for the cross-check line: the financial statements' line or
        the solvency report's own (csm/solvency.json `sut_<basis>`, the report the own funds and SCR come from), whichever is newer"""
        xs = [x for x in self.F if re.match(r"^(solvency_surplus_(over_target|vs_board_target|vs_target)|surplus_vs_(board_)?target|target_excess_capital|target_solvency_surplus_vs_board_target(_without_transitional)?)$", x["m"])
              and not SUBS.search(x.get("s", ""))]
        best = None
        if xs:
            x = max(xs, key=lambda x: (x["d"], rp_end(x["rp"])))
            b = basis_of(x["m"], x.get("s"), x.get("l"), x.get("n"))
            best = {"v": r6(x["v"]), "d": x["d"], "basis": b if b != "?" else None, "after": bool(re.search(r"after|לאחר", (x.get("l") or "") + (x.get("n") or ""), re.I)),
                    "prov": self.fact_prov(x, f"עודף הון מעל היעד, כפי שהודפס · {self.name} · {dperiod(x['d'])}", fm(x["v"]))}
        S = self.I.S["companies"].get(self.c, {})
        for d in sorted(S, reverse=True):
            row = S[d]
            for b in ("wo", "w"):
                cell = row.get(f"sut_{b}")
                if cell and (best is None or d > best["d"]):
                    # the solvency reports compute it on own funds after the capital actions to publication when they print those
                    after = f"ofa_{b}" in row and abs(row[f"ofa_{b}"]["v"] - row[f"scr_{b}"]["v"] * row[f"tg_{b}"]["v"] / 100 - cell["v"]) <= 1.0 if f"tg_{b}" in row and f"scr_{b}" in row else False
                    return {"v": r6(cell["v"]), "d": d, "basis": b, "after": after,
                            "prov": self.solv_prov(cell, f"עודף הון מעל היעד, כפי שהודפס · {self.name} · {dperiod(d)}", d, fm(cell["v"]))}
            if best is not None and d <= best["d"]:
                break
        return best

    # --- the whole company
    def build(self, bolt=None):
        base = {"id": self.c, "name": self.name, "kind": "insurance_group"}
        if self.c == "phoenix" and self.f and self.f["meta"].get("flag"):
            base["flag"] = self.f["meta"]["flag"]
        d, bases = self.solvency()
        if not d:
            return {**base, "status": "na", "why": "לא חולצו הון עצמי ו-SCR לחברת הביטוח (אין דוחות כספיים בסדרה)"}
        if not self.f:
            return {**base, "status": "na", "why": "אין קובץ מנגנונים (A1) לחברה"}
        N, A = self.f["nodes"], self.f["meta"]["assume"]
        B = {}
        for b, s in sorted(bases.items()):
            of, scr = s["of"][0], s["scr"][0]
            B[b] = {"of": fig(of, s["of"][1]), "scr": fig(scr, s["scr"][1]),
                    "ratio": fig(of / scr * 100, calc(f"יחס כושר פירעון, {BH[b]} · {self.name} · {dperiod(d)}", pct(of / scr * 100), "הון עצמי ÷ SCR × 100",
                                                      [inp("הון עצמי", fm(of), ref(f"bases.{b}.of")), inp("SCR", fm(scr), ref(f"bases.{b}.scr"))], unit="%")),
                    "printed": r6(s["sr"][0]) if "sr" in s else None}
            if "sr" in s:
                B[b]["printed_prov"] = s["sr"][1]
        S_row = self.I.S["companies"].get(self.c, {}).get(d, {})
        S_rep = {}
        for cell in S_row.values():
            S_rep = self.I.S["reports"].get(str(cell.get("r")), {}) or S_rep
            if S_rep:
                break
        T = self.targets(max(d, S_rep.get("pub") or d))
        for b, key in (("wo", "tg_wo"), ("w", "tgm_w")):  # the solvency report's own board target for this date wins over the statements' wording
            cell = S_row.get(key)
            if cell:
                t0, tb, nxt = T.get(("board", b)) or ({"m": "target_solvency_ratio"}, b, None)
                T[("board", b)] = ({"m": t0["m"], "v": cell["v"], "d": d, "rp": None, "l": cell.get("l"), "_prov": self.solv_prov(cell, f"יעד הדירקטוריון, {BH[b]} · {self.name}", d,
                                   pct(cell["v"], 0 if float(cell["v"]).is_integer() else 1), "%"), "_period": dperiod(d)}, b, nxt if nxt and nxt["v"] != cell["v"] else None)
        # a target whose basis the wording leaves open (applied to both bases) is one figure: when the solvency report prints it for one
        # basis, the other basis takes the same printed figure (Menora: 116.9% at 31.12.25, not the 117.3% stated for 31.03.26)
        if "tg_wo" in S_row and "tgm_w" not in S_row and T.get(("board", "w"), (None, None))[1] == "?":
            t0, tb, nxt = T[("board", "wo")]
            T[("board", "w")] = (t0, "?", nxt)
        cons = []
        for (kind, b), (t, tb, nxt) in sorted(T.items()):
            if b not in B:
                continue
            cons.append({"id": f"{kind}_{b}", "kind": kind, "basis": b, "stated": tb if tb != "?" else None, "t": r6(t["v"]), "t_prov": t.get("_prov") or self.target_prov(t),
                         "period": t.get("_period") or (qname(t["rp"]) if t.get("rp") else t["d"]),
                         **({"later": {"t": r6(nxt["v"]), "d": nxt["d"], "period": qname(nxt["rp"]) if nxt.get("rp") else nxt["d"], "prov": self.target_prov(nxt)}} if nxt else {})})
        if not cons:
            for b in B:
                cons.append({"id": f"reg_{b}", "kind": "reg", "basis": b, "stated": b, "t": 100.0, "period": dperiod(d),
                             "t_prov": calc(f"דרישת ההון הרגולטורית · {self.name}", "100%", "יחס כושר פירעון מינימלי לפי משטר כושר הפירעון הכלכלי: 100% מה-SCR", [], unit="%", est=True,
                                            note="לא הודפס יעד דירקטוריון לחברת הביטוח עצמה; נמדד מול הדרישה הרגולטורית (הנחה)")})
        # dedupe the same basis and value (a board target that is also the dividend threshold): keep the board's
        seen, uniq = set(), []
        for c in sorted(cons, key=lambda c: (c["basis"], c["t"], {"board": 0, "div": 1, "reg": 2}[c["kind"]])):
            if (c["basis"], c["t"]) in seen:
                continue
            seen.add((c["basis"], c["t"]))
            uniq.append(c)
        cons = uniq
        KH = {"board": "יעד הדירקטוריון", "div": "סף לחלוקת דיבידנד", "reg": "דרישה רגולטורית"}
        for c in cons:
            b = B[c["basis"]]
            of, scr = b["of"]["v"], b["scr"]["v"]
            h = of - scr * c["t"] / 100
            c["he"] = f"{KH[c['kind']]}, {BH[c['basis']]}"
            c["headroom"] = fig(h, calc(f"עודף מעל {KH[c['kind']]} ({BH[c['basis']]}) · {self.name} · {dperiod(d)}", fm(h), "הון עצמי − SCR × יעד ÷ 100",
                                        [inp("הון עצמי", fm(of), ref(f"bases.{c['basis']}.of")), inp("SCR", fm(scr), ref(f"bases.{c['basis']}.scr")), inp(f"{KH[c['kind']]} · {c['period']}", pct(c["t"], 0 if float(c["t"]).is_integer() else 1), ref(f"con.{c['id']}.t"))],
                                        est=c["kind"] == "reg" or c["stated"] is None,
                                        note="בסיס היעד לא צוין בנוסח: מוחל על שני הבסיסים, המחמיר קובע" if c["stated"] is None else None))
            c["pp"] = r6(b["ratio"]["v"] - c["t"])
        bind = min(cons, key=lambda c: (c["headroom"]["v"], c["id"]))
        bb = B[bind["basis"]]
        # the buffer
        moves, pts = self.drift(bind["basis"], d)
        if len(moves) >= 2:
            pp = median(abs(m) for _, _, m in moves)
            bprov = calc(f"מרווח ניהולי · {self.name}", f"{fm(pp, 1)} נ״א", f"חציון |Δ יחס| בין שני תאריכי חישוב חצי-שנתיים עוקבים, {BH[bind['basis']]}, {BUFFER_YEARS} שנים אחרונות",
                         [inp(f"{dperiod(a)} ← {dperiod(z)}", f"{fs(mv, 1)} נ״א", calc(f"שינוי היחס {dperiod(a)} ← {dperiod(z)}", f"{fs(mv, 1)} נ״א", "יחס בסוף − יחס בתחילה",
                                                                                       [inp(dperiod(a), pct(pts[a][0], 1), pts[a][1]), inp(dperiod(z), pct(pts[z][0], 1), pts[z][1])], unit="נקודות אחוז"))
                          for a, z, mv in moves], unit="נקודות אחוז", est=True,
                         note="הנחה, ניתנת לשינוי: התנודה הרגילה של היחס בין שני תאריכי חישוב; תרחישי לחץ הם שכבת A2, לא המרווח")
            rule = "drift"
        else:
            pp = BUFFER_FALLBACK
            bprov = calc(f"מרווח ניהולי · {self.name}", f"{fm(pp, 1)} נ״א", "ברירת מחדל: פחות משני שינויים חצי-שנתיים מודפסים", [], unit="נקודות אחוז", est=True,
                         note="הנחה, ניתנת לשינוי")
            rule = "fallback"
        scr_b = bb["scr"]["v"]
        buf_v = scr_b * pp / 100
        buffer = {"pp": r6(pp), "v": r6(buf_v), "rule": rule, "n": len(moves), "basis": bind["basis"], "prov": bprov,
                  "v_prov": calc(f"מרווח ניהולי · {self.name}", fm(buf_v), "SCR × מרווח ÷ 100", [inp("SCR", fm(scr_b), ref(f"bases.{bind['basis']}.scr")), inp("מרווח (הנחה)", f"{fm(pp, 1)} נ״א", ref("buffer"))], est=True)}
        dist = bind["headroom"]["v"] - buf_v
        distributable = fig(dist, calc(f"הון בר-חלוקה · {self.name} · {dperiod(d)}", fm(dist), "הון עצמי − SCR × יעד − מרווח ניהולי (האילוץ המחייב)",
                                       [inp(f"עודף מעל {bind['he']}", fm(bind["headroom"]["v"]), ref(f"con.{bind['id']}.headroom")), inp("פחות: מרווח ניהולי (הנחה)", fm(buf_v), ref("buffer.v"))], est=True))
        # earnings, equity, ke (A1 nodes, valuation.ts constants)
        P = {k: fig(N[k]["v"], N[k]["prov"]) for k in ("net_profit", "equity", "equity_end", "roe", "ke", "pb") if k in N and N[k].get("v") is not None}
        P["tax"] = fig(A["tax"], N["tax"]["prov"]) if "tax" in N else fig(A["tax"], calc("שיעור מס (הנחה)", pct(A["tax"], 2), "valuation.ts ASSUME0.tax", [], unit="%", est=True))
        rf_in = next((x for x in N["ke"]["prov"].get("inputs", []) if "ריבית" in x["label"]), None) if "ke" in N else None
        P["rf"] = fig(A["rf"], rf_in["p"] if rf_in and rf_in.get("p") else calc("ריבית חסרת סיכון", pct(A["rf"], 2), "valuation.ts", [], unit="%"))
        periods = self.f["meta"]["base"]
        # dividends: LTM declared, the policy, the printed surplus for the cross-check
        qs = ["2025Q3", "2025FY", "2026Q1", "2026Q2"]
        dv = self.dividends(qs)
        ltm = None
        if all(dv):
            v = sum(x[0] for x in dv)
            ltm = fig(v, calc(f"דיבידנד שהוכרז, LTM · {self.name} · {periods['q']}", fm(v, 1), "סכום ארבעת הרבעונים, לבעלי המניות",
                              [inp(qname(p).replace("FY", "Q4"), fm(x[0], 1), x[1]) for p, x in zip(qs, dv)]))
        div = {"ltm": ltm, "policy": self.policy(), "printed_over": self.printed_over()}
        out = {**base, "status": "ok", "date": d, "period": dperiod(d), "bases": B, "constraints": cons, "binding": bind["id"], "buffer": buffer,
               "distributable": distributable, "pnl": P, "dividend": div}
        out["options"] = options(out, bolt)
        out["rank"] = rank(out)
        return out


# ---------------------------------------------------------------- the option set (web/src/lib/capital.ts recomputes it for a buffer override: same formulas)
def bolt_row(b):
    """the A9 bolt-on row from consolidation/bolt.json (None: the file is not built yet)"""
    if b is None:
        return {"id": "bolt", "status": "A9"}
    if b.get("status") != "ok":
        return {"id": "bolt", "status": "none", "why": b.get("why") or "אין יעד"}
    row = {"id": "bolt", "status": "ok", "tgt": b["t"], "tgt_name": b["name"], "pair": b["pair"], "rank_a9": b["rank"], "premium": b["premium"], "cap": b["price"]}
    for k in ("roic", "solv", "solv_gw", "roe", "eps", "npv", "metric"):
        if k in b:
            row[k] = b[k]
    row["src"] = b["src"]
    return row


def options(c, bolt=None):
    """the four rows at the file's buffer; the TS library reproduces them (tests/capital.unit.ts) and recomputes them for an override.
    The bolt-on (A9) is computed by pipeline/build_consolidation.py at the file's buffer and carried as is."""
    bind = next(x for x in c["constraints"] if x["id"] == c["binding"])
    B = c["bases"]
    P = c["pnl"]
    np_, E, roe, ke, rf, tax = (P[k]["v"] if k in P else None for k in ("net_profit", "equity", "roe", "ke", "rf", "tax"))
    Ee, pb = (P[k]["v"] if k in P else None for k in ("equity_end", "pb"))
    pp = c["buffer"]["pp"]
    D = c["distributable"]["v"]
    X = max(D, 0.0)
    keep = 1 - tax / 100
    lost = X * rf / 100 * keep                    # the investment income the distributed capital no longer earns (after tax)
    scr_b, of_b, r_b = B[bind["basis"]]["scr"]["v"], B[bind["basis"]]["of"]["v"], B[bind["basis"]]["ratio"]["v"]
    name = c["name"]
    dprov = ref("distributable")
    rows = []
    # dividend / buyback
    cost = X / scr_b * 100
    roe1 = (np_ - lost) / (E - X) * 100 if E and E > X else None
    eps_div = -lost / np_ * 100 if np_ else None
    sh = X / (pb * Ee) if pb and Ee else None
    eps_bb = ((1 - lost / np_) / (1 - sh) - 1) * 100 if sh is not None and sh < 1 and np_ else None
    rows.append({"id": "div", "cap": fig(X, dprov), "roic": fig(ke, ref("pnl.ke")),
                 "solv": fig(-cost, calc(f"עלות כושר פירעון · דיבידנד / רכישה עצמית · {name}", f"{fs(-cost, 1)} נ״א", "− הון שמחולק ÷ SCR × 100 (SCR קבוע)",
                                         [inp("הון שמחולק", fm(X), dprov), inp(f"SCR, {BH[bind['basis']]}", fm(scr_b), ref(f"bases.{bind['basis']}.scr"))], unit="נקודות אחוז")),
                 "per_bn": r6(-1000 / scr_b * 100),
                 "roe": fig(None if roe1 is None else roe1 - roe, calc(f"השפעה על ROE · דיבידנד / רכישה עצמית · {name}", "–" if roe1 is None else f"{fs(roe1 - roe, 1)} נ״א",
                                                                      "(רווח נקי − הון × rf × (1 − מס)) ÷ (הון ממוצע − הון) − ROE",
                                                                      [inp("רווח נקי LTM", fm(np_, 1), ref("pnl.net_profit")), inp("הון ממוצע", fm(E, 1), ref("pnl.equity")), inp("הון שמחולק", fm(X), dprov),
                                                                       inp("rf (תשואה שהון עודף מניב, הנחה)", pct(rf, 2), ref("pnl.rf")), inp("מס (הנחה)", pct(tax, 2), ref("pnl.tax")),
                                                                       inp("ROE LTM", pct(roe, 1), ref("pnl.roe"))], unit="נקודות אחוז", est=True)),
                 "eps": fig(eps_div, calc(f"השפעה על הרווח למניה · דיבידנד · {name}", "–" if eps_div is None else f"{fs(eps_div, 1)}%", "− הון × rf × (1 − מס) ÷ רווח נקי LTM (מספר המניות לא משתנה)",
                                          [inp("הון שמחולק", fm(X), dprov), inp("rf (הנחה)", pct(rf, 2), ref("pnl.rf")), inp("רווח נקי LTM", fm(np_, 1), ref("pnl.net_profit"))], unit="%", est=True)),
                 "eps_bb": fig(eps_bb, calc(f"השפעה על הרווח למניה · רכישה עצמית ב-P/B מוצדק · {name}", "–" if eps_bb is None else f"{fs(eps_bb, 1)}%",
                                            "(1 − הון × rf × (1 − מס) ÷ רווח) ÷ (1 − הון ÷ (P/B × הון עצמי)) − 1",
                                            [inp("הון לרכישה", fm(X), dprov), inp("P/B מוצדק (A1, קלט הערכה, לא מחיר שוק)", f"{fm(pb, 2)}x" if pb else "–", ref("pnl.pb") if "pb" in P else None),
                                             inp("הון לבעלי המניות", fm(Ee, 1), ref("pnl.equity_end") if "equity_end" in P else None)] , unit="%", est=True,
                                            note="קלט הערכה בלבד: הרכישה במחיר שוק משנה את התוצאה; מחיר השוק אינו חלק מהמודול"))})
    # organic growth: each NIS of capital written to the target supports SCR of 1 ÷ target; own funds unchanged
    Tt, Bf = bind["t"] / 100, pp / 100
    Xo = max(min(x["t"] / 100 * (B[x["basis"]]["of"]["v"] / (x["t"] / 100 + Bf) - B[x["basis"]]["scr"]["v"]) for x in c["constraints"]), 0.0)
    r_after = of_b / (scr_b + Xo / Tt) * 100
    cost_o = r_b - r_after
    per_o = r_b - of_b / (scr_b + 1000 / Tt) * 100
    extra = Xo * (roe / 100 - rf / 100 * keep)
    oprov = calc(f"קיבולת לצמיחה אורגנית · {name}", fm(Xo), "min על האילוצים: יעד × (הון עצמי ÷ (יעד + מרווח) − SCR); הון שנכתב ליעד מחזיק SCR של הון ÷ יעד",
                 [inp(f"{x['he']}", f"{fm(x['t'] / 100 * (B[x['basis']]['of']['v'] / (x['t'] / 100 + Bf) - B[x['basis']]['scr']['v']))}", ref(f"con.{x['id']}.headroom")) for x in c["constraints"]]
                 + [inp("מרווח ניהולי (הנחה)", f"{fm(pp, 1)} נ״א", ref("buffer"))], est=True)
    rows.append({"id": "org", "cap": fig(Xo, oprov),
                 "roic": fig(roe, calc(f"תשואה על הון לצמיחה · {name}", pct(roe, 1), "אומדן: ההון שנשאר בעסק מניב את ה-ROE של LTM (שולי = ממוצע)",
                                       [inp("ROE LTM", pct(roe, 1), ref("pnl.roe"))], unit="%", est=True,
                                       note="הדוחות לא מפרסמים את צריכת ההון של עסק חדש; ה-ROE הממוצע משמש כאומדן לתשואה השולית")),
                 "solv": fig(-cost_o, calc(f"עלות כושר פירעון · צמיחה אורגנית · {name}", f"{fs(-cost_o, 1)} נ״א", "יחס אחרי − יחס לפני; יחס אחרי = הון עצמי ÷ (SCR + הון ÷ יעד)",
                                           [inp("הון עצמי", fm(of_b), ref(f"bases.{bind['basis']}.of")), inp("SCR", fm(scr_b), ref(f"bases.{bind['basis']}.scr")), inp("הון לצמיחה", fm(Xo), oprov),
                                            inp(bind["he"], pct(bind["t"], 0 if float(bind["t"]).is_integer() else 1), ref(f"con.{bind['id']}.t"))], unit="נקודות אחוז", est=True)),
                 "per_bn": r6(-per_o),
                 "roe": fig(extra / E * 100 if E else None, calc(f"השפעה על ROE · צמיחה אורגנית · {name}", f"{fs(extra / E * 100, 1)} נ״א" if E else "–",
                                                                 "הון × (ROE − rf × (1 − מס)) ÷ הון ממוצע",
                                                                 [inp("הון לצמיחה", fm(Xo), oprov), inp("ROE LTM", pct(roe, 1), ref("pnl.roe")), inp("rf (הנחה)", pct(rf, 2), ref("pnl.rf")),
                                                                  inp("הון ממוצע", fm(E, 1), ref("pnl.equity"))], unit="נקודות אחוז", est=True)),
                 "eps": fig(extra / np_ * 100 if np_ else None, calc(f"השפעה על הרווח למניה · צמיחה אורגנית · {name}", f"{fs(extra / np_ * 100, 1)}%" if np_ else "–",
                                                                     "הון × (ROE − rf × (1 − מס)) ÷ רווח נקי LTM",
                                                                     [inp("הון לצמיחה", fm(Xo), oprov), inp("ROE LTM", pct(roe, 1), ref("pnl.roe")), inp("rf (הנחה)", pct(rf, 2), ref("pnl.rf")),
                                                                      inp("רווח נקי LTM", fm(np_, 1), ref("pnl.net_profit"))], unit="%", est=True))})
    rows.append(bolt_row(bolt))
    rows.append({"id": "hold", "status": "A2"})
    return rows


def rank(c):
    """the options by ROIC − ke per NIS deployed (dividend / buyback = 0 by construction); the bolt-on (A9) when a target is affordable; the
    hold row is not ranked"""
    ke = c["pnl"]["ke"]["v"]
    rs = [(o["roic"]["v"] - ke, o["id"]) for o in c["options"] if "roic" in o and o["roic"]["v"] is not None and o["cap"]["v"] > 0]
    return [i for _, i in sorted(rs, key=lambda x: (-x[0], x[1]))]

# ---------------------------------------------------------------- W10 · the latest solvency report, its walk, and forward dividend capacity: capital/forward.json
FWD_OUT = WEB / "capital" / "forward.json"
CAPX = ROOT / "data" / "extracted_capital"
STEP_HE = {"open": "פתיחה", "neutralise": "נטרול הוראות המעבר", "open_wo": "פתיחה ללא הוראות מעבר", "operating": "פעילות תפעולית", "economic": "פעילות כלכלית (שוק)",
           "new_business": "עסקים חדשים", "capital_actions": "פעולות הוניות ודיבידנד", "tax_tiers": "מס נדחה, רובד 1 נוסף ורובד 2",
           "close_wo": "סגירה ללא הוראות מעבר", "transitional": "השפעת הוראות המעבר", "close": "סגירה"}


def solv_cell(I, c, cell, title, d, value, unit=MM):
    S = I.S
    r = S["reports"].get(str(cell["r"]), {})
    attached = r.get("as_of") and r.get("pub") and r["as_of"] < r["pub"][:4] + "-01-01" and "rpdf" in (r.get("f") or "")
    doc = f"{r.get('e') or 'חברת הביטוח'}, דוח כושר פירעון כלכלי ליום {dlab(r.get('as_of', d))}"
    return rep(title, value, S["files"] + r["f"] if r.get("f") else None, cell.get("pg"), doc, dperiod(d), note=cell.get("l"), unit=unit,
               src="דוח כושר פירעון כלכלי (MAYA)" + (", מצורף לדוח הרבעוני" if attached else ""))


def cap_facts(c):
    p = CAPX / c / "2026Q2.json"
    return json.loads(p.read_text(encoding="utf8")) if p.exists() else None


def forward_co(I, c, files):
    S = I.S
    name = I.reg[c]["name_he"] if c in I.reg else c
    L = S.get("latest", {}).get(c)
    if not L:
        return {"id": c, "name": name, "status": "na", "why": "אין דוח כושר פירעון במאגר"}
    d = L["d"]
    row = S["companies"][c][d]
    rep_meta = S["reports"].get(str(L["r"]), {})
    out = {"id": c, "name": name, "status": "ok", "date": d, "period": dperiod(d), "pub": L["pub"], "rid": L["r"],
           "doc": rep_meta.get("e"), "url": S["files"] + rep_meta["f"] if rep_meta.get("f") else None}
    pc = lambda k, title, unit=MM, dd=None: solv_cell(I, c, row[k], title, d, pct(row[k]["v"], 0 if float(row[k]["v"]).is_integer() else 1) if unit == "%" else fm(row[k]["v"]), unit)
    # the printed lines of the report
    P = {}
    for b in ("w", "wo"):
        for k, he, unit in (("sr", "יחס כושר פירעון", "%"), ("of", "הון עצמי לעניין SCR", MM), ("scr", "SCR", MM), ("su", "עודף הון", MM),
                            ("sra", "יחס לאחר פעולות הוניות עד הפרסום", "%"), ("ofa", "הון עצמי לאחר פעולות הוניות עד הפרסום", MM)):
            key = f"{k}_{b}"
            if key in row:
                P[key] = fig(row[key]["v"], pc(key, f"{he}, {BH[b]} · {name} · {dperiod(d)}", unit))
    for k, he in (("t1b", "רובד 1 בסיסי"), ("t1r", "רובד 1 נוסף"), ("t2", "רובד 2"), ("m_market", "SCR שוק"), ("m_life", "SCR חיתום חיים"), ("m_health", "SCR חיתום בריאות"),
                  ("m_nonlife", "SCR חיתום כללי"), ("m_counterparty", "SCR צד נגדי"), ("m_div", "פיזור"), ("bscr", "BSCR"), ("m_operational", "SCR תפעולי"), ("m_lac_dt", "התאמה למס נדחה"),
                  ("m_managers", "SCR חברות מנהלות"), ("tdt", "ניכוי בתקופת הפריסה")):
        if k in row:
            P[k] = fig(row[k]["v"], pc(k, f"{he} · {name} · {dperiod(d)}"))
    out["lines"] = P
    # the walk, as printed
    W = []
    for r in S.get("walks", {}).get(c, {}).get(d, []):
        cell = {"r": r["r"], "pg": r["pg"], "l": r["l"]}
        W.append({"step": r["step"], "he": STEP_HE[r["step"]], "l": r["l"],
                  **{k: fig(r[k], solv_cell(I, c, cell, f"{STEP_HE[r['step']]} · {('הון עצמי', 'SCR', 'עודף')[i]} · {name} · 2025", d, fm(r[k])))
                     for i, k in enumerate(("of", "scr", "su")) if r.get(k) is not None}})
    out["walk"] = W
    if W:   # the ratio walk: each disclosed step's effect on the ratio without transitional measures, in the order printed (each step's ratio after it)
        o, z = next(x for x in W if x["step"] == "open_wo"), next(x for x in W if x["step"] == "close_wo")
        of, scr = o["of"]["v"], o["scr"]["v"]
        rw, prev = [], of / scr * 100
        for x in W:
            if x["step"] not in ("operating", "economic", "new_business", "capital_actions", "tax_tiers"):
                continue
            of, scr = of + x["of"]["v"], scr + x["scr"]["v"]
            r1 = of / scr * 100
            rw.append({"step": x["step"], "pp": r6(r1 - prev), "prov": calc(f"{x['he']} → יחס ללא הוראות מעבר · {name} · 2025", f"{fs(r1 - prev, 1)} נ״א",
                                                                          "יחס אחרי הצעד − יחס לפניו; יחס = הון עצמי ÷ SCR (מצטבר בסדר ההדפסה)",
                                                                          [inp("הון עצמי, שינוי", fm(x["of"]["v"]), x["of"]["prov"]), inp("SCR, שינוי", fm(x["scr"]["v"]), x["scr"]["prov"])],
                                                                          unit="נקודות אחוז", note="סדר הצעדים כפי שהודפס; לסדר השפעה על הפירוק (הממונה קבע את סדר ההצגה)")})
            prev = r1
        out["ratio_walk"] = {"open": r6(o["of"]["v"] / o["scr"]["v"] * 100), "close": r6(z["of"]["v"] / z["scr"]["v"] * 100), "steps": rw,
                             "check": r6(abs(prev - z["of"]["v"] / z["scr"]["v"] * 100))}
    # sensitivities of the latest report
    out["sens"] = [{"l": x["l"], "risk": x["risk"], "b": x["b"], "v": x["v"],
                    "prov": solv_cell(I, c, x, f"{x['l']} · {name} · {dperiod(d)}", d, f"{fs(x['v'], 1)} נ״א", "נקודות אחוז")}
                   for x in S["sens"] if x["c"] == c and x["d"] == d]
    # constraints on a distribution
    cons = []
    tg = lambda k: row.get(k)
    if "of_wo" in row and "scr_wo" in row and "rdf_wo" in row:
        cons.append({"id": "reg_wo", "basis": "wo", "kind": "reg", "t": r6(row["rdf_wo"]["v"]), "t_prov": pc("rdf_wo", f"סף רגולטורי לחלוקה, ללא הוראות מעבר · {name}", "%")})
        if tg("tg_wo"):
            cons.append({"id": "board_wo", "basis": "wo", "kind": "board", "t": r6(tg("tg_wo")["v"]), "t_prov": pc("tg_wo", f"יעד הדירקטוריון ללא הוראות מעבר · {name}", "%")})
    if tg("tgm_w") and "of_w" in row:
        cons.append({"id": "board_w", "basis": "w", "kind": "board_min", "t": r6(tg("tgm_w")["v"]), "t_prov": pc("tgm_w", f"יעד מינימלי עם הוראות מעבר · {name}", "%")})
    # deductions after publication
    X = cap_facts(c)
    ded = []
    if X:
        u = files.get(X["report_id"])
        for x in X["facts"]:
            kind = "div" if x["metric"] == "insurer_dividend_after_solvency_report" else "pending"
            ded.append({"kind": kind, "v": r6(x["value"]), "d": x["date"], "prov": rep(("דיבידנד של חברת הביטוח לאחר פרסום דוח כושר הפירעון" if kind == "div" else "חלוקה בעין שאושרה וטרם בוצעה")
                                                                            + f" · {name}", fm(x["value"]), u, x["page_he"], "דוח כספי Q2'26", "Q2'26", note=x["label"][:240])})
    out["deducted_in_report"] = [{"v": x["v"], "dd": x["dd"], "l": x["l"], "prov": solv_cell(I, c, x, f"חלוקה שכבר נוכתה בדוח · {name}", d, fm(x["v"]))}
                                 for x in S.get("deducted", []) if x["c"] == c and x["d"] == d]
    D = math.fsum(x["v"] for x in ded)
    D_prov = {"k": "none", "title": f"חלוקות לאחר פרסום הדוח · {name}",
              "why": (X or {}).get("not_found", [{}])[0].get("why", "לא נמצאו") if X else "אין קובץ אירועים לאחר הפרסום"} if not ded else calc(f"חלוקות לאחר פרסום הדוח · {name}", fm(D), "סכום הדיבידנדים שחברת הביטוח הכריזה אחרי פרסום דוח כושר הפירעון (ושחלוקות שאושרו וטרם בוצעו)",
                  [inp(f"{'דיבידנד' if x['kind'] == 'div' else 'חלוקה בעין תלויה'} · {x['d']}", fm(x["v"]), x["prov"]) for x in ded], est=any(x["kind"] == "pending" for x in ded),
                  note=("כולל חלוקה בעין שאושרה בדצמבר 2024 וטרם בוצעה (בית הורד), שהחברה בוחנת מחדש: הנחה שמרנית" if any(x["kind"] == "pending" for x in ded) else None))
    out["after"] = {"v": r6(D), "items": ded, "prov": D_prov}
    # capacity per constraint
    rows = []
    for k in cons:
        b = k["basis"]
        use_a = f"ofa_{b}" in P
        of = P[f"ofa_{b}" if use_a else f"of_{b}"]
        scr = P[f"scr_{b}"]
        head = of["v"] - scr["v"] * k["t"] / 100
        rem = head - D
        k2 = dict(k)
        k2["he"] = {"reg": "סף רגולטורי 100%", "board": "יעד הדירקטוריון", "board_min": "יעד מינימלי של הדירקטוריון"}[k["kind"]] + f", {BH[b]}"
        k2["of_after_actions"] = use_a
        k2["head"] = fig(head, calc(f"עודף מעל {k2['he']} · {name} · {dperiod(d)}", fm(head), "הון עצמי" + (" (לאחר פעולות הוניות עד הפרסום)" if use_a else "") + " − SCR × סף ÷ 100",
                                    [inp("הון עצמי", fm(of["v"]), of["prov"]), inp("SCR", fm(scr["v"]), scr["prov"]), inp("סף", pct(k["t"], 1), k["t_prov"])]))
        k2["rem"] = fig(rem, calc(f"קיבולת חלוקה שנותרה · {k2['he']} · {name}", fm(rem), "עודף מעל הסף − חלוקות לאחר פרסום הדוח",
                                  [inp("עודף מעל הסף", fm(head), k2["head"]["prov"]), inp("פחות: חלוקות לאחר הפרסום", fm(D), D_prov)], est=True,
                                  note="אומדן: אין יחס כושר פירעון מאוחר יותר מ-31.12.2025; הרווח, התנועה בשוק ו-SCR מאז לא נכללו"))
        k2["pp"] = fig(rem / scr["v"] * 100, calc(f"קיבולת שנותרה בנקודות יחס · {k2['he']} · {name}", f"{fm(rem / scr['v'] * 100, 1)} נ״א", "קיבולת ÷ SCR × 100 (SCR קבוע)",
                                                  [inp("קיבולת", fm(rem), k2["rem"]["prov"]), inp("SCR", fm(scr["v"]), scr["prov"])], unit="נקודות אחוז", est=True))
        rows.append(k2)
    if not rows:
        out["status"] = "partial"
        out["why"] = "לא הודפסו הון עצמי ו-SCR ללא הוראות מעבר"
        return out
    out["constraints"] = rows
    bind = min(rows, key=lambda k: (k["rem"]["v"], k["id"]))
    out["binding"] = bind["id"]
    # sensitivity: the company's own disclosed shocks, as own-funds equivalents on the with-transitional SCR, applied in NIS to every constraint
    scr_w = P.get("scr_w", P.get("scr_wo"))
    sens_rows = []
    for x in out["sens"]:
        dOF = x["v"] / 100 * scr_w["v"]
        after = {k["id"]: r6(k["rem"]["v"] + dOF) for k in rows}
        bid = min(after, key=lambda i: (after[i], i))
        sens_rows.append({"l": x["l"], "risk": x["risk"], "dv": r6(dOF), "after": after, "bind": bid,
                          "prov": calc(f"{x['l']} → קיבולת · {name}", fm(after[bid]), "קיבולת המחייבת + זעזוע (נ״א) × SCR עם הוראות מעבר ÷ 100; אותו סכום בש״ח על כל האילוצים",
                                       [inp("רגישות כפי שגולתה", f"{fs(x['v'], 1)} נ״א", x["prov"]), inp("SCR עם הוראות מעבר", fm(scr_w["v"]), scr_w["prov"]),
                                        inp("קיבולת לפני הזעזוע", fm(next(k for k in rows if k["id"] == bid)["rem"]["v"]), next(k for k in rows if k["id"] == bid)["rem"]["prov"])],
                                       est=True, note="אומדן: הרגישות גולתה על היחס המדווח; התרגום לש״ח מניח SCR קבוע ואותה תזוזה בהון העצמי בשני הבסיסים (הניכוי בתקופת הפריסה קבוע)")})
    out["sens_capacity"] = sens_rows
    return out


def forward(I=None):
    I = I or Inputs()
    files = {}
    import csv
    with open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["file_type"].startswith("pdf"):
                files.setdefault(int(r["report_id"]), I.S["files"] + r["url"])
    cos = [forward_co(I, c, files) for c in ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"]]
    return {"meta": {"v": 1, "built": max((c.get("pub") or "" for c in cos), default=""),
                     "formula": "קיבולת חלוקה = הון עצמי (לאחר פעולות הוניות עד פרסום הדוח) − SCR × סף − חלוקות שהוכרזו אחרי פרסום הדוח; לכל סף (רגולטורי 100% ללא הוראות מעבר, יעד הדירקטוריון ללא הוראות מעבר, יעד מינימלי עם הוראות מעבר); המחמיר מחייב",
                     "inputs": ["csm/solvency.json", "data/extracted_capital/<co>/2026Q2.json"]}, "companies": cos}


def verify_forward(d):
    bad, n = [], 0
    for c in d["companies"]:
        if c["status"] != "ok":
            if not c.get("why"):
                bad.append(("not computed without a reason", c["id"]))
            continue
        w = c["id"]
        for k, x in c["lines"].items():
            walk(x["prov"], f"{w}.{k}", bad)
        for k in c["constraints"]:
            n += 1
            b = k["basis"]
            of = c["lines"][f"ofa_{b}" if k["of_after_actions"] else f"of_{b}"]["v"]
            scr = c["lines"][f"scr_{b}"]["v"]
            if abs(of - scr * k["t"] / 100 - k["head"]["v"]) > ID_TOL or abs(k["head"]["v"] - c["after"]["v"] - k["rem"]["v"]) > ID_TOL:
                bad.append(("identity: capacity", w, k["id"]))
            for p in (k["head"]["prov"], k["rem"]["prov"], k["pp"]["prov"], k["t_prov"]):
                walk(p, f"{w}.{k['id']}", bad)
        if any(k["rem"]["v"] < next(x for x in c["constraints"] if x["id"] == c["binding"])["rem"]["v"] - 1e-9 for k in c["constraints"]):
            bad.append(("binding is not the lowest", w))
        if "ratio_walk" in c and c["ratio_walk"]["check"] > 0.05:
            bad.append(("ratio walk does not reach the closing ratio", w, c["ratio_walk"]["check"]))
        for x in c.get("walk", []):
            for k in ("of", "scr", "su"):
                if k in x:
                    walk(x[k]["prov"], f"{w}.walk.{x['step']}.{k}", bad)
        for x in c["sens"]:
            walk(x["prov"], f"{w}.sens", bad)
        for x in c.get("sens_capacity", []):
            walk(x["prov"], f"{w}.sens_capacity", bad)
        walk(c["after"]["prov"], f"{w}.after", bad)
    return bad, n


FUND_WHY = "הון עצמי של חברה מנהלת מול דרישת ההון המינימלית לא חולץ מהדוחות; אין חישוב הון בר-חלוקה"


def bolts():
    if not BOLT.exists():
        return {}
    return json.loads(BOLT.read_text(encoding="utf8")).get("bolt", {})


def build():
    I = Inputs()
    BB = bolts()
    built = max((f["meta"]["built"] for f in I.drv.values()), default=dt.date.today().isoformat())
    base = next(iter(I.drv.values()))["meta"]["base"] if I.drv else {}
    cos = []
    for cid, r in I.reg.items():
        if r.get("kind") == "insurance_group":
            cos.append(Co(I, cid).build(BB.get(cid)))
        else:
            cos.append({"id": cid, "name": r["name_he"], "kind": r.get("kind", "fund_house"), "status": "na", "why": FUND_WHY})
    order = {c: i for i, c in enumerate(INSURERS)}
    cos.sort(key=lambda c: (c["kind"] != "insurance_group", order.get(c["id"], 99), c["id"]))
    return {"meta": {"built": built, "base": base, "v": 1,
                     "formula": "הון בר-חלוקה = הון עצמי − SCR × יעד − מרווח ניהולי (לכל בסיס; המחמיר מחייב)",
                     "buffer_rule": f"חציון |Δ יחס| בין תאריכי חישוב חצי-שנתיים עוקבים, {BUFFER_YEARS} שנים, בסיס האילוץ המחייב; ברירת מחדל {fm(BUFFER_FALLBACK, 0)} נ״א",
                     "stress": "שכבת A2 מחושבת בעמוד: התרחישים של /scenarios דרך drivers.ts propagate; SCR קבוע (כלל A1)",
                     "inputs": ["csm/solvency.json", "csm/facts/<co>.json", "csm/capital.json", "drivers/<co>.json"]},
            "companies": cos}


# ---------------------------------------------------------------- verification
def resolve(c, path):
    """the provenance a ref points at (the same rule as web/src/lib/capital.ts resolveRef)"""
    a = path.split(".")
    try:
        if a[0] == "distributable":
            return c["distributable"]["prov"]
        if a[0] == "buffer":
            return c["buffer"]["v_prov"] if a[1:] == ["v"] else c["buffer"]["prov"]
        if a[0] == "pnl":
            return c["pnl"][a[1]]["prov"]
        if a[0] == "bases":
            return c["bases"][a[1]][a[2]]["prov"]
        if a[0] == "bolt":
            row = next(o for o in c["options"] if o["id"] == "bolt")
            return row["src"][path[5:]]
        if a[0] == "con":
            k = next(x for x in c["constraints"] if x["id"] == a[1])
            return k["t_prov"] if a[2] == "t" else k["headroom"]["prov"]
    except (KeyError, IndexError, StopIteration):
        return None
    return None


def walk(p, where, bad, depth=0, c=None):
    if depth > 80:
        return
    if not isinstance(p, dict) or "k" not in p:
        bad.append(("no provenance", where))
        return
    if p["k"] == "ref":
        q = resolve(c, p["r"]) if c else None
        if q is None:
            bad.append(("ref does not resolve", where, p["r"]))
        else:
            walk(q, where + " > " + p["r"], bad, depth + 1, c)
        return
    if p["k"] == "report":
        if not p.get("url"):
            bad.append(("report without a url", where, p.get("title")))
        if p.get("pg") is None and "בנק ישראל" not in (p.get("doc") or "") and "ת126" not in (p.get("doc") or ""):   # ת126 is an htm form: no pages
            bad.append(("report without a page", where, p.get("title")))
    elif p["k"] == "calc":
        if not p.get("inputs") and not p.get("est"):
            bad.append(("calc without inputs, not an assumption", where, p.get("title")))
        for x in p.get("inputs", []):
            if "p" in x and x["p"] is not None:
                walk(x["p"], where + " > " + x["label"][:30], bad, depth + 1, c)
    elif p["k"] not in ("lts", "none", "xbrl", "reg", "fund", "price"):   # reg / fund: the regulator's files; price: the A9 AUM floor (TASE market value)
        bad.append(("unknown provenance kind", where, p["k"]))


def finite(x, where, bad):
    if isinstance(x, float) and not math.isfinite(x):
        bad.append(("NaN / inf", where))
    elif isinstance(x, dict):
        for k, v in x.items():
            finite(v, f"{where}.{k}", bad)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            finite(v, f"{where}[{i}]", bad)


def verify(d, BB=None):
    bad, n_id = [], 0
    BB = bolts() if BB is None else BB
    finite(d, "options", bad)
    for c in d["companies"]:
        if c["status"] != "ok":
            if not c.get("why"):
                bad.append(("not computed without a reason", c["id"]))
            continue
        w = c["id"]
        for b, x in c["bases"].items():
            for k in ("of", "scr", "ratio"):
                walk(x[k]["prov"], f"{w}.{b}.{k}", bad, 0, c)
            if x["printed"] is not None and abs(x["ratio"]["v"] - x["printed"]) > RATIO_TOL:
                bad.append(("own funds ÷ SCR ≠ printed ratio", w, b, round(x["ratio"]["v"], 2), x["printed"]))
            n_id += 1
        for k in c["constraints"]:
            x = c["bases"][k["basis"]]
            h = x["of"]["v"] - x["scr"]["v"] * k["t"] / 100
            n_id += 1
            if abs(h - k["headroom"]["v"]) > ID_TOL:
                bad.append(("identity: headroom ≠ own funds − SCR × target", w, k["id"], h, k["headroom"]["v"]))
            walk(k["headroom"]["prov"], f"{w}.{k['id']}", bad, 0, c)
            walk(k["t_prov"], f"{w}.{k['id']}.target", bad, 0, c)
        bind = next(k for k in c["constraints"] if k["id"] == c["binding"])
        if any(k["headroom"]["v"] < bind["headroom"]["v"] - 1e-9 for k in c["constraints"]):
            bad.append(("the binding constraint is not the lowest", w))
        bb = c["bases"][bind["basis"]]
        buf = bb["scr"]["v"] * c["buffer"]["pp"] / 100
        n_id += 2
        if abs(buf - c["buffer"]["v"]) > ID_TOL:
            bad.append(("identity: buffer ≠ SCR × pp", w, buf, c["buffer"]["v"]))
        dist = bb["of"]["v"] - bb["scr"]["v"] * bind["t"] / 100 - c["buffer"]["v"]
        if abs(dist - c["distributable"]["v"]) > ID_TOL:
            bad.append(("identity: distributable ≠ own funds − SCR × target − buffer", w, dist, c["distributable"]["v"]))
        walk(c["distributable"]["prov"], f"{w}.distributable", bad, 0, c)
        walk(c["buffer"]["prov"], f"{w}.buffer", bad, 0, c)
        for k, x in c["pnl"].items():
            walk(x["prov"], f"{w}.pnl.{k}", bad, 0, c)
        if c["dividend"]["ltm"]:
            walk(c["dividend"]["ltm"]["prov"], f"{w}.dividend", bad, 0, c)
        for o in c["options"]:
            for k in ("cap", "roic", "solv", "solv_gw", "roe", "eps", "eps_bb", "npv", "metric"):
                if k in o:
                    if o[k]["v"] is not None:
                        walk(o[k]["prov"], f"{w}.{o['id']}.{k}", bad, 0, c)
        if options(c, BB.get(c["id"])) != c["options"]:
            bad.append(("option rows do not re-derive", w))
        div = next(o for o in c["options"] if o["id"] == "div")
        if abs(div["cap"]["v"] - max(c["distributable"]["v"], 0)) > 1e-6:
            bad.append(("dividend capacity ≠ distributable", w))
    return bad, n_id


def dumps(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    d = build()
    bad, n_id = verify(d)
    F = forward()
    fbad, fn = verify_forward(F)
    ok = [c for c in d["companies"] if c["status"] == "ok"]
    if "--check" in sys.argv:
        same = OUT.exists() and json.loads(OUT.read_text(encoding="utf8")) == json.loads(dumps(d))
        fsame = FWD_OUT.exists() and json.loads(FWD_OUT.read_text(encoding="utf8")) == json.loads(dumps(F))
        print(f"capital: {len(ok)} insurers computed, {len(d['companies']) - len(ok)} marked not available; {n_id} identities; "
              f"{'rebuild matches' if same else 'DIFFERS from capital/options.json'}; {len(bad)} misses; "
              f"forward: {fn} capacity identities, {'rebuild matches' if fsame else 'DIFFERS from capital/forward.json'}, {len(fbad)} misses")
        for b in (bad + fbad)[:20]:
            print("  ", b)
        sys.exit(0 if same and fsame and not bad and not fbad else 1)
    if bad or fbad:
        print("misses:")
        for b in (bad + fbad)[:40]:
            print("  ", b)
        sys.exit(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dumps(d), encoding="utf8")
    FWD_OUT.write_text(dumps(F), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes; {len(ok)} insurers, {n_id} identities")
    print(f"wrote {FWD_OUT.relative_to(ROOT)}: {FWD_OUT.stat().st_size:,} bytes; {fn} capacity identities")
    for c in ok:
        b = next(k for k in c["constraints"] if k["id"] == c["binding"])
        print(f"  {c['id']:10s} {c['period']}  binding {b['id']:9s} {b['t']:6.1f}%  headroom {b['headroom']['v']:9,.1f}  buffer {c['buffer']['pp']:4.1f}pp {c['buffer']['v']:7,.1f}"
              f"  distributable {c['distributable']['v']:9,.1f}  rank {c['rank']}")
    for c in F["companies"]:
        if c["status"] == "ok":
            b = next(k for k in c["constraints"] if k["id"] == c["binding"])
            print(f"  fwd {c['id']:10s} {c['period']} binding {b['id']:8s} {b['t']:6.1f}%  head {b['head']['v']:8,.0f}  after-pub {c['after']['v']:6,.0f}  remaining {b['rem']['v']:8,.0f} = {b['pp']['v']:5.1f}pp")
