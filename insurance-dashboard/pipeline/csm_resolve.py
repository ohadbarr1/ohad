"""One rule for "the CSM" of a company at a balance date, shared by every builder (and mirrored in web/src/lib/csmResolve.ts).

CSM closing = net of reinsurance, group level. Savings-policy (investment-contract) future profit is never CSM: those rows are renamed
future_profit_* by build_ifrs.py and a group total that still includes them (inc = 1) is never taken. Fallbacks, in order, each labelled:
  1 group · net                       printed
  2 life and health · net             printed as one combined line
  3 life + health · net               the two segment lines added (flag 1)
  3b group · net, proven              a group line printed without a stated basis that equals life + health gross less their
                                      reinsurance CSM printed in the same report, within 1 (Phoenix 30.09.25: 8,766 = 2,837.9 + 7,405.1
                                      − 228.5 − 1,248.1, Q3'25 report pp. 23, 148, 154); basis net, labelled as proven, the proof kept
  3c group · net, derived             the group CSM printed gross less the group reinsurance CSM printed in the same report (flag 1; Migdal
                                      31.03.24: 12,237 − 712 = 11,525, Q1'25 p. 71)
  3d life + health · net, derived     life and health each gross less its reinsurance CSM, same report (flag 1; Menora 31.03.24: 2,585.8 −
                                      81.7 + 4,480.8 − 552.6 = 6,432.3, Q1'25 p. 87; Phoenix 31.03.25: 8,809.0, the presentation's 8,809)
  4 group · gross                     printed
  5 group · basis not stated          printed
  6 life and health · gross / n.s.    printed combined line
  7 life + health · gross / n.s.      added (flag 1), both on one basis
  8 life only · net, then net derived (gross less reinsurance, flag 1), then gross/n.s.: a filer that prints CSM for life only (no
                                      health, group or combined table)
A series therefore stays on the net basis wherever the report prints the reinsurance CSM beside the gross figure; a gross or unstated
figure is served only where it does not, and carries its basis in its label (the board marks it and computes no change across it).
The net basis outranks the group scope: life + health on the net basis is the same economic quantity as the group net figure (P&C carries
no CSM in these groups), while a gross figure is not comparable with the net figures of the other insurers.
Within a tier, one figure per report (the period's own report and every later report that reprints the date): in a report a closing row
outranks the opening row of a later window, a table row outranks a figure read from a chart, a chart outranks prose, then the lower page.
Across those reports the site's restatement rule (restate_rule.py, as the IFRS 17 notes and the statements): the LATEST print when it
restated the first print beyond rounding and plausibly (same sign, within 10%), flag 8 with the first print kept (`rst`, `rfrom`); a reprint
within rounding keeps the first print and its page. A figure read from prose ("NIS 16.5 billion", src text) never outranks a table, roll-
forward or chart figure of the same date and basis: it is taken only when nothing else prints the date on that basis (Harel 31.03.25:
16,500 in the Q1'25 prose against 16,538 in its roll-forward and 16,333 restated in the Q1'26 comparative).
A balance at 1 January is the balance at 31 December of the year before (the opening column of a roll-forward or a transition table
dated 01.01.2024 is the 31.12.2023 balance): Harel 31.12.23 net 15,904 (Q1'25 p. 135), where the gross life + health 17,011 was served.
"""

import restate_rule

ALIAS = {
    "group": {"group"},
    "life": {"life", "life insurance and long-term savings"},
    "health": {"health", "health insurance"},
    "life_health": {"life_health", "life+health", "life_and_health", "life and health segments", "life_health_combined"},
}
TIERS = [
    ("group", ("net",), False), ("life_health", ("net",), False), ("lh", ("net",), True), ("group", ("proven",), False),
    ("group", ("less",), False), ("lh", ("less",), True),
    ("group", ("gross",), False), ("group", ("na",), False),
    ("life_health", ("gross", "na"), False), ("lh", ("gross", "na"), True),
    ("life", ("net",), False), ("life", ("less",), False), ("life", ("gross", "na"), False),
]
SCOPE_HE = {"group": "קבוצה", "life_health": "חיים ובריאות", "lh": "חיים ועוד בריאות", "life": "חיים וחיסכון"}
BASIS_HE = {"net": "נטו", "gross": "ברוטו", "na": "בסיס לא צוין"}
PROVEN_HE = " (ברוטו פחות ביטוח משנה באותו דוח)"  # tier 3b: the report printed no basis; 3c, 3d, 8b: net computed from the two lines


