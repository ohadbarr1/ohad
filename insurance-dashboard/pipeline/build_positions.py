"""The position book (module A6): fox's claims about the future, each with evidence, confidence, falsifiers and consequences, kept in an
append-only ledger and scored against the data the site already publishes. Standard library only.

python3 pipeline/build_positions.py            evaluate every PUBLISHED position (data/ledger/positions/) against the published data and
                                               write web/public/data/positions.json (the /positions page, the tear sheets, the feed events)
python3 pipeline/build_positions.py --drafts   DEV ONLY: also evaluate the candidate drafts under data/positions/ (status "draft"). The gate
                                               fails while positions.json carries a draft, so a drafts build can never be deployed.
python3 pipeline/build_positions.py --check    rebuild in memory (no drafts) and compare with positions.json on disk; validate every ledger
                                               entry (pipeline/gate.py check `positions`; `positions_ledger` = the entries at git HEAD unchanged)

Authoring is the owner's, through pipeline/position.py (new | publish | revise | close | validate | list) or by editing a working file.

The object (data/positions/<id>.json, the working file; the ledger freezes a copy of it per revision):
  id          a-z, 0-9, "-"
  claim       one Hebrew sentence about reported fundamentals (never a buy/sell call or a share price)
  horizon     ISO date; in the future when published
  confidence  low | medium | high          direction  constructive | cautious | neutral
  company     a company id, a list of ids, or "industry"
  evidence    [{ref, note}]  ref = a fox route ("/savings?g=כלל&s=pg") or a metric/target/card key (below); every ref must resolve
  mechanism   free text (mechanism_edge: an A1 driver-graph edge id, later)
  falsifiers  [{metric, op, value, period, note}]   op < <= > >=; period a label (Q4'27, FY'27) checked when printed, or "each" =
              every print after the position was opened; AT LEAST ONE, or the gate rejects the position
  triggers    [{metric, threshold_pp | threshold_pct, base}]   evidence drift: the metric moved past the threshold since opening;
              base = {per, v}, frozen when published
  review      "print" (each quarterly print of the companies involved) or an ISO date; also due when a company involved crosses into
              watch / alert on the Fragility Monitor after the last revision (module A10, fragility.json: `frag`, feed pk "fragility")
  status      draft | published (working file only)

Metric keys (machine-checkable, every value carries the cells it is made of):
  lens:<co>:<seg>:<field>[.ltm]   Savings Lens (lens.json), quarterly; seg pen | gem | pg | hish | ins; field ci (cost/income %),
                                  fy_rep / fy_reg (fee yield, % of assets, annualised), aum_share / flow_share / growth (%),
                                  tr (net transfers) / org (organic accrual) / fees / sm / ga / op (NIS m). .ltm = the last four
                                  quarters: a sum for amounts, (sum sm + sum ga) / sum fees x 100 for ci.
                                  <co> may be median(a,b,...): the median of the companies, only where all of them have the quarter.
  kpi:<co>:<concept>              kpi.json (XBRL of the periodic reports, NIS m), quarterly and FY
  solv:<co>                       the solvency ratio with transitional measures as the report cards print it (cards/), per ratio date
  <term> - <term>                 a difference of two terms on the same periods (e.g. a gap to a peer median)
Other evidence keys: target:<co>:<metric>:<seg>:<horizon> (targets.json, the last statement), card:<co>:<period> (a report card).

Ledger (data/ledger/positions/<id>/): r<n>.json = a revision {kind, id, rev, date, supersedes, note, hash, position}; o<n>.json = an
outcome {kind, id, seq, date, rev, outcome, note}. Nothing is ever edited or removed: a change is a new revision that names the one
it supersedes, a close is a dated append (confirmed | falsified | expired | withdrawn). The engine never closes a position: a met
falsifier only SUGGESTS "falsified". Hit rate = confirmed / (confirmed + falsified) over closed positions; expired and withdrawn are
counted beside it, never inside it.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "positions.json"
WORK = ROOT / "data" / "positions"
LEDGER = ROOT / "data" / "ledger" / "positions"

# ---- the owner's switch (same name as module M1). Owner decision 27.10.26: phoenix is published like any other company (OFF).
# When True, no position whose company includes phoenix is published, and /positions states the abstention.
ABSTAIN_PHOENIX = False
ABSTAIN_TEXT = "fox אינו מפרסם עמדות על הפניקס"

CONF = ("low", "medium", "high")
DIRS = ("constructive", "cautious", "neutral")
OUTCOMES = ("confirmed", "falsified", "expired", "withdrawn")
OPS = {"<": lambda a, b: a < b, "<=": lambda a, b: a <= b, ">": lambda a, b: a > b, ">=": lambda a, b: a >= b}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,60}$")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# a position is a claim about reported fundamentals: no trading call, no share price, and the site's period grammar
BANNED = re.compile(r"\b(buy|sell|overweight|underweight|outperform|underperform|price target|target price|share price)\b|"
                    r"המלצת (קנייה|מכירה|החזקה)|לקנות|למכור|מחיר יעד|מחיר המניה|מחיר מניה|מחירי המניות|אשתקד", re.I)
SEGS = ("pen", "gem", "pg", "hish", "ins")
SEG_HE = {"pen": "פנסיה", "gem": "גמל והשתלמות", "pg": "פנסיה וגמל", "hish": "קרנות השתלמות", "ins": "ביטוחי מנהלים ופוליסות חיסכון"}
# field -> (label, unit, where in the lens row, ltm rule)   unit: pct (a ratio, %) | m (NIS m)
FIELDS = {
    "ci": ("יחס הוצאות להכנסות", "pct", "top", "ci"),
    "fy_rep": ("תשואת דמי ניהול על נכסים מדווחים, שנתי", "pct", "top", None),
    "fy_reg": ("תשואת דמי ניהול על נכסי הרשות, שנתי", "pct", "top", None),
    "aum_share": ("נתח מנכסים", "pct", "top", None),
    "flow_share": ("נתח מהצבירה נטו", "pct", "top", None),
    "growth": ("צמיחה אורגנית ברבעון", "pct", "top", None),
    "tr": ("העברות נטו", "m", "reg", "sum"),
    "org": ("צבירה אורגנית", "m", "reg", "sum"),
    "fees": ("הכנסות מדמי ניהול", "m", "rep", "sum"),
    "sm": ("שיווק ומכירה", "m", "rep", "sum"),
    "ga": ("הנהלה וכלליות", "m", "rep", "sum"),
    "op": ("רווח תפעולי (מגזר)", "m", "rep", "sum"),
}
KPI_HE = {"profit": "רווח לבעלי המניות", "oci": "רווח כולל לבעלי המניות", "equity": "הון לבעלי המניות", "pretax": "רווח לפני מס",
          "revenue": "הכנסות", "op_profit": "רווח תפעולי", "assets": "סך נכסים", "cfo": "תזרים מפעילות שוטפת"}
# the fox routes an evidence ref may point at (pipeline/tests/test_positions.py checks each against web/src/App.tsx); :id = a company id
ROUTES = ["/", "/savings", "/funds", "/managers", "/calendar", "/book", "/data", "/restatements", "/presentations", "/credibility", "/feed",
          "/debt", "/ownership", "/holdings", "/search", "/industry/peers", "/industry/csm", "/positions",
          "/company/:id", "/company/:id/review", "/company/:id/financials", "/company/:id/profit", "/company/:id/ifrs17",
          "/company/:id/savings", "/company/:id/filings", "/card/:id/:period", "/valuation/:id", "/debt/:id", "/ownership/:id",
          "/holdings/:id", "/facts/:id", "/positions/:pid", "/fragility"]

PAGE_HE = {"": "בית", "savings": "עדשת החיסכון", "funds": "מסלולים", "managers": "דירוג מנהלים", "calendar": "לוח דיווחים", "book": "ספר הגרפים",
           "data": "נתונים ואיכות", "restatements": "הצגות מחדש", "presentations": "מצגות משקיעים", "credibility": "אמינות יעדים", "feed": "מה השתנה",
           "debt": "חוב ופירעונות", "ownership": "בעלות", "holdings": "הרכב נכסים", "search": "חיפוש", "industry": "השוואה ענפית", "positions": "ספר העמדות",
           "company": "עמוד החברה", "card": "כרטיס דוח", "valuation": "הערכת שווי", "facts": "עובדות",
           "fragility": "מוניטור שבריריות"}
SUB_HE = {"peers": "טבלת עמיתים", "csm": "IFRS 17 · CSM · הון", "review": "סקירת דוח", "financials": "דוחות כספיים", "profit": "מקורות רווח וענפים",
          "ifrs17": "IFRS 17", "savings": "חיסכון ארוך טווח", "filings": "מסמכים"}
VIEW_HE = {"rank": "דירוג", "market": "שוק", "econ": "רווחיות", "now": "אומדן", "npv": "ערך צבירה"}
FEED_T_HE = {"flow": "מעברי צבירה נטו", "filing": "דוחות", "fee": "דמי ניהול", "target": "יעדים", "solv": "כושר פירעון", "restate": "הצגות מחדש"}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def canon(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(o):
    return hashlib.sha256(canon(o).encode("utf-8")).hexdigest()


# ------------------------------------------------------------------------------------------------------------------ periods
def qkey(y, q):
    return f"{y}Q{q}"


def qlabel(k):
    """2026Q2 -> Q2'26, 2025FY -> FY'25"""
    return f"FY'{k[2:4]}" if k.endswith("FY") else f"{k[4:]}'{k[2:4]}"


def parse_label(s):
    """Q2'26 -> 2026Q2, FY'28 -> 2028FY (None if not a period label)"""
    m = re.match(r"^Q([1-4])'(\d\d)$", s or "")
    if m:
        return qkey(2000 + int(m.group(2)), int(m.group(1)))
    m = re.match(r"^FY'(\d\d)$", s or "")
    return f"{2000 + int(m.group(1))}FY" if m else None


def lens_q(k):
    """Q2-2026 -> 2026Q2"""
    return f"{k[3:]}Q{k[1]}"


def q_end(k):
    y, q = int(k[:4]), (4 if k.endswith("FY") else int(k[5]))
    return f"{y}-{('03-31', '06-30', '09-30', '12-31')[q - 1]}"


def q_of_date(d):
    return qkey(int(d[:4]), (int(d[5:7]) - 1) // 3 + 1)


def same_period(series_key, want):
    """a falsifier period against a series period: FY'28 matches 2028FY, or 2028Q4 on a quarterly series"""
    return series_key == want or (want.endswith("FY") and series_key == want[:4] + "Q4")


