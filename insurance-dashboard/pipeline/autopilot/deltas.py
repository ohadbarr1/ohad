"""Headline deltas of a filing: the 3-5 changes a report-day notification would carry, each with where its two figures come from.

    profit   net profit attributable to shareholders, YoY (same quarter a year earlier; a year against the year before)
    oci      comprehensive income attributable to shareholders, YoY
    equity   equity attributable to shareholders, against the previous balance-sheet date (QoQ)
    csm      CSM at the period end against the quarter before, same basis only (csm/summary.json resolved series)
    solvency solvency ratio incl. transitional measures, against the previous published ratio (capital.json; published later than the
             statements, so it is often the previous period's)

Figures are NIS millions (per-share none here). kpi.json figures prefer the printed value where canon_kpi.py recorded one (printed
beats tagged); otherwise the XBRL tag with its report id and concept. A change in percent is left out when the base is zero or the two
figures have opposite signs (a percent of a loss turning into a profit means nothing): the absolute change stays.
"""

PL = lambda p: f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}"  # noqa: E731
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "FY": "12-31", "Q4": "12-31"}
MINUS = "−"


def end_of(p):
    return f"{p[:4]}-{END[p[4:]]}"


def prev_year(p):
    return f"{int(p[:4]) - 1}{p[4:]}"


def prev_quarter(p):
    y, s = int(p[:4]), p[4:]
    return {"Q1": f"{y - 1}FY", "Q2": f"{y}Q1", "Q3": f"{y}Q2", "FY": f"{y}Q3"}[s]


def num(v, d=None):
    d = (0 if abs(v) >= 100 else 1) if d is None else d
    return f"{v:,.{d}f}".replace("-", MINUS)


def signed(v, d=1):
    if round(v, d) == 0:
        return f"{0:.{d}f}"
    t = num(v, d)
    return t if t.startswith(MINUS) or float(f"{v:.{d}f}") == 0 else "+" + t


def _kpi_point(c, key, p, concept):
    """(value NIS m, source dict) of one kpi.json figure, or None."""
    if p not in c.get("periods", []):
        return None
    i = c["periods"].index(p)
    v = c["values"].get(key, [None] * (i + 1))[i]
    if v is None:
        return None
    canon = (c.get("canon") or {}).get(key, {}).get(p)
    if canon:
        return canon[0] / 1000, {"k": "report", "rid": canon[2], "pg": canon[3], "period": p, "note": f"מודפס; XBRL {num(canon[1] / 1000)}"}
    st = c["status"][i]
    rid = (c.get("rid") or [None] * (i + 1))[i]
    f = (c.get("fix") or {}).get(p) or {}
    pr = f if f.get("t") == "printed" else (f.get(key) or {})
    if pr.get("t") == "printed" and pr.get("rid"):  # the tag was wrong or year to date: the site shows the printed quarter
        return v / 1000, {"k": "report", "rid": pr["rid"], "pg": pr.get("pg"), "period": p, "note": "מודפס (התיוג שגוי או מתחילת השנה)"}
    src = {"k": "xbrl", "rid": rid, "concept": concept, "period": p, "status": st}
    if f.get("t") == "diff":
        src["note"] = f"מתחילת השנה פחות {', '.join(PL(x) for x in f.get('from', []))}"
    return v / 1000, src


def _item(key, label, p, q, a, b, basis, unit="m"):
    v, sv = a
    w, sw = b
    chg = v - w
    pct = None if unit == "pp" or w == 0 or (v < 0) != (w < 0) else chg / abs(w) * 100
    return {"key": key, "label": label, "period": p, "prev_period": q, "basis": basis, "unit": unit, "v": round(v, 3), "prev": round(w, 3),
            "chg": round(chg, 3), "pct": None if pct is None else round(pct, 1), "src": [sv, sw]}


def headline(comp, kpi, csm=None, cap=None, period=None):
    """Deltas for one company at `period` (default: its latest kpi.json period). Returns {period, items, push} or None."""
    c = (kpi or {}).get("companies", {}).get(comp)
    if not c or not c.get("periods"):
        return None
    p = period or c["periods"][-1]
    concepts = kpi.get("concepts", {})
    items = []
    for key, label in (("profit", "רווח נקי לבעלי המניות"), ("oci", "רווח כולל לבעלי המניות")):
        a, b = _kpi_point(c, key, p, concepts.get(key)), _kpi_point(c, key, prev_year(p), concepts.get(key))
        if a and b:
            items.append(_item(key, label, p, prev_year(p), a, b, "yoy"))
    q = prev_quarter(p)
    a, b = _kpi_point(c, "equity", p, concepts.get("equity")), _kpi_point(c, "equity", q, concepts.get("equity"))
    if a and b:
        items.append(_item("equity", "הון לבעלי המניות", p, q, a, b, "qoq"))
    res = ((csm or {}).get("resolved") or {}).get(comp) or {}
    e, eq = end_of(p), end_of(q)
    if e in res and eq in res:
        (v, basis, fp, pg), (w, basis_q, fq, pgq) = res[e][:4], res[eq][:4]
        if basis == basis_q:
            it = _item("csm", f"CSM ({basis})", p, q, (v, {"k": "report", "period": fp, "pg": pg or None, "note": basis}),
                       (w, {"k": "report", "period": fq, "pg": pgq or None, "note": basis_q}), "qoq")
            items.append(it)
    sr = (((cap or {}).get("companies") or {}).get(comp) or {}).get("sr_w") or {}
    ordk = lambda k: (int(k[:4]), 4 if k.endswith("FY") else int(k[5]))  # noqa: E731
    pers = sorted((k for k in sr if sr[k].get("v") is not None and ordk(k) <= ordk(p)), key=ordk)
    if len(pers) >= 2:
        k1, k0 = pers[-1], pers[-2]
        s1, s0 = sr[k1], sr[k0]
        items.append(_item("solvency", "כושר פירעון (עם הוראות מעבר)", k1, k0,
                           (s1["v"], {"k": "report", "url": s1.get("u"), "pg": s1.get("pg"), "period": k1}),
                           (s0["v"], {"k": "report", "url": s0.get("u"), "pg": s0.get("pg"), "period": k0}), "prev", unit="pp"))
    if not items:
        return None
    return {"period": p, "items": items[:5], "push": push_text(comp, p, items)}


def push_text(name_or_id, p, items, name=None):
    """The notification a report day would send (design: README.md): title = company + period, body = up to three deltas."""
    by = {i["key"]: i for i in items}
    parts = []
    if "profit" in by:
        i = by["profit"]
        parts.append(f"רווח נקי {num(i['v'])} מ' ש\"ח" + (f" ({signed(i['pct'])}% YoY)" if i["pct"] is not None else ""))
    if "csm" in by:
        i = by["csm"]
        parts.append(f"CSM {num(i['v'])}" + (f" ({signed(i['pct'])}% QoQ)" if i["pct"] is not None else ""))
    if "equity" in by:
        i = by["equity"]
        parts.append(f"הון {num(i['v'])}" + (f" ({signed(i['pct'])}% QoQ)" if i["pct"] is not None else ""))
    if "solvency" in by and len(parts) < 3:
        i = by["solvency"]
        parts.append(f"כושר פירעון {num(i['v'], 0)}% ({PL(i['period'])})")
    return {"title": f"{name or name_or_id} {PL(p)}", "body": " · ".join(parts[:3])}