def usable(f):
    return f["m"] in ("csm_closing", "csm_opening") and f.get("w") == "instant" and not f.get("tr") and not f.get("model") and not f.get("bk") and f.get("inc") != 1


def whole(f, g):
    return f["g"] == g and str(f["s"]).lower() in ALIAS[g]


def _value(f):
    v = f["dv"] if f.get("dv") is not None else f["v"]
    return abs(v), v < 0 and f.get("dv") is None


def bal_date(f):
    """the balance date of a fact: 01.01.Y is the 31.12.(Y-1) balance"""
    d = f["d"][:10]
    return f"{int(d[:4]) - 1}-12-31" if d[5:10] == "01-01" else d


def dates_of(facts):
    """every quarter-end balance date the CSM facts print (01.01 read as the 31.12 before it)"""
    return sorted({bal_date(f) for f in facts if f["m"] in ("csm_closing", "csm_opening") and bal_date(f)[5:10] in ("03-31", "06-30", "09-30", "12-31")})


def coarse(f):
    """a figure read from prose, or a chart label rounded to NIS 0.1 billion (Phoenix 31.12.24: 8,900 = 2.4 + 6.5 billion on the chart
    against 8,837.0 in the note): a reading of the balance, not a print of it"""
    if f.get("src") == "text":
        return True
    v = abs(f["dv"] if f.get("dv") is not None else f["v"])
    return f.get("src") == "chart" and v >= 1000 and v % 100 == 0


def src_rank(f):
    """in one report: a table row, then a chart label printed to the unit, then a rounded or prose figure"""
    return 2 if coarse(f) else 1 if f.get("src") in ("chart", "text") else 0  # a presentation figure ranks with the table, as before


def _pick(F, g, b, date):
    c = [f for f in F if bal_date(f) == date and f.get("b", "na") == b and whole(f, g)]
    if not c:
        return None
    c.sort(key=lambda f: (f["m"] != "csm_closing", src_rank(f), f.get("dv") is None, f["d"][5:10] == "01-01", f.get("pg") or 0))
    return c[0]


def proven_net(F, date):
    """tier 3b: the group line printed without a basis, and the four segment lines (life and health, gross and reinsurance) that prove it net"""
    x = _pick(F, "group", "na", date)
    if not x:
        return None
    parts = [_pick(F, g, b, date) for g in ("life", "health") for b in ("gross", "reinsurance")]
    if not all(parts):
        return None
    (lg, _), (lr, _), (hg, _), (hr, _) = (_value(f) for f in parts)
    return (x, parts) if abs(lg - lr + hg - hr - _value(x)[0]) <= 1 else None


def life_only(all_facts):
    return not any(f["m"].startswith("csm") and f["g"] in ("health", "group", "life_health") for f in all_facts)


def _less(F, g, date):
    """one scope's net CSM computed from the same report: gross less reinsurance -> (value, [gross, reinsurance]) or None"""
    gr, re_ = _pick(F, g, "gross", date), _pick(F, g, "reinsurance", date)
    if not gr or not re_:
        return None
    return _value(gr)[0] - _value(re_)[0], [gr, re_]