# ------------------------------------------------------------------------------------------------------------------ data
class Ctx:
    """the published files a position is resolved against (read once)"""

    def __init__(self, data=DATA):
        self.data = Path(data)
        self.lens = load(self.data / "lens.json")
        self.kpi = load(self.data / "kpi.json")
        self.targets = load(self.data / "targets.json")
        self.cal = load(self.data / "calendar.json")
        self.cos = {c["id"]: c["name_he"] for c in load(self.data / "companies" / "index.json")}
        self.G = [g["id"] for g in self.lens["groups"]]
        self.GN = [g["name"] for g in self.lens["groups"]]
        self.rows = {(r["g"], r["s"], r["q"]): r for r in self.lens["rows"]}
        self.Q = self.lens["quarters"]
        self.prints = {}  # (company, period) -> the publication day of its report on MAYA
        for c in self.cal["companies"]:
            for h in c.get("history") or []:
                self.prints[(c["id"], h["period"])] = h["date"]
            if c.get("last"):
                self.prints.setdefault((c["id"], c["last"]["period"]), c["last"]["date"])
        self.next_print = {c["id"]: (c.get("next") or {}).get("expected") for c in self.cal["companies"]}
        self.cards = (load(self.data / "cards" / "index.json").get("co") or {}) if (self.data / "cards" / "index.json").exists() else {}
        # module A10: the Fragility Monitor (its crossings mark a position for review; additive, absent file = no marks)
        self.frag = load(self.data / "fragility.json") if (self.data / "fragility.json").exists() else None
        self._card = {}

    def print_date(self, c, per):
        """the day the report of period per (2026Q2; a Q4 is the annual report) was published"""
        p = per[:4] + "FY" if per.endswith("Q4") else per
        return self.prints.get((c, p))

    def card(self, c, p):
        if (c, p) not in self._card:
            f = self.data / "cards" / c / f"{p}.json"
            self._card[(c, p)] = load(f) if f.exists() else None
        return self._card[(c, p)]

    # ------------------------------------------------------------------ metric series: [{p, v, in, d}] in period order
    def lens_term(self, cospec, seg, field, ltm):
        m = re.match(r"^median\(([a-z_,]+)\)$", cospec)
        cos = m.group(1).split(",") if m else [cospec]
        for c in cos:
            if c not in self.G:
                raise KeyError(f"{c}: not a Savings Lens group")
        if seg not in SEGS:
            raise KeyError(f"segment {seg!r} (pen, gem, pg, hish, ins)")
        if field not in FIELDS:
            raise KeyError(f"field {field!r} ({', '.join(FIELDS)})")
        label, unit, where, rule = FIELDS[field]
        if ltm and not rule:
            raise KeyError(f"{field}: no LTM rule (a ratio of averages is not a sum)")

        def cell(c, q):
            r = self.rows.get((self.G.index(c), seg, q))
            if not r:
                return None
            if where == "top":
                return r.get(field)
            if where == "reg":
                return (r.get("reg") or {}).get(field)
            return (r.get("rep") or {}).get(field)

        def one(c, qi):
            """(value, input cells) of one company at quarter index qi"""
            g = self.G.index(c)
            if not ltm:
                v = cell(c, self.Q[qi])
                return (None, None) if v is None else (v, [{"k": "lens", "g": g, "s": seg, "q": self.Q[qi], "f": field, "v": v}])
            if qi < 3:
                return None, None
            qs = self.Q[qi - 3:qi + 1]
            if rule == "sum":
                vs = [cell(c, q) for q in qs]
                if any(v is None for v in vs):
                    return None, None
                return round(sum(vs), 6), [{"k": "lens", "g": g, "s": seg, "q": q, "f": field, "v": v} for q, v in zip(qs, vs)]
            parts = [(cell_rep(c, q, "sm"), cell_rep(c, q, "ga"), cell_rep(c, q, "fees")) for q in qs]
            if any(None in p for p in parts) or not sum(p[2] for p in parts):
                return None, None
            v = (sum(p[0] for p in parts) + sum(p[1] for p in parts)) / sum(p[2] for p in parts) * 100
            return round(v, 6), [{"k": "lens", "g": g, "s": seg, "q": q, "f": "ci", "v": cell(c, q)} for q in qs]

        def cell_rep(c, q, f):
            r = self.rows.get((self.G.index(c), seg, q))
            return (r.get("rep") or {}).get(f) if r else None

        out = []
        for qi, q in enumerate(self.Q):
            vals = [one(c, qi) for c in cos]
            if any(v[0] is None for v in vals):
                continue
            p = lens_q(q)
            ds = [self.print_date(c, p) for c in cos]
            d = max(ds) if all(ds) else None
            if m:
                v = statistics.median(x[0] for x in vals)
                ins = [{"k": "term", "l": self.GN[self.G.index(c)], "v": x[0], "in": x[1]} for c, x in zip(cos, vals)]
            else:
                v, ins = vals[0]
            out.append({"p": p, "v": round(v, 6), "in": ins, "d": d})
        names = [self.GN[self.G.index(c)] for c in cos]
        who = f"חציון {', '.join(names)}" if m else names[0]
        lab = f"{label}{', LTM' if ltm else ''} · {SEG_HE[seg]} · {who}"
        fx = None
        if ltm and rule == "sum":
            fx = "סכום ארבעת הרבעונים האחרונים"
        elif ltm:
            fx = "(סכום שיווק ומכירה + סכום הנהלה וכלליות) ÷ סכום הכנסות מדמי ניהול × 100, ארבעת הרבעונים האחרונים"
        if m:
            fx = (fx + "; " if fx else "") + f"חציון של {len(cos)} החברות, רק ברבעון שבו לכולן יש נתון"
        to = f"/savings?g={names[0]}&s={seg}" if not m else f"/savings?v=rank&s={seg}"
        return {"label": lab, "unit": unit, "fx": fx, "to": to, "cos": cos, "ser": out, "what": f"{label}{', LTM' if ltm else ''} · {SEG_HE[seg]}", "who": who}

    def kpi_term(self, c, concept):
        k = (self.kpi.get("companies") or {}).get(c)
        if not k:
            raise KeyError(f"{c}: no XBRL series (kpi.json)")
        if concept not in (k.get("values") or {}):
            raise KeyError(f"{c}: no XBRL concept {concept!r}")
        out = []
        for i, p in enumerate(k["periods"]):
            v = k["values"][concept][i]
            if v is None:
                continue
            v = v / 1000  # kpi.json carries NIS thousands
            out.append({"p": p, "v": round(v, 6), "in": [{"k": "kpi", "c": c, "p": p, "m": concept, "v": round(v, 6), "rid": (k.get("rid") or [None] * len(k["periods"]))[i]}],
                        "d": self.print_date(c, p)})
        return {"label": f"{KPI_HE.get(concept, concept)} · {self.cos.get(c, c)}", "unit": "m", "fx": None, "to": f"/company/{c}/financials", "cos": [c], "ser": out}

    def solv_term(self, c):
        ps = (self.cards.get(c) or {}).get("p")
        if not ps:
            raise KeyError(f"{c}: no report cards")
        by = {}
        for p in sorted(ps):
            card = self.card(c, p)
            r = next((x for x in (card or {}).get("rows", []) if x["k"] == "sr"), None)
            if not r or r["cur"] not in card["f"] or card["f"][r["cur"]].get("v") is None:
                continue
            f = card["f"][r["cur"]]
            s = f.get("s") or {}
            at = r["at"]
            pub = (card.get("doc") or {}).get("pub")
            if at in by and by[at]["d"] and pub and by[at]["d"] <= pub:
                continue  # the first disclosure of a ratio date is the one on record
            url = card["u"][s["u"]] if s.get("u") is not None and s["u"] < len(card.get("u") or []) else None
            by[at] = {"p": q_of_date(at), "at": at, "v": f["v"], "d": pub,
                      "in": [{"k": "card", "c": c, "card": p, "row": "sr", "v": f["v"], "url": url, "pg": s.get("pg"), "at": at, "l": r["l"]}]}
        out = [by[k] for k in sorted(by)]
        return {"label": f"יחס כושר פירעון, עם הוראות מעבר · {self.cos.get(c, c)}", "unit": "pct", "fx": None, "to": f"/company/{c}", "cos": [c], "ser": out}

    def term(self, key):
        parts = key.split(":")
        if parts[0] == "lens" and len(parts) == 4:
            field, ltm = (parts[3][:-4], True) if parts[3].endswith(".ltm") else (parts[3], False)
            return self.lens_term(parts[1], parts[2], field, ltm)
        if parts[0] == "kpi" and len(parts) == 3:
            return self.kpi_term(parts[1], parts[2])
        if parts[0] == "solv" and len(parts) == 2:
            return self.solv_term(parts[1])
        raise KeyError(f"{key!r}: not a metric key (lens:<co>:<seg>:<field>[.ltm], kpi:<co>:<concept>, solv:<co>)")

    def metric(self, key):
        """a metric key resolved to {key, label, unit, fx, to, cos, ser}; KeyError when it does not resolve"""
        if " - " in key:
            a, b = (self.term(x.strip()) for x in key.split(" - ", 1))
            if a["unit"] != b["unit"]:
                raise KeyError(f"{key!r}: units differ ({a['unit']} vs {b['unit']})")
            bb = {x["p"]: x for x in b["ser"]}
            ser = []
            for x in a["ser"]:
                y = bb.get(x["p"])
                if y is None:
                    continue
                ds = [x["d"], y["d"]]
                ser.append({"p": x["p"], "v": round(x["v"] - y["v"], 6), "d": max(ds) if all(ds) else None,
                            "in": [{"k": "term", "l": a["label"], "v": x["v"], "in": x["in"]}, {"k": "term", "l": b["label"], "v": y["v"], "in": y["in"]}]})
            same = a.get("what") and a.get("what") == b.get("what")
            m = {"label": f"פער {a['what']}: {a['who']} מול {b['who']}" if same else f"{a['label']} פחות {b['label']}",
                 "unit": "pp" if a["unit"] == "pct" else a["unit"], "fx": "הפרש: האיבר הראשון פחות השני, באותו רבעון",
                 "to": a["to"], "cos": a["cos"] + [c for c in b["cos"] if c not in a["cos"]], "ser": ser}
        else:
            m = self.term(key.strip())
        m = {k: v for k, v in m.items() if k not in ("what", "who")}
        if not m["ser"]:
            raise KeyError(f"{key!r}: resolves to no printed value")
        return {"key": key, **m}

    # ------------------------------------------------------------------ evidence refs
    def route_ok(self, ref):
        path = ref.split("#", 1)[0].split("?", 1)[0].rstrip("/") or "/"
        segs = path.strip("/").split("/") if path != "/" else []
        for pat in ROUTES:
            ps = pat.strip("/").split("/") if pat != "/" else []
            if len(ps) != len(segs):
                continue
            ok = True
            for a, b in zip(ps, segs):
                if a == ":id":
                    ok = ok and b in self.cos
                elif a in (":period", ":pid"):
                    ok = ok and bool(b)
                else:
                    ok = ok and a == b
            if ok:
                if pat == "/card/:id/:period":
                    return self.card(segs[1], segs[2]) is not None
                return True
        return False

    def route_label(self, ref):
        """the page a route opens, in words: עדשת החיסכון · כלל · פנסיה וגמל"""
        from urllib.parse import parse_qs, urlsplit
        u = urlsplit(ref)
        segs = [x for x in u.path.strip("/").split("/") if x]
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        parts = [PAGE_HE.get(segs[0] if segs else "", segs[0] if segs else "בית")]
        if segs[:1] in (["company"], ["valuation"], ["debt"], ["ownership"], ["holdings"], ["facts"]) and len(segs) > 1:
            parts.append(self.cos.get(segs[1], segs[1]))
            parts += [SUB_HE[x] for x in segs[2:] if x in SUB_HE]
        elif segs[:1] == ["card"] and len(segs) == 3:
            parts += [self.cos.get(segs[1], segs[1]), qlabel(segs[2])]
        else:
            parts += [SUB_HE[x] for x in segs[1:] if x in SUB_HE]
        if q.get("v") in VIEW_HE:
            parts.append(VIEW_HE[q["v"]])
        if q.get("g"):
            parts.append(q["g"])
        if q.get("co"):
            parts.append(self.cos.get(q["co"], q["co"]))
        if q.get("s") in SEG_HE:
            parts.append(SEG_HE[q["s"]])
        if q.get("t") in FEED_T_HE:
            parts.append(FEED_T_HE[q["t"]])
        return " · ".join(parts)

    def evidence(self, ref):
        """{kind, ok, label, to, pdf?, val?} or KeyError"""
        if ref.startswith("/"):
            if not self.route_ok(ref):
                raise KeyError(f"{ref!r}: no such fox page")
            from urllib.parse import parse_qs, urlsplit
            q = {k: v[0] for k, v in parse_qs(urlsplit(ref).query).items()}
            if q.get("g") and q["g"] not in self.GN:
                raise KeyError(f"{ref!r}: g={q['g']!r} is not a Savings Lens group ({', '.join(x for x in self.GN if x)})")
            if q.get("co") and q["co"] not in self.cos:
                raise KeyError(f"{ref!r}: co={q['co']!r} is not a fox company")
            if q.get("s") and q["s"] not in SEG_HE:
                raise KeyError(f"{ref!r}: s={q['s']!r} is not a segment")
            return {"kind": "route", "label": self.route_label(ref), "to": ref}
        kind = ref.split(":", 1)[0]
        if kind == "target":
            _, c, m, seg, h = (ref.split(":") + [""] * 5)[:5]
            rows = [t for t in self.targets["rows"] if t["c"] == c and t["m"] == m and str(t.get("seg")) == seg and str(t.get("h") or "") == h]
            if not rows:
                raise KeyError(f"{ref!r}: no such management target (targets.json)")
            t = rows[-1]
            doc = self.targets["docs"].get(str(t.get("doc"))) if t.get("doc") else None
            return {"kind": "target", "label": f"{t['l']}{', ' + t['e'] if t.get('e') else ''} · {self.cos.get(c, c)}{' · ' + str(t['h']) if t.get('h') else ''}",
                    "to": f"/credibility?co={c}", "pdf": {"url": self.targets["files"] + doc[4], "pg": t.get("pg")} if doc else None,
                    "val": {"v": t.get("v"), "lo": t.get("lo"), "hi": t.get("hi"), "u": t["u"], "st": t["st"]}}
        if kind == "card":
            _, c, p = (ref.split(":") + ["", ""])[:3]
            card = self.card(c, p)
            if not card:
                raise KeyError(f"{ref!r}: no such report card")
            return {"kind": "card", "label": f"כרטיס דוח · {self.cos.get(c, c)} · {qlabel(p)}", "to": f"/card/{c}/{p}",
                    "pdf": {"url": card["u"][card["doc"]["u"]], "pg": None} if card.get("doc") and card.get("u") else None}
        m = self.metric(ref)
        last = m["ser"][-1]
        return {"kind": "metric", "label": m["label"], "to": m["to"], "val": {"v": last["v"], "u": m["unit"], "p": last["p"]}}


