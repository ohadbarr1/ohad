"""The unified metric registry for the peer table: web/public/data/peers/registry.json + one small file per metric (peers/m/<id>.json).

Inputs are the site's own published outputs, so the registry never disagrees with the pages that show the same figure:
  ifrs:*   series/<company>.json   extracted IFRS 17 / IFRS 4 facts, group and segment rows (build_series.py)
  fs:*     lines.json              statement roles across insurers and fund houses (build_hist.py)
  xbrl:*   kpi.json                headline figures tagged in the electronic filing (build_kpi.py)
  lts:*    lts.json                long-term-savings sector metrics built from the managers' reports (build_lts.py)
  econ:*   savings_econ.json       managers' P&L by activity (build_savings.py)
  sop:*    sop/<company>.json      sources of profit and segment results (build_sop.py)
  reg:*    market.json             regulator fund files, aggregated per group and quarter with the site's own arithmetic (market.ts)
Each metric carries: label, topic group, unit, kind (f flow = additive, s stock = balance, r rate = never summed), source,
coverage, and definition breaks. Each cell: [period, value, page, url index, flags, aux]; flags 1 derived, 2 IFRS 4, 4 sign turned,
8 restated, 16 read from a chart or text, 32 XBRL tag corrected, 64 comparative column of a later report; aux = MAYA report id (xbrl)
or regulator month index (reg). Periods: 2026Q2 (quarter flow or quarter-end balance), 2026H1 / 2026H2, 2026FY.
"""
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "FY": "12-31"}
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "peers"
(OUT / "m").mkdir(parents=True, exist_ok=True)
for f in (OUT / "m").glob("*.json"):
    f.unlink()

reg_companies = json.loads((DATA / "companies" / "index.json").read_text(encoding="utf-8"))
NAME = {c["id"]: c["name_he"] for c in reg_companies}
KIND = {c["id"]: ("ins" if c["kind"] == "insurance_group" else "fund") for c in reg_companies}
SHORT = {"menora": "מנורה", "altshuler": "אלטשולר", "yelin": "ילין", "idi": "ביטוח ישיר", "more_gemel": "מור גמל"}
ALIAS = {"direct": "idi"}
GROUP_ID = {"הפניקס": "phoenix", "הראל": "harel", "מגדל": "migdal", "כלל": "clal", "מנורה מבטחים": "menora", "הכשרה": "hachshara", "איילון": "ayalon", "ביטוח ישיר": "idi",
            "מיטב": "meitav", "אלטשולר שחם": "altshuler", "מור": "more", "אנליסט": "analyst", "ילין לפידות": "yelin", "אינפיניטי": "infinity", "גלובלנט": "globalnet"}

# Hebrew metric labels, read from the site's own dictionary so a metric is named the same everywhere
labels_ts = (ROOT / "web" / "src" / "lib" / "labels.ts").read_text(encoding="utf-8")
block = labels_ts.split("export const METRIC_HE", 1)[1].split("};", 1)[0]
METRIC_HE = {m.group(1) or m.group(2): m.group(3) for m in re.finditer(r"(?:'([^']+)'|([A-Za-z0-9_]+)):\s*'([^']*)'", block)}

metrics = []          # registry entries
files = {}            # file id -> {"u": [...], "e": {...}}


def fid(mid):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", mid.replace(":", "-").replace("@", "."))


class Chunk:
    def __init__(self):
        self.urls, self.ui, self.e = [], {}, {}

    def url(self, u):
        if not u:
            return None
        if u not in self.ui:
            self.ui[u] = len(self.urls)
            self.urls.append(u)
        return self.ui[u]

    def cell(self, ent, p, v, pg=None, u=None, fl=0, aux=None, meta=None, parts=None):
        e = self.e.setdefault(ent, {"c": []})
        if meta:
            e.update(meta)
        c = [p, round(v, 4), pg, self.url(u), fl]
        if aux is not None or parts:
            c.append(aux)
        if parts:
            c.append(parts)  # [label, value, page, url index]: a printed sum's components
        e["c"].append(c)


