"""Sector ("all") rates and the three-product view (am.*), built only from the companies' normalised base series.

Output 1, data/lts_norm/all_rates.json (company "all"): pension sector (8 companies) and provident sector (10) rates
  out_rate, fee_a, fee_d (pension), gross_m, op_m, sm_aum, ga_aum
for every window (each single quarter, each year-to-date window, each full year) in which EVERY company of the set has the
base figures. The amount sums and sm_fees / ga_fees are built by build_lts.aggregates() and are not repeated here.
The base series are the ones each company script returns from its own build(); the sector flow of a window is the sum of the
companies' flows of that window (as lts_method.Method.flow gives them, quarters and restatement rules included) and the
sector average assets the sum of the companies' average assets, then lts_method.Method.metric applies the library's definition
to those sums, exactly as for one company. A rate exists only if every company has every operand.

Output 2, data/lts_norm/am_<company>.json for the 13 companies: the three-product view
  am.fees      = pension fees + provident fees + investment-policy fees (ic.fees), the products the company sells
  am.rev_rate  = am.fees annualised (x 12 / months) / average managed assets (pension + provident + investment-policy assets,
                 (opening + closing) / 2), %
  am.gross, am.op, am.gross_m, am.op_m : only where EVERY product the company sells prints selling-and-marketing (and G&A) expenses.
                 Nothing is assumed or allocated; where a product does not print them, `notes` says so.
Investment-policy figures come from data/lts_norm/ic_<key>.json (NIS millions; assets /1000 to NIS billions).

Validation: the deck's figures are read from the transcription in build_lts.py (build_lts.facts at import) and only compared.
Every value carries `parts`: the company-level figures it was computed from (those are traced to pages in their own files)."""
import calendar
import importlib
import json

import lts_method as M
import build_lts as B  # the deck transcription (put calls run at import; main() is guarded) and the company names

CO = B.CO
PEN, GEM, AM, IC = B.PEN, B.GEM, B.AM, B.IC
DECK = [tuple(f) for f in B.facts]  # copy; (metric, company, period, value, slide)
OUT = M.OUT
UBN, UM, UPCT = 'מיליארדי ש"ח', 'מיליוני ש"ח', "%"
PROD = {"pen": "פנסיה", "gem": "גמל", "ic": "חוזי השקעה"}
ITEM = {"tr_in": "העברות צבירה לקרן", "tr_out": "העברות צבירה מהקרן", "dep": "דמי גמולים", "nb": "דמי גמולים משונתים, מצטרפים חדשים",
        "fees_a": "דמי ניהול שנגבו מנכסים (חברים ומקבלי קצבה)", "fees_d": "דמי ניהול שנגבו מהפקדות", "fees": "הכנסות מדמי ניהול, נטו",
        "sm": "עמלות, הוצאות שיווק והוצאות רכישה אחרות", "ga": "הוצאות הנהלה וכלליות"}
NEWFUNDS = ("tr_in", "tr_out", "dep", "nb", "fees_a", "fees_d")  # pension: activity tables cover the new funds only
SECTOR_METRICS = {"pen": ["out_rate", "fee_a", "fee_d", "gross_m", "op_m", "sm_aum", "ga_aum"],
                  "gem": ["out_rate", "fee_a", "gross_m", "op_m", "sm_aum", "ga_aum"]}
NEED = {"out_rate": ["tr_out"], "fee_d": ["fees_d", "dep"], "gross_m": ["fees", "sm"], "op_m": ["fees", "sm", "ga"],
        "sm_aum": ["sm"], "ga_aum": ["ga"]}
YEARS = range(2021, 2028)
WINDOWS = sorted({(k, y, m) for k in ("ytd", "q") for y in YEARS for m in (3, 6, 9, 12)}, key=lambda w: (w[1], w[2], w[0]))
AM_DEC = {"am.fees": 0, "am.gross": 0, "am.op": 0, "am.rev_rate": 2, "am.gross_m": 2, "am.op_m": 2}


# ---------- helpers ----------

def end_date(y, m):
    return f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