# ------------------------------------------------------------------------------------------------------------------ validation
def companies(p):
    c = p.get("company")
    return ["industry"] if c == "industry" else [c] if isinstance(c, str) else list(c or [])


def validate(p, ctx, today=None, publish=False):
    """the problems of one position (an empty list = valid). publish: the horizon must lie after `today`."""
    bad = []
    if not ID_RE.match(str(p.get("id", ""))):
        bad.append("id: a-z, 0-9 and '-', 3 to 61 characters")
    if not isinstance(p.get("claim"), str) or len(p["claim"].strip()) < 10:
        bad.append("claim: one sentence")
    for f in ("claim", "mechanism"):
        if isinstance(p.get(f), str) and BANNED.search(p[f]):
            bad.append(f"{f}: a position is a claim about reported fundamentals (no buy/sell call, no share price, no 'אשתקד')")
    if not ISO.match(str(p.get("horizon", ""))):
        bad.append("horizon: an ISO date")
    elif publish and today and p["horizon"] <= today:
        bad.append(f"horizon {p['horizon']}: must lie in the future (today {today})")
    if p.get("confidence") not in CONF:
        bad.append(f"confidence: {' | '.join(CONF)}")
    if p.get("direction") not in DIRS:
        bad.append(f"direction: {' | '.join(DIRS)}")
    cos = companies(p)
    if not cos:
        bad.append("company: an id, a list of ids, or 'industry'")
    for c in cos:
        if c != "industry" and c not in ctx.cos:
            bad.append(f"company {c!r}: not a fox company")
    if publish and ABSTAIN_PHOENIX and "phoenix" in cos:
        bad.append(f"company phoenix: ABSTAIN_PHOENIX is on ({ABSTAIN_TEXT})")
    if not isinstance(p.get("mechanism"), str) or not p["mechanism"].strip():
        bad.append("mechanism: free text")
    ev = p.get("evidence") or []
    if not ev:
        bad.append("evidence: at least one ref")
    for i, e in enumerate(ev):
        try:
            ctx.evidence(str(e.get("ref", "")))
        except KeyError as x:
            bad.append(f"evidence[{i}]: {x.args[0]}")
    fs = p.get("falsifiers") or []
    if not fs:
        bad.append("falsifiers: at least one (a position nothing could falsify is not a position)")
    for i, f in enumerate(fs):
        try:
            ctx.metric(str(f.get("metric", "")))
        except KeyError as x:
            bad.append(f"falsifiers[{i}].metric: {x.args[0]}")
        if f.get("op") not in OPS:
            bad.append(f"falsifiers[{i}].op: one of {' '.join(OPS)}")
        if not isinstance(f.get("value"), (int, float)) or isinstance(f.get("value"), bool):
            bad.append(f"falsifiers[{i}].value: a number")
        per = f.get("period")
        if per != "each" and not parse_label(per):
            bad.append(f"falsifiers[{i}].period: a label (Q4'27, FY'27) or 'each'")
        elif per != "each" and ISO.match(str(p.get("horizon", ""))) and q_end(parse_label(per)) > p["horizon"]:
            bad.append(f"falsifiers[{i}].period {per}: after the horizon")
    for i, t in enumerate(p.get("triggers") or []):
        try:
            ctx.metric(str(t.get("metric", "")))
        except KeyError as x:
            bad.append(f"triggers[{i}].metric: {x.args[0]}")
        th = [k for k in ("threshold_pp", "threshold_pct") if k in t]
        if len(th) != 1 or not isinstance(t[th[0]], (int, float)) or t[th[0]] <= 0:
            bad.append(f"triggers[{i}]: exactly one of threshold_pp / threshold_pct, a positive number")
    rv = p.get("review")
    if rv != "print" and not ISO.match(str(rv or "")):
        bad.append("review: 'print' or an ISO date")
    return bad