def _candidate(F, scope, b, is_sum, date):
    """the tier's figure in one report: (value, sign turned, facts, proof, signs) or None; signs: +1 / -1 per fact (a difference)"""
    if b == "less":
        parts = [_less(F, g, date) for g in (("life", "health") if is_sum else (scope,))]
        if not all(parts):
            return None
        fs = [f for _, x in parts for f in x]
        return sum(v for v, _ in parts), False, fs, None, [1, -1] * len(parts)
    if is_sum:
        a, h = _pick(F, "life", b, date), _pick(F, "health", b, date)
        if not a or not h:
            return None
        (va, ta), (vh, th) = _value(a), _value(h)
        return va + vh, ta or th, [a, h], None, [1, 1]
    if b == "proven":
        pr = proven_net(F, date)
        if not pr:
            return None
        v, turned = _value(pr[0])
        return v, turned, [pr[0]], pr[1], [1]
    x = _pick(F, scope, b, date)
    if not x:
        return None
    v, turned = _value(x)
    return v, turned, [x], None, [1]


def resolve(reports, own, date):
    """reports: [(period, facts)] of one company, any order; own: the period whose report is the date's own (2026Q2, 2025FY); date: 2026-06-30.
    Returns {v, b, scope, label, fs: [facts], rp, flags, sum[, rst, rfrom, proof]} or None."""
    pool = [(p, [f for f in F if usable(f)]) for p, F in reports]
    allf = [f for _, F in reports for f in F]
    lonly = life_only(allf)
    order = [r for r in pool if r[0] == own or pkey(r[0]) > pkey(own)]
    held = None  # a tier read only from prose or rounded charts: taken only if no later tier on the same basis prints the date
    for scope, bases, is_sum in TIERS:
        if scope == "life" and not lonly:
            continue
        cands = []
        for p, F in order:
            for b in bases:
                x = _candidate(F, scope, b, is_sum, date)
                if x:
                    cands.append({"v": x[0], "turned": x[1], "fs": x[2], "proof": x[3], "sg": x[4], "b": b, "rp": p, "own": p == own})
                    break
        if not cands:
            continue
        firm = [c for c in cands if not any(coarse(f) for f in c["fs"])]
        tier_b = "net" if cands[0]["b"] in ("net", "proven", "less") else cands[0]["b"]
        if held and held[1] != tier_b:
            break  # the prose figure on the net basis outranks a printed gross one: the basis is what makes the series comparable
        if not firm:
            held = held or ((scope, bases, is_sum, cands), tier_b)
            continue
        return _out(scope, is_sum, firm)
    if held:
        (scope, bases, is_sum, cands), _ = held
        return _out(scope, is_sum, cands)
    return None


def _out(scope, is_sum, cands):
    c, first = restate_rule.pick(cands, lambda c: c["rp"], lambda c: c["own"])
    fs, b = c["fs"], c["b"]
    re_ = c is not first and restate_rule.restated(first["v"], c["v"])
    fl = (1 if is_sum or b == "less" or any(f.get("cl") == 1 for f in fs) else 0) | (4 if c["turned"] else 0) | (8 if re_ else 0) \
        | (16 if any(f.get("src") in ("chart", "text") for f in fs) else 0) | (64 if not c["own"] else 0)
    bb = "net" if b in ("proven", "less") else b
    out = {"v": round(c["v"], 3), "b": bb, "scope": scope, "label": f"{BASIS_HE[bb]}{PROVEN_HE if b in ('proven', 'less') else ''} · {SCOPE_HE[scope]}", "fs": fs, "rp": c["rp"],
           "flags": fl, "sum": is_sum or b == "less", "sg": c["sg"], "less": b == "less"}
    if re_:
        out.update(rst=round(first["v"], 3), rfrom=first["rp"])
    if b == "proven":
        out["proof"] = c["proof"]
    return out


def first_note(r):
    """the first print of a restated CSM, for the source note: "כפי שהודפס לראשונה (דוח Q1'25): 16,538" """
    if r.get("rst") is None:
        return None
    p = r["rfrom"]
    lab = f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}"
    return f"כפי שהודפס לראשונה (דוח {lab}): {r['rst']:,.0f}" if abs(r["rst"]) >= 100 else f"כפי שהודפס לראשונה (דוח {lab}): {r['rst']:,.1f}"


def pkey(p):
    return (int(p[:4]), {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}[p[4:]])


def own_period(date):
    """2026-06-30 -> 2026Q2; 2025-12-31 -> 2025FY"""
    return date[:4] + {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "FY"}[date[5:10]]