def add(mid, label, group, src, unit, kind, chunk, note=None, breaks=None, std=None, min_ents=1):
    ents = {k: v for k, v in chunk.e.items() if v["c"]}
    if len(ents) < min_ents:
        return
    for v in ents.values():
        # one cell per period; sorted oldest first
        seen = {}
        for c in v["c"]:
            seen[c[0]] = c
        v["c"] = sorted(seen.values(), key=lambda c: pkey(c[0]))
    ps = sorted({c[0] for v in ents.values() for c in v["c"]}, key=pkey)
    f = fid(mid)
    (OUT / "m" / f"{f}.json").write_text(json.dumps({"u": chunk.urls, "e": ents}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    m = {"id": mid, "l": label, "g": group, "src": src, "u": unit, "k": kind, "f": f, "n": len(ents), "r": [ps[0], ps[-1]], "e": sorted(ents)}
    if note:
        m["nt"] = note
    if breaks:
        m["br"] = breaks
    if std:
        m["std"] = std
    metrics.append(m)


def pkey(p):
    y, t = p[:4], p[4:]
    order = {"Q1": 1, "Q2": 2, "H1": 2.1, "Q3": 3, "Q4": 4, "H2": 4.1, "FY": 4.2}
    return (int(y), order.get(t, 9))


def qof(d):
    """a quarter-end date -> 2026Q2"""
    q = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}.get(d[5:10])
    return f"{d[:4]}{q}" if q else None


# ---------------------------------------------------------------- ifrs: series/<company>.json
SEG_HE = {"group": "", "life": " · חיים וחיסכון", "health": " · בריאות", "pc": " · ביטוח כללי", "savings": " · פנסיה וגמל"}
B_ORDER = ["net", "na", "gross", "reinsurance"]
TOPIC_IFRS = {
    "pl": ["profit", "comprehensive", "revenue", "service", "investment", "finance", "reinsurance", "premium", "income_tax", "management_fees", "onerous", "rev_", "adjusted"],
    "csm": ["csm_", "risk_adjustment", "reins_expense"],
    "bs": ["equity", "assets", "aum", "dividend", "roe", "solvency", "scr", "mcr", "own_funds"],
}
RATE = re.compile(r"roe|ratio|pct|_rate$|margin")
OPENING = {"csm_opening", "ra_opening", "future_profit_opening"}
TURN = {"csm_release", "rev_csm_release", "reins_expense_csm_release"}
series = {}
for f in sorted((DATA / "series").glob("*.json")):
    if f.stem == "index":
        continue
    series[f.stem] = json.loads(f.read_text(encoding="utf-8"))["rows"]
by_key = defaultdict(dict)  # (m, seg) -> company -> best row
for comp, rows in series.items():
    for r in rows:
        if ":" in r["m"] or r["g"] not in SEG_HE:
            continue
        if r["g"] != "group" and r["s"] != r["g"] and r["s"] not in ("life", "health", "pc"):
            continue
        k, cur = (r["m"], r["g"]), by_key[(r["m"], r["g"])].get(comp)
        nq = lambda x: sum(1 for p in x["vals"] if not p.endswith("FY"))
        rank = lambda x: (-nq(x), B_ORDER.index(x["b"]) if x["b"] in B_ORDER else 9, x["s"] != x["g"])
        if cur is None or rank(r) < rank(cur):
            by_key[k][comp] = r
# the extracted facts of every IFRS 17 report (ifrs_<period>.json) fill what the quarterly record leaves out: half-year (YTD at June),
# annual and quarter windows, and the comparative columns. Only single printed rows (no table parts, no transition or model facts).
ifrs_meta = json.loads((DATA / "ifrs.json").read_text(encoding="utf-8"))
furl = {(f["company"], f["period"]): f.get("url") for f in ifrs_meta["files"]}
fx = defaultdict(dict)  # (company, metric, segment, basis) -> period -> cell
for per in sorted({f["period"] for f in ifrs_meta["files"]}):
    path = DATA / f"ifrs_{per}.json"
    if not path.exists():
        continue
    end = f"{per[:4]}-{END[per[4:]]}"
    for x in json.loads(path.read_text(encoding="utf-8")):
        if x.get("tr") or x.get("model") or x.get("bk") or x.get("dv") is not None or x["s"] != x["g"] or x["g"] not in SEG_HE or ":" in x["m"]:
            continue
        w, d = x["w"], x["d"]
        k = qof(d) if w in ("q", "instant") else f"{d[:4]}FY" if w == "fy" and d[5:10] == "12-31" else f"{d[:4]}H1" if w == "ytd" and d[5:10] == "06-30" else qof(d) if w == "ytd" and d[5:10] == "03-31" else None
        if not k or (w == "instant") != (k[4] == "Q" and w == "instant"):
            continue
        own = d[:10] == end
        cell = {"v": x["v"], "pg": x.get("pg"), "u": x.get("u") or furl.get((x["c"], per)), "std": "IFRS 17", "own": own, "from": per, "inst": w == "instant"}
        if x.get("src") and x["src"] != "table":
            cell["src"] = x["src"]
        slot = fx[(x["c"], x["m"], x["g"], x.get("b") or "na")]
        cur = slot.get(k)
        if cur is None or (own and not cur["own"]) or (own == cur["own"] and per > cur["from"]):
            slot[k] = cell
for (c, m, g, b), cells in fx.items():
    key = (m, g)
    row = by_key.get(key, {}).get(c)
    if row is not None and row["b"] != b:
        continue
    inst = all(x["inst"] for x in cells.values())
    if row is None:
        others = [k2 for k2 in fx if k2[0] == c and k2[1] == m and k2[2] == g]
        if sorted(others, key=lambda k2: B_ORDER.index(k2[3]) if k2[3] in B_ORDER else 9)[0][3] != b:
            continue
        row = {"m": m, "s": g, "g": g, "b": b, "vals": {}, **({"w": "i"} if inst else {})}
        by_key[key][c] = row
    vals = dict(row["vals"])
    for k, x in cells.items():
        if k in vals or (row.get("w") == "i") != x["inst"]:
            continue
        vals[k] = {"v": round(x["v"], 3), "pg": x["pg"], "u": x["u"], "std": "IFRS 17", **({"cmp": 1} if not x["own"] else {}), **({"src": x["src"]} if x.get("src") else {})}
    row["vals"] = dict(sorted(vals.items()))

# a filer that prints CSM for life and for health but no group line: the group figure is their sum, on one basis (flag 1, parts kept)
summed = defaultdict(dict)
for (m, seg), comps in list(by_key.items()):
    if seg != "group" or not m.startswith(("csm_", "risk_adjustment")):
        continue
    for comp in series:
        lr, hr, gr = by_key.get((m, "life"), {}).get(comp), by_key.get((m, "health"), {}).get(comp), comps.get(comp)
        if not lr or not hr or lr["b"] != hr["b"] or (gr and gr["b"] != lr["b"]):
            continue
        vals = dict(gr["vals"]) if gr else {}
        for p, a in lr["vals"].items():
            b = hr["vals"].get(p)
            if p not in vals and b and a.get("std") == b.get("std"):
                vals[p] = {"v": round(a["v"] + b["v"], 3), "std": a.get("std"), "parts": [("חיים וחיסכון", a), ("בריאות", b)], "der": 1}
        if vals and (not gr or len(vals) > len(gr["vals"])):
            comps[comp] = {"m": m, "s": "life+health", "g": "group", "b": lr["b"], "vals": dict(sorted(vals.items())), **({"w": "i"} if lr.get("w") == "i" or (gr and gr.get("w") == "i") else {})}
for (m, seg), comps in sorted(by_key.items()):
    if len(comps) < 3 or (seg != "group" and not m.startswith(("csm_", "insurance_", "comprehensive_income_before_tax", "gross_premiums", "losses_on", "risk_adj", "net_reinsurance"))):
        continue
    label = METRIC_HE.get(m)
    if not label or m.endswith("_after_period"):
        continue
    inst = any(r.get("w") == "i" for r in comps.values())
    kind = "s" if inst else "r" if RATE.search(m) or m in OPENING else "f"
    ch = Chunk()
    bases = Counter(r["b"] for r in comps.values())
    for comp, r in comps.items():
        meta = {"b": r["b"]} if r["b"] != "na" else None
        for p, c in r["vals"].items():
            if kind == "s" and p.endswith("FY"):
                continue  # a balance at the year end is the Q4 figure
            fl = (1 if c.get("der") else 0) | (2 if c.get("std") == "IFRS 4" else 0) | (16 if c.get("src") else 0) | (64 if c.get("cmp") else 0)
            v = c["v"]
            if m in TURN and v < 0:  # a release printed as a reduction of the CSM in the roll-forward: shown as the amount released (flag 4)
                v, fl = -v, fl | 4
            if c.get("parts"):
                sg = -1 if (m in TURN and c["v"] < 0) else 1
                ch.cell(comp, p, v, None, None, fl, parts=[[lab, x["v"] * sg, x.get("pg"), ch.url(x.get("u"))] for lab, x in c["parts"]])
            else:
                ch.cell(comp, p, v, c.get("pg"), c.get("u"), fl, meta=meta)
    topic = "seg" if seg != "group" else next((t for t, keys in TOPIC_IFRS.items() if any(m.startswith(x) or x in m for x in keys)), "pl")
    BH = {"na": "ללא פיצול בסיס", "net": "בשייר", "gross": "ברוטו", "reinsurance": "ביטוח משנה"}
    note = "סכום כפי שהודפס בטבלת הקבוצה; כל חברה על הבסיס שהיא מדפיסה" + (f" (רוב החברות: {BH.get(bases.most_common(1)[0][0], bases.most_common(1)[0][0])})" if len(bases) > 1 else "")
    add(f"ifrs:{m}" + ("" if seg == "group" else f"@{seg}"), label + SEG_HE[seg], topic, "ifrs", "pct" if RATE.search(m) else "m", kind, ch, note=note, std="17" if m.startswith(("csm_", "insurance_", "rev_", "risk_adj", "reins_")) else None)

# ---------------------------------------------------------------- fs: lines.json
lines = json.loads((DATA / "lines.json").read_text(encoding="utf-8"))
SHEET_TOPIC = {"X.רווח_והפסד": "pl", "X.מאזן": "bs", "X.תזרים_מזומנים": "cf"}
for role, label, sheet in lines["roles"]:
    data = lines["data"].get(role) or {}
    if not data:
        continue
    ch, unit = Chunk(), None
    for comp, line in data.items():
        unit = line["unit"]
        for pi, v, pg, ui, fl in line["cells"]:
            t, end = lines["periods"][pi]
            if t == "I" or sheet == "X.מאזן":
                p = qof(end)
            elif t == "Q":
                p = qof(end)
            elif t == "H":
                p = f"{end[:4]}{'H1' if end[5:7] == '06' else 'H2' if end[5:7] == '12' else ''}"
                if len(p) != 6:
                    p = None
            elif t == "FY":
                p = f"{end[:4]}FY"
            else:
                p = None
            if not p:
                continue
            val = v / 1000 if line["unit"] == "k" else v
            ch.cell(comp, p, val, pg, lines["urls"][ui] if ui is not None else None, fl, meta={"l": line["label"]})
    kind = "s" if sheet == "X.מאזן" else "r" if unit in ("nis", "pct") else "f"
    add(f"fs:{role}", label, SHEET_TOPIC.get(sheet, "pl"), "fs", {"k": "m", "nis": "nis", "pct": "pct"}[unit], kind, ch,
        note="כל חברה לפי השורה שהיא מדפיסה בדוח הכספי (הניסוח בריחוף)")

# ---------------------------------------------------------------- xbrl: kpi.json
kpi = json.loads((DATA / "kpi.json").read_text(encoding="utf-8"))
XL = {"profit": ("רווח נקי לבעלי המניות", "pl", "f", "m"), "oci": ("רווח כולל לבעלי המניות", "pl", "f", "m"), "pretax": ("רווח לפני מס", "pl", "f", "m"),
      "revenue": ("סך ההכנסות", "pl", "f", "m"), "cfo": ("תזרים מפעילות שוטפת", "cf", "f", "m"), "eps": ("רווח בסיסי למניה", "pl", "r", "nis"),
      "equity": ("הון לבעלי המניות", "bs", "s", "m"), "assets": ("סך הנכסים", "bs", "s", "m")}
for key, (label, topic, kind, unit) in XL.items():
    ch = Chunk()
    for comp, d in kpi["companies"].items():
        vals = d["values"].get(key)
        if not vals:
            continue
        canon = (d.get("canon") or {}).get(key, {})
        fix = d.get("fix") or {}
        for i, p in enumerate(d["periods"]):
            v = vals[i]
            st = (d.get("status") or [None] * len(d["periods"]))[i]
            if v is None or st == "withheld" or (fix.get(p, {}).get("t") == "withheld"):
                continue
            if kind == "s" and p.endswith("FY"):
                p2 = p[:4] + "Q4"
            else:
                p2 = p
            rid = (d.get("rid") or [None] * len(d["periods"]))[i]
            scale = 1000 if unit == "m" else 1
            if p in canon:  # the printed figure, where it and the tag differ by rounding
                cv = canon[p]
                ch.cell(comp, p2, cv[0] / scale, cv[3], f"https://maya.tase.co.il/he/reports/{cv[2]}", 0)
                continue
            fl = 32 if st == "corrected" or fix.get(p, {}).get("t") == "diff" else 0
            ch.cell(comp, p2, v / scale, None, None, fl, aux=rid)
    add(f"xbrl:{key}", label + " (XBRL)", topic, "xbrl", unit, kind, ch, note=f"מושג XBRL: {kpi['concepts'].get(key, key)}")

# ---------------------------------------------------------------- lts: lts.json
lts = json.loads((DATA / "lts.json").read_text(encoding="utf-8"))
BN, MN, PCT = "bn", "m", "pct"
LTS = {
    "am.aum": ("ניהול נכסים: נכס מנוהל", BN, "s"), "am.fees": ("ניהול נכסים: הכנסות מדמי ניהול", MN, "f"), "am.gross": ("ניהול נכסים: רווח גולמי", MN, "f"),
    "am.op": ("ניהול נכסים: רווח תפעולי", MN, "f"), "am.rev_rate": ("ניהול נכסים: שיעור הכנסות מהנכס", PCT, "r"), "am.gross_m": ("ניהול נכסים: מרווח גולמי מהנכס", PCT, "r"),
    "am.op_m": ("ניהול נכסים: מרווח תפעולי מהנכס", PCT, "r"), "am.mix.pen": ("תמהיל נכסים: פנסיה", PCT, "s"), "am.mix.gem": ("תמהיל נכסים: גמל", PCT, "s"), "am.mix.ic": ("תמהיל נכסים: חוזי השקעה", PCT, "s"),
    "ic.aum": ("פוליסות השקעה: נכס מנוהל", MN, "s"), "ic.dep": ("פוליסות השקעה: הפקדות", MN, "f"), "ic.fees": ("פוליסות השקעה: דמי ניהול", MN, "f"),
}
for fam, nm in (("pen", "פנסיה"), ("gem", "גמל")):
    LTS.update({
        f"{fam}.aum": (f"{nm}: נכס מנוהל", BN, "s"), f"{fam}.aum.share": (f"{nm}: נתח שוק בנכס", PCT, "s"), f"{fam}.fees": (f"{nm}: הכנסות מדמי ניהול", MN, "f"),
        f"{fam}.sm": (f"{nm}: מכירה ושיווק", MN, "f"), f"{fam}.ga": (f"{nm}: הנהלה וכלליות", MN, "f"), f"{fam}.op": (f"{nm}: רווח מפעילות", MN, "f"),
        f"{fam}.tr_in": (f"{nm}: ניוד פנימה", BN, "f"), f"{fam}.tr_out": (f"{nm}: ניוד החוצה", BN, "f"), f"{fam}.tr_net": (f"{nm}: ניוד נטו", BN, "f"),
        f"{fam}.out_rate": (f"{nm}: שיעור ניוד יוצא, שנתי", PCT, "r"), f"{fam}.fee_a": (f"{nm}: דמי ניהול מנכסים", PCT, "r"),
        f"{fam}.gross_m": (f"{nm}: מרווח גולמי מהנכס", PCT, "r"), f"{fam}.op_m": (f"{nm}: מרווח מפעילות מהנכס", PCT, "r"),
        f"{fam}.sm_fees": (f"{nm}: מכירה ושיווק מדמי הניהול", PCT, "r"), f"{fam}.sm_aum": (f"{nm}: מכירה ושיווק מהנכס", PCT, "r"),
        f"{fam}.ga_fees": (f"{nm}: הנהלה וכלליות מדמי הניהול", PCT, "r"), f"{fam}.ga_aum": (f"{nm}: הנהלה וכלליות מהנכס", PCT, "r"),
    })
LTS.update({"pen.nb": ("פנסיה: פרמיה משונתת, עסק חדש", BN, "f"), "pen.nb.share": ("פנסיה: נתח בעסק חדש", PCT, "r"), "pen.fee_d": ("פנסיה: דמי ניהול מהפקדות", PCT, "r"),
            "gem.dep": ("גמל: הפקדות שוטפות", BN, "f")})
lts_cells = defaultdict(list)
for m, c, p, v, s in lts["facts"]:
    lts_cells[m].append((c, p, v))


def lts_period(p):
    if re.match(r"^\d{4}-\d\d$", p):
        return qof(p + ("-31" if p[5:] in ("03", "12") else "-30"))
    if p.startswith("FY"):
        return f"{p[2:]}FY"
    w, y = p.split("-")
    return {"Q1": f"{y}Q1", "Q2": f"{y}Q2", "Q3": f"{y}Q3", "Q4": f"{y}Q4", "H1": f"{y}H1"}.get(w)


for m, (label, unit, kind) in LTS.items():
    ch = Chunk()
    for c, p, v in lts_cells.get(m, []):
        if c == "all":
            continue
        pp = lts_period(p)
        if not pp:
            continue
        ent = ALIAS.get(c, c)
        ch.cell(ent, pp, v, None, None, 1, meta={"sid": c} if c != ent else None)
    add(f"lts:{m}", label, "lts", "lts", unit, kind, ch, note=lts.get("notes", {}).get(m) or "מחושב מדוחות החברות המנהלות; הנוסחה והרכיבים בכל תא", min_ents=3)

# ---------------------------------------------------------------- econ: savings_econ.json
econ = json.loads((DATA / "savings_econ.json").read_text(encoding="utf-8"))
ACT = {"pension": "פנסיה", "provident": "גמל והשתלמות", "combined": "פנסיה וגמל", "entity": "כלל החברה", "investment_contracts": "פוליסות חיסכון"}
EM = {"fees": ("דמי ניהול", "m", "f"), "sm": ("שיווק ומכירה", "m", "f"), "ga": ("הנהלה וכלליות", "m", "f"), "expenses": ("הוצאות", "m", "f"), "profit": ("רווח לפני מס", "m", "f"),
      "margin": ("שיעור רווח", "pct", "r"), "exp_ratio": ("הוצאות / דמי ניהול", "pct", "r"), "sm_pct": ("שיווק / דמי ניהול", "pct", "r"), "ga_pct": ("הנה\"כ / דמי ניהול", "pct", "r"),
      "aum": ("נכסים מנוהלים", "m", "s"), "deposits": ("הפקדות", "m", "f")}
eg = defaultdict(dict)
for r in econ["rows"]:
    if r["m"] not in EM or r["a"] not in ACT:
        continue
    w, d = r["w"], r["d"]
    p = qof(d) if w in ("q", "instant") else f"{d[:4]}FY" if w == "fy" else f"{d[:4]}H1" if w == "ytd" and d[5:10] == "06-30" else None
    if not p:
        continue
    k = (r["m"], r["a"])
    cur = eg[k].get((r["c"], p))
    if cur is None or r["file"] > cur["file"]:  # the latest report's figure (restated comparatives win)
        eg[k][(r["c"], p)] = {**r, "p": p}
for (m, a), cells in sorted(eg.items()):
    ch = Chunk()
    for (c, p), r in cells.items():
        ch.cell(c, p, r["v"], r.get("pg"), r.get("url"), (1 if r.get("der") else 0) | (16 if r.get("src") else 0) | (64 if r["file"][:4] + r["file"][4:] != r["pk"] and r["pk"] != r["file"] else 0), meta={"l": r.get("l") or ""})
    label, unit, kind = EM[m]
    add(f"econ:{m}@{a}", f"{label} · {ACT[a]}", "econ", "econ", unit, kind, ch, note="רווח והפסד של החברה המנהלת לפי פעילות, מתוך הדוח הכספי", min_ents=3)

# ---------------------------------------------------------------- sop: sop/<company>.json
SEG_SLUG = {"life": "life", "health": "health", "pc": "pc", "group": "group", "investment_contracts": "ic",
            "pc:רכב חובה": "pc.motor_comp", "pc:רכב רכוש": "pc.motor_prop", "pc:אחר": "pc.other",
            "life:פוליסות הכוללות רכיב חיסכון תלוי תשואה": "life.sav_linked", "life:פוליסות הכוללות רכיב חיסכון שאינו תלוי תשואה": "life.sav_guar",
            "life:פוליסות ללא רכיב חיסכון": "life.risk", "health:הוצאות רפואיות ונכויות קבוצתי": "health.med_grp", "health:הוצאות רפואיות ונכויות פרט": "health.med_ind",
            "health:סיעודי פרט": "health.ltc_ind"}
SEG_LABEL = {"life": "חיים וחיסכון", "health": "בריאות", "pc": "ביטוח כללי", "group": "קבוצה", "ic": "חוזי השקעה", "pc.motor_comp": "רכב חובה", "pc.motor_prop": "רכב רכוש",
             "pc.other": "כללי אחר", "life.sav_linked": "חיסכון תלוי תשואה", "life.sav_guar": "חיסכון שאינו תלוי תשואה", "life.risk": "ללא רכיב חיסכון",
             "health.med_grp": "הוצאות רפואיות, קבוצתי", "health.med_ind": "הוצאות רפואיות, פרט", "health.ltc_ind": "סיעודי פרט"}
SOP_M = {"comprehensive_income_before_tax": "רווח כולל לפני מס", "insurance_revenue": "הכנסות משירותי ביטוח", "insurance_service_result": "תוצאות שירותי ביטוח",
         "gross_written_premiums": "פרמיות ברוטו", "combined_ratio": "Combined ratio", "new_business_annualized_premiums": "פרמיה משונתת, עסק חדש"}
sop_cells = defaultdict(dict)
for f in sorted((DATA / "sop").glob("*.json")):
    if f.stem == "index":
        continue
    for per, blk in json.loads(f.read_text(encoding="utf-8")).items():
        for x in blk["facts"]:
            slug = SEG_SLUG.get(x["s"])
            if not slug or x["m"] not in SOP_M:
                continue
            w, d = x["w"], x["d"]
            p = qof(d) if w in ("q", "instant") else f"{d[:4]}FY" if w == "fy" else f"{d[:4]}H1" if w == "ytd" and d[5:10] == "06-30" else None
            if not p:
                continue
            k, cur = (x["m"], slug), sop_cells[(x["m"], slug)].get((f.stem, p))
            rank = lambda y: B_ORDER.index(y.get("b") or "na") if (y.get("b") or "na") in B_ORDER else 9
            if cur is None or rank(x) < rank(cur):
                sop_cells[k][(f.stem, p)] = {**x, "url": blk.get("url")}
for (m, slug), cells in sorted(sop_cells.items()):
    ch = Chunk()
    for (c, p), x in cells.items():
        ch.cell(c, p, x["v"], x.get("pg"), x.get("url"), 0, meta={"b": x["b"]} if x.get("b") not in (None, "na") else None)
    kind = "r" if m == "combined_ratio" else "f"
    add(f"sop:{m}@{slug}", f"{SOP_M[m]} · {SEG_LABEL[slug]}", "seg", "sop", "pct" if kind == "r" else "m", kind, ch, note="פילוח מגזרי מתוך הדוח (מגזרי פעילות ומקורות רווח)", std="17", min_ents=3)

# ---------------------------------------------------------------- reg: market.json
mk = json.loads((DATA / "market.json").read_text(encoding="utf-8"))
P, groups = mk["periods"], mk["groups"]
fam_of = [p["family"] for p in mk["products"]]
SETS = {"all": None, "pension": "pension", "gemel": "gemel", "insurance": "insurance"}
SET_ID = {"all": "all", "pension": "fam:pension", "gemel": "fam:gemel", "insurance": "fam:insurance"}
SET_HE = {"all": "כל המוצרים", "pension": "פנסיה", "gemel": "גמל והשתלמות", "insurance": "ביטוח-נט"}
cell = defaultdict(lambda: [0.0] * 10)  # (pi, set, g) -> a, af, dep, wd, tr, fa, fn, fd
for r in mk["rows"]:
    pi, prod, g = r[0], r[1], r[2]
    fam = fam_of[prod]
    for s, want in SETS.items():
        if want and fam != want:
            continue
        for gg in (g, -1):
            o = cell[(pi, s, gg)]
            o[0] += r[3]
            if fam != "insurance":
                o[1] += r[3]
            o[2] += r[4]; o[3] += r[5]; o[4] += r[6]; o[5] += r[7]; o[6] += r[8]; o[7] += r[9]


def flows(pi, n, s, g):
    if pi - n + 1 < 0:
        return None
    org = tr = 0.0
    for i in range(pi - n + 1, pi + 1):
        c = cell.get((i, s, g))
        if not c or not (c[1] > 0) or c[5] < 0.98 * c[1]:
            return None
        org += c[2] - c[3]; tr += c[4]
    return org, tr


REG = {"assets": ("נכסים מנוהלים", "bn", "s"), "share": ("נתח שוק בנכסים", "pct", "s"), "netflow": ("צבירה נטו כולל ניוד", "bn", "f"),
       "organic": ("צבירה אורגנית (הפקדות פחות משיכות)", "bn", "f"), "transfers": ("ניוד נטו", "bn", "f"), "fee": ("דמי ניהול ממוצעים", "pct", "s")}
breaks = mk.get("breaks") or []
for s in SETS:
    for key, (label, unit, kind) in REG.items():
        if s == "insurance" and kind == "f":
            continue  # the insurance file publishes no flows
        ch = Chunk()
        for gi, gname in enumerate(groups):
            ent = GROUP_ID.get(gname)
            if not ent:
                continue
            for pi, ym in enumerate(P):
                mo = ym % 100
                if mo % 3:
                    continue
                y = ym // 100
                c = cell.get((pi, s, gi))
                if not c or c[0] <= 0:
                    continue
                q = f"{y}Q{mo // 3}"
                if key == "assets":
                    ch.cell(ent, q, c[0] / 1000, aux=pi)
                elif key == "share":
                    m_all = cell.get((pi, s, -1))
                    if m_all and m_all[0] > 0:
                        ch.cell(ent, q, c[0] / m_all[0] * 100, aux=pi)
                elif key == "fee":
                    if c[7] > 0:
                        ch.cell(ent, q, c[6] / c[7], aux=pi)
                else:
                    wins = [(q, 3)] + ([(f"{y}H1", 6)] if mo == 6 else []) + ([(f"{y}FY", 12)] if mo == 12 else [])
                    for pp, n in wins:
                        f = flows(pi, n, s, gi)
                        if f:
                            v = f[0] if key == "organic" else f[1] if key == "transfers" else f[0] + f[1]
                            ch.cell(ent, pp, v / 1000, aux=pi)
        brs = []
        for b in breaks:
            if (b["metric"] == key or (key == "fee" and "fee" in b["metric"])) and (s == "all" or b["family"] == s):
                ym = int(b["from"])
                brs.append({"p": f"{ym // 100}Q{(ym % 100 - 1) // 3 + 1}", "m": f"{ym % 100:02d}/{str(ym // 100)[2:]}", "nt": b["note"]})
        add(f"reg:{key}@{s}", f"{label} · {SET_HE[s]}", "reg", "reg", unit, kind, ch, note="רשות שוק ההון: גמל-נט, פנסיה-נט, ביטוח-נט; מצטבר לפי קבוצה, סוף רבעון", breaks=brs or None)

# kind: f flow (additive), s balance or a rate measured at a date (read at the period end), r a rate of a period (never summed)
# ---------------------------------------------------------------- registry
ents_used = sorted({e for m in metrics for e in m["e"]})
entities = [{"id": c["id"], "n": NAME[c["id"]], **({"sh": SHORT[c["id"]]} if c["id"] in SHORT else {}), "k": KIND[c["id"]], "mg": c.get("market_group")} for c in reg_companies if c["id"] in ents_used]
ins7 = ["phoenix", "harel", "migdal", "clal", "menora", "hachshara", "ayalon"]
sets = [
    {"id": "ins", "n": "7 המבטחות", "ids": ins7},
    {"id": "big5", "n": "חמש הגדולות", "ids": ["phoenix", "harel", "migdal", "clal", "menora"]},
    {"id": "lts", "n": "מנהלי חיסכון", "ids": ["phoenix", "harel", "migdal", "clal", "menora", "meitav", "altshuler", "more", "analyst", "yelin"]},
    {"id": "fund", "n": "בתי השקעות", "ids": [e["id"] for e in entities if e["k"] == "fund" and e["id"] != "more_gemel"]},
    {"id": "all", "n": "כולן", "ids": [e["id"] for e in entities]},
]
groups_he = [["pl", "רווח והפסד"], ["bs", "מאזן, הון וכושר פירעון"], ["csm", "IFRS 17 · CSM"], ["seg", "מגזרים"], ["cf", "תזרים"], ["lts", "חיסכון ארוך טווח"], ["econ", "כלכלת החברה המנהלת"], ["reg", "רגולטור"]]
src_he = {"ifrs": "דוחות · IFRS 17", "fs": "דוחות כספיים", "xbrl": "XBRL", "lts": "דוחות החברות המנהלות", "econ": "דוחות החברות המנהלות", "sop": "פילוח מגזרי", "reg": "רשות שוק ההון"}
order = {g: i for i, (g, _) in enumerate(groups_he)}
eidx = {e["id"]: i for i, e in enumerate(entities)}
notes = []
for m in metrics:
    m["e"] = [eidx[x] for x in m["e"]]
    if "nt" in m:
        if m["nt"] not in notes:
            notes.append(m["nt"])
        m["nt"] = notes.index(m["nt"])
metrics.sort(key=lambda m: (order.get(m["g"], 99), m["src"], m["id"]))
reg_out = {
    "asof": date.today().isoformat(), "entities": entities, "sets": sets, "groups": groups_he, "src": src_he, "metrics": metrics, "notes": notes,
    "reg": {"p0": P[0], "groups": groups},
}
(OUT / "registry.json").write_text(json.dumps(reg_out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
size = sum(f.stat().st_size for f in (OUT / "m").glob("*.json"))
print(f"{len(metrics)} metrics, {len(entities)} entities; registry {(OUT / 'registry.json').stat().st_size // 1024} KB; metric files {size // 1024} KB")
print(Counter(m["src"] for m in metrics))