def freeze(p, ctx, prev=None):
    """the baselines a published revision carries: each trigger's base {per, v} (kept from the previous revision for the same metric)
    and each 'each' falsifier's `since` (the last printed period when the position was opened)"""
    old_t = {t["metric"]: t.get("base") for t in (prev or {}).get("triggers") or []}
    old_f = {f["metric"]: f.get("since") for f in (prev or {}).get("falsifiers") or [] if f.get("period") == "each"}
    for t in p.get("triggers") or []:
        if old_t.get(t["metric"]):
            t["base"] = old_t[t["metric"]]
        else:
            last = ctx.metric(t["metric"])["ser"][-1]
            t["base"] = {"per": qlabel(last["p"]), "v": last["v"]}
    for f in p.get("falsifiers") or []:
        if f.get("period") == "each":
            f["since"] = old_f.get(f["metric"]) or qlabel(ctx.metric(f["metric"])["ser"][-1]["p"])
    return p


# ------------------------------------------------------------------------------------------------------------------ ledger
def read_ledger(ledger=LEDGER):
    """{id: {"revs": [...], "outs": [...]}} from data/ledger/positions/<id>/r<n>.json and o<n>.json"""
    out = {}
    if not Path(ledger).exists():
        return out
    for d in sorted(Path(ledger).iterdir()):
        if not d.is_dir():
            continue
        revs = sorted((load(f) for f in d.glob("r*.json")), key=lambda x: x.get("rev", 0))
        outs = sorted((load(f) for f in d.glob("o*.json")), key=lambda x: x.get("seq", 0))
        out[d.name] = {"revs": revs, "outs": outs, "files": sorted(f.name for f in d.glob("*.json"))}
    return out


