"""A7 · Capital & Strategic Options: per insurer, the surplus capital, the option set over it and its ranking.

    Distributable capital = own funds − SCR × board target − management buffer          (each printed basis; the binding one is the lower)

    Options                    Capacity   ROIC                     Solvency cost                  Accretion
      Dividend / buyback        ₪m         ke (valuation.ts)        capital ÷ SCR, pp              ROE and EPS effect
      Organic growth capital    ₪m         LTM ROE (labelled est)   OF ÷ (SCR + capital ÷ target)   EPS effect of the return over rf
      Bolt-on                   A9, not computed here
      Hold against stress       on the page: the A2 presets through web/src/lib/drivers.ts propagate (web/src/lib/capital.ts)

Inputs (all built and gated already; nothing is extracted here)
  web/public/data/csm/solvency.json    the separate economic-solvency reports: own funds, SCR, ratio and surplus with / without transitional
  web/public/data/csm/facts/<co>.json  the same lines as the financial statements print them, the dividend lines and the payout policy
  web/public/data/csm/capital.json     the ratio series (with / without transitional) for the buffer's drift
  web/public/data/drivers/<co>.json    A1: board targets as printed (with page), LTM net profit, equity, ROE, ke, rf, tax, justified P/B
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
        for kind, b, t in rows:
            if b == "?" and kind in stated:
                continue   # the company states the basis of this target elsewhere: an unstated restatement is the same target
            rp = t.get("rp") or ""
            key = (rp_end(rp) if rp else t["d"], 0 if rp.endswith("FY") else 1, t["d"])
            for bb in (["w", "wo"] if b == "?" else [b]):
                cur = out.get((kind, bb))
                if cur is None or key > cur[0]:
                    out[(kind, bb)] = (key, t, b)
        return {k: (t, b) for k, (_, t, b) in out.items()}

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
        """the surplus over the target the company prints itself (newest date), for the cross-check line"""
        xs = [x for x in self.F if re.match(r"^(solvency_surplus_(over_target|vs_board_target|vs_target)|surplus_vs_(board_)?target|target_excess_capital|target_solvency_surplus_vs_board_target(_without_transitional)?)$", x["m"])
              and not SUBS.search(x.get("s", ""))]
        if not xs:
            return None
        x = max(xs, key=lambda x: (x["d"], rp_end(x["rp"])))
        b = basis_of(x["m"], x.get("s"), x.get("l"), x.get("n"))
        return {"v": r6(x["v"]), "d": x["d"], "basis": b if b != "?" else None, "after": bool(re.search(r"after|לאחר", (x.get("l") or "") + (x.get("n") or ""), re.I)),
                "prov": self.fact_prov(x, f"עודף הון מעל היעד, כפי שהודפס · {self.name} · {dperiod(x['d'])}", fm(x["v"]))}

    # --- the whole company
    def build(self):
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
        T = self.targets(d)
        cons = []
        for (kind, b), (t, tb) in sorted(T.items()):
            if b not in B:
                continue
            cons.append({"id": f"{kind}_{b}", "kind": kind, "basis": b, "stated": tb if tb != "?" else None, "t": r6(t["v"]), "t_prov": self.target_prov(t),
                         "period": qname(t["rp"]) if t.get("rp") else t["d"]})
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
        out["options"] = options(out)
        out["rank"] = rank(out)
        return out


# ---------------------------------------------------------------- the option set (web/src/lib/capital.ts recomputes it for a buffer override: same formulas)
def options(c):
    """the four rows at the file's buffer; the TS library reproduces them (tests/capital.unit.ts) and recomputes them for an override"""
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
    rows.append({"id": "bolt", "status": "A9"})
    rows.append({"id": "hold", "status": "A2"})
    return rows


def rank(c):
    """the options by ROIC − ke per NIS deployed (dividend / buyback = 0 by construction); the bolt-on (A9) and the hold row are not ranked"""
    ke = c["pnl"]["ke"]["v"]
    rs = [(o["roic"]["v"] - ke, o["id"]) for o in c["options"] if "roic" in o and o["cap"]["v"] > 0]
    return [i for _, i in sorted(rs, key=lambda x: (-x[0], x[1]))]


FUND_WHY = "הון עצמי של חברה מנהלת מול דרישת ההון המינימלית לא חולץ מהדוחות; אין חישוב הון בר-חלוקה"


def build():
    I = Inputs()
    built = max((f["meta"]["built"] for f in I.drv.values()), default=dt.date.today().isoformat())
    base = next(iter(I.drv.values()))["meta"]["base"] if I.drv else {}
    cos = []
    for cid, r in I.reg.items():
        if r.get("kind") == "insurance_group":
            cos.append(Co(I, cid).build())
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
        if a[0] == "con":
            k = next(x for x in c["constraints"] if x["id"] == a[1])
            return k["t_prov"] if a[2] == "t" else k["headroom"]["prov"]
    except (KeyError, IndexError, StopIteration):
        return None
    return None


def walk(p, where, bad, depth=0, c=None):
    if depth > 40:
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
        if p.get("pg") is None and "בנק ישראל" not in (p.get("doc") or ""):
            bad.append(("report without a page", where, p.get("title")))
    elif p["k"] == "calc":
        if not p.get("inputs") and not p.get("est"):
            bad.append(("calc without inputs, not an assumption", where, p.get("title")))
        for x in p.get("inputs", []):
            if "p" in x and x["p"] is not None:
                walk(x["p"], where + " > " + x["label"][:30], bad, depth + 1, c)
    elif p["k"] not in ("lts", "none", "xbrl"):
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


def verify(d):
    bad, n_id = [], 0
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
            for k in ("cap", "roic", "solv", "roe", "eps", "eps_bb"):
                if k in o:
                    if o[k]["v"] is not None:
                        walk(o[k]["prov"], f"{w}.{o['id']}.{k}", bad, 0, c)
        if options(c) != c["options"]:
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
    ok = [c for c in d["companies"] if c["status"] == "ok"]
    if "--check" in sys.argv:
        same = OUT.exists() and json.loads(OUT.read_text(encoding="utf8")) == json.loads(dumps(d))
        print(f"capital: {len(ok)} insurers computed, {len(d['companies']) - len(ok)} marked not available; {n_id} identities; "
              f"{'rebuild matches' if same else 'DIFFERS from capital/options.json'}; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if same and not bad else 1)
    if bad:
        print("misses:")
        for b in bad[:40]:
            print("  ", b)
        sys.exit(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dumps(d), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes; {len(ok)} insurers, {n_id} identities")
    for c in ok:
        b = next(k for k in c["constraints"] if k["id"] == c["binding"])
        print(f"  {c['id']:10s} {c['period']}  binding {b['id']:9s} {b['t']:6.1f}%  headroom {b['headroom']['v']:9,.1f}  buffer {c['buffer']['pp']:4.1f}pp {c['buffer']['v']:7,.1f}"
              f"  distributable {c['distributable']['v']:9,.1f}  rank {c['rank']}")