def win_name(w):
    kind, y, m = w
    return "q" if kind == "q" else ("fy" if m == 12 else "ytd")


def plabel(w):
    return B.formula_he(M.Method.wlabel(w))


def part(label, value, unit, date, window):
    return {"file": "", "label": label, "value": round(value, 6), "unit": unit, "date": date, "window": window, "page": None}


def flow_part(c, fam, name, w, value):
    suffix = " (קרנות חדשות)" if fam == "pen" and name in NEWFUNDS else (" (מגזר)" if name in ("fees", "sm", "ga") else "")
    unit = UBN if name in M.BN else UM
    return part(f"{CO[c]} · {PROD[fam]} · {ITEM[name]}{suffix} · {plabel(w)}", value, unit, end_date(w[1], w[2]), win_name(w))


def bal_part(c, kind, date, value, unit=UBN):
    y, m = int(date[:4]), int(date[5:7])
    return part(f"{CO[c]} · {kind} · {date}", value, unit, end_date(y, m), "instant")


def load_methods():
    meth = {}
    for c in GEM:  # every company with a mapping script (the 8 pension companies + yelin + analyst)
        base, _ = importlib.import_module(f"lts_norm_{c}").build()
        meth[c] = {fam: M.Method(fam, base[fam], []) for fam in M.FAMILIES}
    return meth


def rnd_he(x, fam, metric, period):
    return M.rnd(x, M.decimals(fam, metric, period))


# ---------- 1. sector rates ----------

class Sector(M.Method):
    """The library's Method over the sum of the companies' base series (flows and balances)."""

    def __init__(self, fam, cos, meth):
        self.fam, self.cos = fam, cos
        self.mm = {c: meth[c][fam] for c in cos}
        self.notes = []

    def flow(self, name, w):
        vals = []
        for c, m in self.mm.items():
            v = m.flow(name, w)
            if v is None:
                return None
            vals.append((c, v.value))
        return M.V(sum(v for _, v in vals), [flow_part(c, self.fam, name, w, v) for c, v in vals], f"{name} summed over the companies")

    def avg(self, w, new=False):
        kind, y, m = w
        d0, d1 = M.prev_date(y, m, 3 if kind == "q" else m), f"{y}-{m:02d}"
        tot, parts = 0.0, []
        for c, mm in self.mm.items():
            s = mm.aum_new if new else mm.aum
            a, b = s.get(d0), s.get(d1)
            if a is None or b is None:
                return None
            tot += (a.value + b.value) / 2
            what = "נכסים בקרנות החדשות" if new and mm.aum_new is not mm.aum else "נכסים"
            parts += [bal_part(c, f"{PROD[self.fam]} · {what}", d0, a.value), bal_part(c, f"{PROD[self.fam]} · {what}", d1, b.value)]
        return M.V(tot, parts, "sum of the companies' average assets")


def lacking(sec, name):
    """Why a company has no value of this metric: the base series it does not have at all, or the windows it lacks."""
    need = list(NEED.get(name, []))
    if name == "fee_a":
        need = ["fees_a"] if sec.fam == "pen" else ["fees"]
    new = name == "out_rate" or (name == "fee_a" and sec.fam == "pen")
    out = {}
    for c, mm in sec.mm.items():
        series = [n for n in need if not mm.b.get(n, {}).get("first")]
        bal = mm.aum_new if new else mm.aum
        if not bal:
            series.append("aum_new" if new else "aum")
        if series:
            out[c] = series
    return out