def ledger_problems(L, ctx):
    """the structure of the ledger: contiguous revisions, each superseding the last, hashes recompute, falsifier present, refs resolve,
    horizon after the revision date, outcomes after the last revision, at most one close, nothing after a close"""
    bad = []
    for pid, x in L.items():
        names = {f"r{r.get('rev')}.json" for r in x["revs"]} | {f"o{o.get('seq')}.json" for o in x["outs"]}
        if names != set(x["files"]):
            bad.append(f"{pid}: file names do not match rev / seq ({', '.join(x['files'])})")
        if not x["revs"]:
            bad.append(f"{pid}: an outcome without a published revision")
            continue
        for i, r in enumerate(x["revs"]):
            tag = f"{pid} r{r.get('rev')}"
            if r.get("kind") != "revision" or r.get("id") != pid or r.get("rev") != i + 1:
                bad.append(f"{tag}: not revision {i + 1} of {pid}")
            if r.get("supersedes") != (None if i == 0 else f"r{i}"):
                bad.append(f"{tag}: must supersede {'nothing' if i == 0 else f'r{i}'}")
            if i and r.get("date", "") < x["revs"][i - 1].get("date", ""):
                bad.append(f"{tag}: dated before the revision it supersedes")
            if i and not (r.get("note") or "").strip():
                bad.append(f"{tag}: a revision states why (note)")
            pos = r.get("position") or {}
            if sha(pos) != r.get("hash"):
                bad.append(f"{tag}: hash does not recompute")
            if pos.get("id") != pid:
                bad.append(f"{tag}: position id {pos.get('id')!r}")
            if pos.get("status") is not None:
                bad.append(f"{tag}: the frozen position carries a status")
            if not ISO.match(str(r.get("date", ""))):
                bad.append(f"{tag}: no date")
            bad += [f"{tag}: {m}" for m in validate(pos, ctx, today=r.get("date"), publish=True)]
            if not all(t.get("base") for t in pos.get("triggers") or []):
                bad.append(f"{tag}: a trigger without its frozen base")
        last = x["revs"][-1]
        closed = False
        for j, o in enumerate(x["outs"]):
            tag = f"{pid} o{o.get('seq')}"
            if o.get("kind") != "outcome" or o.get("id") != pid or o.get("seq") != j + 1:
                bad.append(f"{tag}: not outcome {j + 1} of {pid}")
            if o.get("outcome") not in OUTCOMES:
                bad.append(f"{tag}: outcome {o.get('outcome')!r}")
            if not (o.get("note") or "").strip() or not ISO.match(str(o.get("date", ""))):
                bad.append(f"{tag}: an outcome is a dated note")
            if o.get("rev") != last["rev"] or o.get("date", "") < last.get("date", ""):
                bad.append(f"{tag}: must close the last revision (r{last['rev']}), on or after its date")
            if closed:
                bad.append(f"{tag}: the position was already closed")
            closed = True
    return bad


