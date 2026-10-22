"""One rule for "the CSM" of a company at a balance date, shared by every builder (and mirrored in web/src/lib/csmResolve.ts).

CSM closing = net of reinsurance, group level. Savings-policy (investment-contract) future profit is never CSM: those rows are renamed
future_profit_* by build_ifrs.py and a group total that still includes them (inc = 1) is never taken. Fallbacks, in order, each labelled:
  1 group · net                       printed
  2 life and health · net             printed as one combined line
  3 life + health · net               the two segment lines added (flag 1)
  4 group · gross                     printed
  5 group · basis not stated          printed
  6 life and health · gross / n.s.    printed combined line
  7 life + health · gross / n.s.      added (flag 1), both on one basis
  8 life only · net, then gross/n.s.  a filer that prints CSM for life only (no health, group or combined table)
The net basis outranks the group scope: life + health on the net basis is the same economic quantity as the group net figure (P&C carries
no CSM in these groups), while a gross figure is not comparable with the net figures of the other insurers.
Within a tier the period's own report wins, then later reports that reprint the date (newest first; flag 64); in a report a closing row
outranks the opening row of a later window, a table row outranks a figure read from a chart or text, then the lower page.
"""

ALIAS = {
    "group": {"group"},
    "life": {"life", "life insurance and long-term savings"},
    "health": {"health", "health insurance"},
    "life_health": {"life_health", "life+health", "life_and_health", "life and health segments", "life_health_combined"},
}
TIERS = [
    ("group", ("net",), False), ("life_health", ("net",), False), ("lh", ("net",), True),
    ("group", ("gross",), False), ("group", ("na",), False),
    ("life_health", ("gross", "na"), False), ("lh", ("gross", "na"), True),
    ("life", ("net",), False), ("life", ("gross", "na"), False),
]
SCOPE_HE = {"group": "קבוצה", "life_health": "חיים ובריאות", "lh": "חיים ועוד בריאות", "life": "חיים וחיסכון"}
BASIS_HE = {"net": "נטו", "gross": "ברוטו", "na": "בסיס לא צוין"}


def usable(f):
    return f["m"] in ("csm_closing", "csm_opening") and f.get("w") == "instant" and not f.get("tr") and not f.get("model") and not f.get("bk") and f.get("inc") != 1


def whole(f, g):
    return f["g"] == g and str(f["s"]).lower() in ALIAS[g]


def _value(f):
    v = f["dv"] if f.get("dv") is not None else f["v"]
    return abs(v), v < 0 and f.get("dv") is None


def _pick(F, g, b, date):
    c = [f for f in F if f["d"][:10] == date and f.get("b", "na") == b and whole(f, g)]
    if not c:
        return None
    c.sort(key=lambda f: (f["m"] != "csm_closing", f.get("src") in ("chart", "text"), f.get("dv") is None, f.get("pg") or 0))
    return c[0]


def life_only(all_facts):
    return not any(f["m"].startswith("csm") and f["g"] in ("health", "group", "life_health") for f in all_facts)


def resolve(reports, own, date):
    """reports: [(period, facts)] of one company, any order; own: the period whose report is the date's own (2026Q2, 2025FY); date: 2026-06-30.
    Returns {v, b, scope, label, fs: [facts], rp, flags, sum} or None."""
    pool = [(p, [f for f in F if usable(f)]) for p, F in reports]
    allf = [f for _, F in reports for f in F]
    lonly = life_only(allf)
    order = [r for r in pool if r[0] == own] + sorted([r for r in pool if r[0] != own and pkey(r[0]) > pkey(own)], key=lambda r: pkey(r[0]), reverse=True)
    for scope, bases, is_sum in TIERS:
        if scope == "life" and not lonly:
            continue
        for p, F in order:
            for b in bases:
                if is_sum:
                    a, h = _pick(F, "life", b, date), _pick(F, "health", b, date)
                    if not a or not h:
                        continue
                    (va, ta), (vh, th) = _value(a), _value(h)
                    fs, v, turned = [a, h], va + vh, ta or th
                else:
                    x = _pick(F, scope, b, date)
                    if not x:
                        continue
                    v, turned = _value(x)
                    fs = [x]
                fl = (1 if is_sum or any(f.get("cl") == 1 for f in fs) else 0) | (4 if turned else 0) | (16 if any(f.get("src") in ("chart", "text") for f in fs) else 0) | (64 if p != own else 0)
                return {"v": round(v, 3), "b": b, "scope": scope, "label": f"{BASIS_HE[b]} · {SCOPE_HE[scope]}", "fs": fs, "rp": p, "flags": fl, "sum": is_sum}
    return None


def pkey(p):
    return (int(p[:4]), {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}[p[4:]])


def own_period(date):
    """2026-06-30 -> 2026Q2; 2025-12-31 -> 2025FY"""
    return date[:4] + {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "FY"}[date[5:10]]