def sector_rates(meth):
    facts, notes = [], []
    for fam, cos in (("pen", PEN), ("gem", GEM)):
        sec = Sector(fam, cos, meth)
        own = {w for mm in sec.mm.values() for w in mm.windows()}  # windows in which some company has a flow
        for name in SECTOR_METRICS[fam]:
            key, seen, blocked = f"{fam}.{name}", {}, {}
            for w in WINDOWS:
                lab = M.Method.wlabel(w)
                v = sec.metric(name, w)
                if v is None:
                    if ("ytd",) + w[1:] in own or ("q",) + w[1:] in own:
                        blocked.setdefault(lab, tuple(c for c in cos if meth[c][fam].metric(name, w) is None))
                    continue
                if lab in seen:
                    assert abs(seen[lab] - v.value) < 1e-9, (key, lab)
                    continue
                seen[lab] = v.value
                facts.append(M.fact(key, lab, v.value, f"סכום {len(cos)} החברות: {v.formula}", v.parts))
            built = sorted(seen, key=period_order)
            groups = {}
            for lab, who in blocked.items():
                if lab not in seen:
                    groups.setdefault(who, []).append(lab)
            why = lacking(sec, name)
            not_built = {(", ".join(who) if len(who) < len(cos) else "all companies"): sorted(labs, key=period_order)
                         for who, labs in sorted(groups.items(), key=lambda kv: -len(kv[1]))}
            txt = "; ".join(f"{who}: {len(labs)} periods ({', '.join(labs)})" for who, labs in not_built.items())
            nobase = "; ".join(f"{c} has no base series {', '.join(sr)}" for c, sr in sorted(why.items()))
            notes.append({"series": key, "key": "all", "built": built, "not_built": not_built, "companies_without_the_base_series": why,
                          "rule": f"sum of the {len(cos)} companies' base series, the library's definition applied to the sums; built only where every company has every "
                                  f"operand: {len(built)} periods. Not built, by the company lacking an operand: {txt or 'none'}." + (f" Base series absent: {nobase}." if nobase else "")})
    return facts, notes


def period_order(lab):
    y = int(lab[-4:]) if lab[-4:].isdigit() else int(lab.split("-")[-1])
    return (y, {"Q1": 1, "H1": 2, "Q2": 3, "9M": 4, "Q3": 5, "FY": 6, "Q4": 7}[lab[:2]])


# ---------- 2. three-product view ----------

def ic_facts(c):
    p = OUT / f"ic_{c}.json"
    if not p.exists():
        return {}
    out = {}
    for f in json.loads(p.read_text(encoding="utf-8"))["facts"]:
        out.setdefault(f["metric"], {})[f["period"]] = f
    return out