# ------------------------------------------------------------------------------------------------------------------ evaluation
def fmt_metric(m):
    return {"key": m["key"], "label": m["label"], "unit": m["unit"], "fx": m["fx"], "to": m["to"],
            "ser": [[x["p"], x["v"], x["d"], x["in"]] for x in m["ser"]]}


def evaluate(p, ctx, meta, metrics):
    """one position against the data: evidence, falsifier status, trigger drift, next review, suggestion (never a close)"""
    ev = []
    for e in p.get("evidence") or []:
        try:
            r = ctx.evidence(e["ref"])
            ev.append({"ref": e["ref"], "note": e.get("note") or "", "ok": True, **r})
        except KeyError as x:
            ev.append({"ref": e["ref"], "note": e.get("note") or "", "ok": False, "kind": "missing", "label": x.args[0], "to": None})
        if ev[-1]["kind"] == "metric":
            metrics.setdefault(e["ref"], fmt_metric(ctx.metric(e["ref"])))
    opened = meta.get("opened")
    fals = []
    for f in p.get("falsifiers") or []:
        out = {k: f.get(k) for k in ("metric", "op", "value", "period", "note", "since")}
        try:
            m = ctx.metric(f["metric"])
        except KeyError as x:
            fals.append({**out, "st": "unresolved", "why": x.args[0]})
            continue
        metrics.setdefault(f["metric"], fmt_metric(m))
        out.update(label=m["label"], unit=m["unit"])
        test = OPS[f["op"]]
        if f["period"] == "each":
            since = parse_label(f.get("since")) if f.get("since") else None
            hz = p["horizon"]
            after = [x for x in m["ser"] if (since is None or x["p"] > since) and q_end(x["p"]) <= hz]
            hit = next((x for x in after if test(x["v"], f["value"])), None)
            if hit:
                out.update(st="met", at={"p": hit["p"], "v": hit["v"], "d": hit["d"]})
            else:
                lx = after[-1] if after else m["ser"][-1]
                out.update(st="watch", at={"p": lx["p"], "v": lx["v"], "d": lx["d"]}, n=len(after))
        else:
            want = parse_label(f["period"])
            x = next((x for x in m["ser"] if same_period(x["p"], want)), None)
            if x is None:
                lx = m["ser"][-1]
                out.update(st="pending", last={"p": lx["p"], "v": lx["v"], "d": lx["d"]})
            else:
                out.update(st="met" if test(x["v"], f["value"]) else "clear", at={"p": x["p"], "v": x["v"], "d": x["d"]})
        fals.append(out)
    trig = []
    for t in p.get("triggers") or []:
        out = {k: t[k] for k in ("metric", "threshold_pp", "threshold_pct", "base") if k in t}
        try:
            m = ctx.metric(t["metric"])
        except KeyError as x:
            trig.append({**out, "st": "unresolved", "why": x.args[0]})
            continue
        metrics.setdefault(t["metric"], fmt_metric(m))
        base = t.get("base") or {"per": qlabel(m["ser"][-1]["p"]), "v": m["ser"][-1]["v"]}
        out["base"] = base
        bk = parse_label(base["per"]) or base["per"]
        lx = m["ser"][-1]
        dpp = round(lx["v"] - base["v"], 6)
        dpct = round((lx["v"] / base["v"] - 1) * 100, 6) if base["v"] else None
        if "threshold_pp" in t:
            fired, size = abs(dpp) >= t["threshold_pp"], (abs(dpp) / t["threshold_pp"])
        else:
            fired, size = dpct is not None and abs(dpct) >= t["threshold_pct"], (abs(dpct) / t["threshold_pct"] if dpct is not None else 0)
        first = None
        if fired:  # the first print after the base that crossed the threshold
            for x in m["ser"]:
                if x["p"] <= bk:
                    continue
                d1 = x["v"] - base["v"]
                d2 = (x["v"] / base["v"] - 1) * 100 if base["v"] else None
                if ("threshold_pp" in t and abs(d1) >= t["threshold_pp"]) or ("threshold_pct" in t and d2 is not None and abs(d2) >= t["threshold_pct"]):
                    first = {"p": x["p"], "v": x["v"], "d": x["d"]}
                    break
        out.update(label=m["label"], unit=m["unit"], last={"p": lx["p"], "v": lx["v"], "d": lx["d"]}, dpp=dpp, dpct=dpct,
                   fired=bool(fired), size=round(size, 4), first=first, st="fired" if fired else "ok")
        trig.append(out)
    # next review: the earliest expected print of the companies involved (industry: of the metrics' companies), or the date
    cos = [c for c in companies(p) if c != "industry"]
    if not cos:
        for k in [f["metric"] for f in p.get("falsifiers") or []] + [t["metric"] for t in p.get("triggers") or []]:
            if k in metrics:
                try:
                    cos += [c for c in ctx.metric(k)["cos"] if c not in cos]
                except KeyError:
                    pass
    if p.get("review") == "print":
        nx = sorted(d for d in (ctx.next_print.get(c) for c in cos) if d)
        nxt, basis = (nx[0] if nx else None), "הדוח הרבעוני הבא הצפוי (לוח הדוחות)"
    else:
        nxt, basis = p.get("review"), "תאריך שנקבע"
    # the latest print after the last revision: the position is due a review (no revision or close since)
    due = None
    if p.get("review") == "print" and meta.get("revised"):
        prints = sorted(((d, c, per) for (c, per), d in ctx.prints.items() if c in cos and d and d > meta["revised"]), reverse=True)
        if prints:
            d, c, per = prints[0]
            due = {"d": d, "c": c, "per": per}
    sugg = "falsified" if any(f.get("st") == "met" for f in fals) else None
    frag, frag_now = frag_marks(ctx, cos, meta.get("revised"))
    return {"evidence": ev, "falsifiers": fals, "triggers": trig, "next_review": nxt, "review_basis": basis, "due": due,
            "drift": any(t.get("fired") for t in trig), "suggest": sugg, "involved": cos, "frag": frag, "frag_now": frag_now}


def frag_marks(ctx, cos, since):
    """module A10: the Fragility Monitor crossings (into watch / alert) of the companies involved after the position's last revision
    (each marks the position for review), and their signals in watch / alert now. A draft (no revision yet) carries only the latter."""
    F = ctx.frag
    if not F:
        return [], []
    sh = {s["id"]: s["he"] for s in F.get("sigs") or []}
    marks = [{"c": e["c"], "sig": e["src"]["sig"], "he": sh.get(e["src"]["sig"], e["src"]["sig"]), "st": e.get("fs"), "d": e["d"], "dk": e["dk"], "per": e["per"], "ev": e["id"]}
             for e in F.get("events") or [] if since and e["c"] in cos and e["d"] > since]
    now = [{"c": r["c"], "sig": f["sig"], "he": sh.get(f["sig"], f["sig"]), "st": f["st"]} for r in F.get("rows") or [] if r["c"] in cos for f in r["flags"]]
    return sorted(marks, key=lambda m: (m["d"], m["ev"])), now


def position_out(pid, pos, ctx, meta, metrics, status):
    e = evaluate(pos, ctx, meta, metrics)
    return {"id": pid, "status": status, **{k: pos.get(k) for k in ("claim", "horizon", "confidence", "direction", "mechanism", "review")},
            "mechanism_edge": pos.get("mechanism_edge"), "company": companies(pos), **meta, **e}


def hit_rate(ps):
    closed = [p for p in ps if p["outcome"]["st"] in OUTCOMES]
    def agg(xs):
        c = sum(1 for p in xs if p["outcome"]["st"] == "confirmed")
        f = sum(1 for p in xs if p["outcome"]["st"] == "falsified")
        return {"n": len(xs), "confirmed": c, "falsified": f, "expired": sum(1 for p in xs if p["outcome"]["st"] == "expired"),
                "withdrawn": sum(1 for p in xs if p["outcome"]["st"] == "withdrawn"), "hit": round(c / (c + f) * 100, 4) if c + f else None}
    return {**agg(closed), "by_conf": {k: agg([p for p in closed if p["confidence"] == k]) for k in CONF},
            "open": sum(1 for p in ps if p["outcome"]["st"] == "open")}


# ------------------------------------------------------------------------------------------------------------------ feed events
FILES = "https://mayafiles.tase.co.il/"


def feed_events(ps, ctx):
    """the position events, shaped for the delta feed (pipeline/build_feed.py merges them; check_feed.py re-reads every figure here):
    open / revise / close (the ledger dates), drift (a trigger's first crossing: that report's publication day), falsifier met,
    and review due (a print after the last revision)"""
    out = []
    for p in ps:
        if p["status"] != "published":
            continue
        c = p["company"][0] if p["company"][0] != "industry" else "market"
        src = {"k": "pos", "pid": p["id"], "rev": p["rev"]}
        to = f"/positions/{p['id']}"
        claim = p["claim"] if len(p["claim"]) <= 90 else p["claim"][:88] + "…"
        for r in p["revs"]:
            out.append({"id": f"pos:{p['id']}:r{r['rev']}", "t": "pos", "pk": "open" if r["rev"] == 1 else "revise", "d": r["date"], "dk": "pub", "c": c,
                        "per": f"r{r['rev']}", "h": f"{'עמדה חדשה' if r['rev'] == 1 else 'עדכון עמדה'}: {claim}", "src": {**src, "rev": r["rev"]}, "to": to})
        if p["outcome"]["st"] in OUTCOMES:
            o = p["outcome"]
            out.append({"id": f"pos:{p['id']}:o", "t": "pos", "pk": "close", "d": o["date"], "dk": "pub", "c": c, "per": o["st"],
                        "h": f"עמדה נסגרה ({OUT_HE[o['st']]}): {claim}", "src": src, "to": to})
            continue
        for i, t in enumerate(p["triggers"]):
            if t.get("first") and t["first"].get("d"):
                def fig(v, per, t=t):
                    return {"v": v, "u": unit_feed(t["unit"]), "s": {"k": "pos", "pid": p["id"], "m": t["metric"], "per": per}}
                out.append({"id": f"pos:{p['id']}:drift:{i}", "t": "pos", "pk": "drift", "d": t["first"]["d"], "dk": "pub", "c": c, "per": qlabel(t["first"]["p"]),
                            "h": f"סטייה בראיות: {t['label']} עבר את הסף מאז פתיחת העמדה", "src": src, "to": to,
                            "rows": [{"l": t["label"], "ab": [qlabel(t["first"]["p"]), t["base"]["per"]],
                                      "a": fig(t["first"]["v"], t["first"]["p"]), "b": fig(t["base"]["v"], parse_label(t["base"]["per"]) or t["base"]["per"])}]})
        for i, f in enumerate(p["falsifiers"]):
            if f.get("st") == "met" and f["at"].get("d"):
                out.append({"id": f"pos:{p['id']}:fals:{i}", "t": "pos", "pk": "falsifier", "d": f["at"]["d"], "dk": "pub", "c": c, "per": qlabel(f["at"]["p"]),
                            "h": f"תנאי הפרכה התקיים (הצעה: falsified, הסגירה בידי הכותב): {claim}", "src": src, "to": to,
                            "rows": [{"l": f"{f['label']} {f['op']} {f['value']}", "ab": [qlabel(f["at"]["p"])],
                                      "a": {"v": f["at"]["v"], "u": unit_feed(f["unit"]), "s": {"k": "pos", "pid": p["id"], "m": f["metric"], "per": f["at"]["p"]}}}]})
        for m in p.get("frag") or []:
            out.append({"id": f"pos:{p['id']}:frag:{m['ev']}", "t": "pos", "pk": "fragility", "d": m["d"], "dk": m["dk"], "c": c, "per": m["per"],
                        "h": f"עמדה לסקירה: {ctx.cos.get(m['c'], m['c'])} עברה ל{'התראה' if m['st'] == 'alert' else 'מעקב'} ב{m['he']} (מוניטור שבריריות)",
                        "src": src, "to": to})
        if p.get("due"):
            u = p["due"]
            out.append({"id": f"pos:{p['id']}:review:{u['c']}:{u['per']}", "t": "pos", "pk": "review", "d": u["d"], "dk": "pub", "c": c, "per": u["per"],
                        "h": f"עמדה לסקירה: דוח {qlabel(u['per'])} של {ctx.cos.get(u['c'], u['c'])} פורסם אחרי העדכון האחרון", "src": src, "to": to})
    return out