def am_company(c, meth, icf):
    prods = [p for p, s in (("pen", PEN), ("gem", GEM), ("ic", IC)) if c in s]
    ic = icf.get(c, {})

    def flow(p, item, w):  # -> (value in NIS m, part, formula) or None
        if p == "ic":
            f = ic.get(f"ic.{item}", {}).get(M.Method.wlabel(w))
            if not f:
                return None
            v = f["value"]
            return v, part(f"{CO[c]} · {PROD[p]} · {ITEM[item]} (עמודת חוזי ההשקעה) · {plabel(w)}", v, UM, end_date(w[1], w[2]), win_name(w)), f["formula"]
        v = meth[c][p].flow(item, w)
        return None if v is None else (v.value, flow_part(c, p, item, w, v.value), "")

    def bal(p, date):  # -> (value in NIS bn, part, formula) or None
        if p == "ic":
            f = ic.get("ic.aum", {}).get(date)
            return None if not f else (f["value"] / 1000, bal_part(c, f"{PROD[p]} · נכסים (התחייבויות חוזי השקעה תלויי תשואה)", date, f["value"] / 1000), f["formula"])
        v = meth[c][p].aum.get(date)
        return None if v is None else (v.value, bal_part(c, f"{PROD[p]} · נכסים", date, v.value), "")

    facts, notes, built, why = [], [], {k: [] for k in AM_DEC}, {k: {} for k in AM_DEC}
    names = " + ".join(PROD[p] for p in prods)
    NEEDS = {"am.fees": ["fees"], "am.rev_rate": ["fees", "aum"], "am.gross": ["fees", "sm"], "am.op": ["fees", "sm", "ga"],
             "am.gross_m": ["fees", "sm", "aum"], "am.op_m": ["fees", "sm", "ga", "aum"]}
    done = set()
    for w in WINDOWS:
        lab = M.Method.wlabel(w)
        if lab in done:  # Q1 appears as year-to-date and as quarter: same figure
            continue
        kind, y, m = w
        got = {p: {it: flow(p, it, w) for it in ("fees", "sm", "ga")} for p in prods}
        if all(got[p]["fees"] is None for p in prods):
            continue  # no product has any activity in this window: not a window of this company
        done.add(lab)
        d0, d1 = M.prev_date(y, m, 3 if kind == "q" else m), f"{y}-{m:02d}"
        b0 = {p: bal(p, d0) for p in prods}
        b1 = {p: bal(p, d1) for p in prods}
        k = 12 / (3 if kind == "q" else m)
        ktxt = "" if k == 1 else f" × {k:.4g}"
        have = {"fees": lambda p: got[p]["fees"], "sm": lambda p: got[p]["sm"], "ga": lambda p: got[p]["ga"],
                "aum": lambda p: b0[p] and b1[p]}
        miss = {n: [(p, n) for p in prods if not have[n](p)] for n in ("fees", "sm", "ga", "aum")}
        flows = lambda it: [got[p][it] for p in prods]
        fees = sum(x[0] for x in flows("fees")) if not miss["fees"] else None
        sm = sum(x[0] for x in flows("sm")) if not miss["sm"] else None
        ga = sum(x[0] for x in flows("ga")) if not miss["ga"] else None
        avg = sum((b0[p][0] + b1[p][0]) / 2 for p in prods) if not miss["aum"] else None
        tag = ""
        allf = [x[2] for p in prods for x in ([got[p]["fees"]] if got[p]["fees"] else []) + ([b0[p], b1[p]] if b0[p] and b1[p] else []) if x[2]]
        if any("[IFRS 4 basis, not comparable" in f or "basis break" in f for f in allf):
            tag = " [רכיב חוזי ההשקעה על בסיס IFRS 4 או שבר בסיס; ראו ic_" + c + "]"

        def parts(items, with_avg):
            ps = [x[1] for it in items for x in flows(it)]
            if with_avg:
                ps += [b[1] for p in prods for b in (b0[p], b1[p])]
            return ps

        res = {}
        if fees is not None:
            res["am.fees"] = (fees, f"דמי ניהול {names}" + tag, parts(["fees"], False))
        if fees is not None and avg:
            res["am.rev_rate"] = (fees * k / avg / 10, f"דמי ניהול{ktxt} / נכסים מנוהלים ממוצעים ({names}; (פתיחה + סגירה) / 2), %" + tag, parts(["fees"], True))
        if fees is not None and sm is not None:
            res["am.gross"] = (fees - sm, f"דמי ניהול − הוצאות מכירה ושיווק, {names}" + tag, parts(["fees", "sm"], False))
            if avg:
                res["am.gross_m"] = ((fees - sm) * k / avg / 10, f"(דמי ניהול − הוצאות מכירה ושיווק){ktxt} / נכסים מנוהלים ממוצעים, %" + tag, parts(["fees", "sm"], True))
            if ga is not None:
                res["am.op"] = (fees - sm - ga, f"דמי ניהול − הוצאות מכירה ושיווק − הוצאות הנהלה וכלליות, {names}" + tag, parts(["fees", "sm", "ga"], False))
                if avg:
                    res["am.op_m"] = ((fees - sm - ga) * k / avg / 10, f"(דמי ניהול − מכירה ושיווק − הנהלה וכלליות){ktxt} / נכסים מנוהלים ממוצעים, %" + tag, parts(["fees", "sm", "ga"], True))
        for metric in AM_DEC:
            if metric in res:
                val, fml, ps = res[metric]
                facts.append(M.fact(metric, lab, val, fml, ps))
                built[metric].append(lab)
            else:
                lack = [f"{PROD[p]}:{n}" for n in NEEDS[metric] for p, _ in miss[n]]
                for x in lack:
                    why[metric].setdefault(x, []).append(lab)
    for metric in AM_DEC:
        w = why[metric]
        if not w and built[metric]:
            continue
        absent = []
        for x, labs in sorted(w.items()):
            prod, item = x.split(":")
            p = next(q for q in prods if PROD[q] == prod)
            if item in ("sm", "ga") and p == "ic":
                absent.append(f"{prod} {item}: the reports print no {'selling / acquisition' if item == 'sm' else 'general / administrative'} "
                              f"expense for investment contracts (only 'other operating expenses'), nothing is assumed or allocated ({len(labs)} windows)")
            elif len(labs) >= len(done):
                absent.append(f"{prod} {item}: not available in any window (no base series)")
            else:
                absent.append(f"{prod} {item}: missing in {', '.join(sorted(labs, key=period_order))}")
        notes.append({"series": metric, "key": "all", "built": sorted(built[metric], key=period_order),
                      "rule": ("not built" if not built[metric] else f"built for {len(built[metric])} windows; the others not built") + ": " +
                              ("; ".join(absent) if absent else "no figure")})
    order = {k: i for i, k in enumerate(AM_DEC)}
    facts.sort(key=lambda f: (order[f["metric"]], period_order(f["period"])))
    notes.insert(0, {"series": "am.*", "key": "all", "rule": f"products sold: {names} (" + ("pension / provident from the company's base series" if any(p != "ic" for p in prods) else "") +
                     (", " if len(prods) > 1 and "ic" in prods else "") + (f"investment policies from ic_{c}.json" if "ic" in prods else "") + "); "
                     "managed assets = the sum of the assets of these products (policies in NIS millions / 1000)"})
    return facts, notes, built