def unit_feed(u):
    return {"pct": "pct", "pp": "pp", "m": "m"}.get(u, "m")


OUT_HE = {"confirmed": "אושרה", "falsified": "הופרכה", "expired": "פג תוקף", "withdrawn": "נמשכה", "open": "פתוחה"}


# ------------------------------------------------------------------------------------------------------------------ build
def read_drafts(work=WORK):
    out = []
    if Path(work).exists():
        for f in sorted(Path(work).glob("*.json")):
            p = load(f)
            if p.get("status") == "draft":
                out.append(p)
    return out


def build(ctx, ledger=LEDGER, work=WORK, drafts=False):
    L = read_ledger(ledger)
    metrics = {}
    ps, withheld = [], []
    for pid, x in sorted(L.items()):
        if not x["revs"]:
            continue
        last = x["revs"][-1]
        pos = last["position"]
        if ABSTAIN_PHOENIX and "phoenix" in companies(pos):
            withheld.append(pid)
            continue
        o = x["outs"][-1] if x["outs"] else None
        meta = {"rev": last["rev"], "opened": x["revs"][0]["date"], "revised": last["date"],
                "revs": [{"rev": r["rev"], "date": r["date"], "note": r.get("note") or "", "hash": r["hash"], "supersedes": r.get("supersedes")} for r in x["revs"]],
                "outcome": {"st": o["outcome"], "date": o["date"], "note": o["note"]} if o else {"st": "open"},
                "outcomes": [{"seq": y["seq"], "date": y["date"], "st": y["outcome"], "note": y["note"]} for y in x["outs"]]}
        ps.append(position_out(pid, pos, ctx, meta, metrics, "published"))
    if drafts:
        for d in read_drafts(work):
            if d["id"] in L:
                continue
            if ABSTAIN_PHOENIX and "phoenix" in companies(d):
                continue
            pos = freeze({k: v for k, v in json.loads(json.dumps(d)).items() if k != "status"}, ctx)
            meta = {"rev": 0, "opened": None, "revised": None, "revs": [], "outcome": {"st": "open"}, "outcomes": [], "problems": validate(pos, ctx)}
            ps.append(position_out(d["id"], pos, ctx, meta, metrics, "draft"))
    out = {
        "v": 1,
        "asof": {"lens": ctx.lens["meta"]["last_rep"], "kpi": ctx.kpi.get("asof")},
        "drafts": bool(drafts),
        "abstain": {"phoenix": ABSTAIN_TEXT} if ABSTAIN_PHOENIX else {},
        "withheld": len(withheld),
        "rules": {"hit": "אושרו ÷ (אושרו + הופרכו), עמדות סגורות בלבד; פג תוקף ונמשכו נספרות בנפרד",
                  "falsifier": "תנאי שהתקיים מציע 'הופרכה'; הסגירה היא רישום מתוארך של הכותב, לעולם לא אוטומטית",
                  "drift": "מדד שזז מעבר לסף מאז פתיחת העמדה (בסיס מוקפא בפרסום)",
                  "fragility": "חברה בעמדה שעברה למעקב או להתראה במוניטור השבריריות אחרי העדכון האחרון: העמדה לסקירה"},
        "cos": {**{"industry": "ענפי"}, **ctx.cos},
        "groups": ctx.GN,
        "metrics": metrics,
        "positions": ps,
        "hit": hit_rate([p for p in ps if p["status"] == "published"]),
        "events": feed_events(ps, ctx),
    }
    return out, L


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--drafts", action="store_true", help="DEV ONLY: include the candidate drafts (the gate fails while they are in the file)")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    ctx = Ctx()
    out, L = build(ctx, drafts=a.drafts and not a.check)
    if a.check:
        bad = ledger_problems(L, ctx)
        if ABSTAIN_PHOENIX:
            bad += [f"{pid}: a phoenix position in the ledger while ABSTAIN_PHOENIX is on" for pid, x in L.items()
                    if x["revs"] and "phoenix" in companies(x["revs"][-1]["position"])]
        try:
            disk = load(OUT)
        except (OSError, ValueError):
            disk = None
        if disk is None:
            bad.append("positions.json missing")
        elif disk.get("drafts") or any(p.get("status") != "published" for p in disk.get("positions", [])):
            bad.append("positions.json carries drafts (a --drafts dev build): rebuild without --drafts")
        elif dump(disk) != dump(out):
            bad.append("positions.json differs from a rebuild")
        n = sum(len(x["revs"]) + len(x["outs"]) for x in L.values())
        print(f"positions: {len(out['positions'])} published, {n} ledger entries, {len(bad)} problems" + (f"; {bad[0]}" if bad else ""))
        for b in bad[:20]:
            print("FAIL", b)
        return 1 if bad else 0
    OUT.write_text(dump(out), encoding="utf-8")
    pub = sum(1 for p in out["positions"] if p["status"] == "published")
    print(f"positions.json: {pub} published, {len(out['positions']) - pub} drafts{' (DEV: not deployable)' if a.drafts else ''}, "
          f"{len(out['metrics'])} metrics, {len(out['events'])} feed events")
    return 0


if __name__ == "__main__":
    sys.exit(main())