# ---------- validation ----------

def anchors(company, facts, metrics, dec):
    ours = {(f["metric"], f["period"]): f["value"] for f in facts}
    out = []
    for m, c, p, v, _s in DECK:
        if c != company or m not in metrics:
            continue
        o = ours.get((m, p))
        r = None if o is None else M.rnd(o, dec(m, p))
        out.append({"metric": m, "period": p, "deck": v, "ours": r, "ours_exact": o, "ok": r is not None and abs(r - v) < 1e-9})
    return out


def write(name, company, facts, anc, notes, entity=None):
    OUT.mkdir(parents=True, exist_ok=True)
    row = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    head = f'{{"company":{row(company)},\n' + (f'"entity":{row(entity)},\n' if entity else "")
    body = head + '"facts":[\n%s\n],\n"anchors":[\n%s\n],\n"notes":[\n%s\n]}\n' % (
        ",\n".join(map(row, facts)), ",\n".join(map(row, anc)), ",\n".join(map(row, notes)))
    (OUT / name).write_text(body, encoding="utf-8")


def main():
    meth = load_methods()
    tot, miss_list = [0, 0], []

    def count(company, anc):
        tot[0] += sum(a["ok"] for a in anc)
        tot[1] += len(anc)
        miss_list.extend((company, a) for a in anc if not a["ok"])

    # 1. sector rates
    facts, notes = sector_rates(meth)
    rate_metrics = {f"{fam}.{n}" for fam in SECTOR_METRICS for n in SECTOR_METRICS[fam]}
    anc = anchors("all", facts, rate_metrics, lambda m, p: M.decimals(m.split(".")[0], m.split(".")[1], p))
    write("all_rates.json", "all", facts, anc, notes, entity="סכום החברות שבמצגת")  # same label aggregates() gives "all"
    count("all", anc)
    per = {}
    for f in facts:
        per.setdefault(f["metric"], []).append(f["period"])
    print(f"all_rates: {len(facts)} facts")
    for k in sorted(per):
        print(f"  {k}: {len(per[k])} periods")

    # 2. three-product view
    icf = {c: ic_facts(c) for c in IC}
    for c in AM:
        facts, notes, built = am_company(c, meth, icf)
        anc = anchors(c, facts, set(AM_DEC), lambda m, p: AM_DEC[m])
        write(f"am_{c}.json", c, facts, anc, notes)
        count(c, anc)
        print(f"am_{c}: " + ", ".join(f"{k.split('.')[1]} {len(v)}" for k, v in built.items()))
    print(f"anchors reproduced {tot[0]} / {tot[1]}")
    for c, a in miss_list:
        print("  MISS", c, a["metric"], a["period"], "deck", a["deck"], "ours", a["ours"], a["ours_exact"])


if __name__ == "__main__":
    main()
