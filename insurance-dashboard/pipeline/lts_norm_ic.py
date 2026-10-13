"""Investment policies (חוזי השקעה / פוליסות חיסכון sold by insurers): raw report facts -> deck metrics (data/lts_norm/ic_<key>.json).
Slide 9 of the deck (build_lts.py: ic.aum, ic.dep), NIS millions. One script, eight insurers, one definition.

DEFINITION (settled with the deck's anchors, the anchor tests in data/work/lts_norm_ic/alt.py):
  ic.aum  = the balance-sheet line "liabilities for yield-dependent investment contracts" (התחייבויות בגין חוזי השקעה תלויי תשואה)
            at the quarter end. Not the non-yield-dependent liabilities, not the total of both.
  ic.dep  = "receipts for investment contracts" (תקבולים בגין חוזי השקעה): receipts credited directly to the liability, not premiums,
            recurring and one-time together. Transfers between tracks / to and from the company are not added or removed
            (the reports of 2025 onwards print none; the IFRS 4 reports of Hachshara and Ayalon print a combined insurance +
            investment line, which is not used).
  ic.fees = "הכנסות מדמי ניהול" of the investment-contract column of the segment note.
  ic.sm, ic.ga: no insurer prints selling / acquisition or general / administrative expenses for this activity (one line "הוצאות
            תפעוליות אחרות" only), so the two metrics are left out. Nothing else is derived.

WINDOWS: quarter = the printed three-month figure where the report of the period prints one, otherwise year-to-date minus the
previous year-to-date; Q1 is the Q1 figure; Q4 = full year - nine months; H1 / 9M = printed year-to-date; full year = the latest annual
report that prints it. A printed three-month figure that differs from the year-to-date difference is kept and logged in `notes`.

BASIS: Israeli insurers adopted IFRS 17 on 1.1.2025 and restated 2024. Figures of 2024 and later are taken from the reports of 2025
and later (a 2024 period from the 2025 report that prints it as a comparative); the 2024 reports (IFRS 4) are not used for them.
Figures of 2022 and earlier exist on IFRS 4 only and are labelled so in `formula`. The one exception is ic.aum of 2023-12: the
first IFRS 17 annual report (2025FY) prints the opening balance at 1.1.2024 (= 31.12.2023 restated) on the balance-sheet line
used for the later balances, recorded as a raw fact dated 2023-12-31 with `"basis": "IFRS17"`; that balance replaces the IFRS 4
one (the output fact carries `"basis": "IFRS17"` and the IFRS 4 figure in its formula). It equals the IFRS 4 balance for Phoenix,
Hachshara, Migdal, Harel and Menora (pure investment contracts) and differs for Clal, Ayalon and Direct (savings components of
policies separated and measured as investment contracts under IFRS 17). The Mar/Jun/Sep-23 balances stay IFRS 4 (unmarked).
Every value is a sum of printed facts (`parts`); extracted facts are never changed."""
import json

import lts_method as M

KEYS = ["phoenix", "hachshara", "migdal", "harel", "clal", "ayalon", "menora", "direct"]
SEG = "investment_contracts"
METRICS = {"aum": "investment_contract_aum", "dep": "investment_contract_deposits", "fees": "management_fees"}
QEND = ("03-31", "06-30", "09-30", "12-31")
SCALE = 1e6  # NIS millions


def ifrs17(file):
    return int(file[:4]) >= 2025


def basis_tag(year):
    return "" if year >= 2024 else "[IFRS 4 basis, not comparable with 2024 onward unless stated] "


def collect(F, metric):
    def where(x):
        if x["metric"] != metric or x["segment"] != SEG:
            return False
        if x.get("basis") == "IFRS17":
            return False  # the IFRS 17 opening balance has its own path (opening17)
        if x["window"] == "instant":
            return x["date"][5:] in QEND  # not the 1 Jan 2024 opening balance
        return True
    return M.collect(F, where, SCALE)


def opening17(F):
    """IFRS 17 opening balance at 1.1.2024 (= 31.12.2023 restated), the raw fact dated 2023-12-31 with basis IFRS17. -> V or None."""
    c = M.collect(F, lambda x: x["metric"] == METRICS["aum"] and x["segment"] == SEG and x["window"] == "instant"
                  and x["date"] == "2023-12-31" and x.get("basis") == "IFRS17", SCALE)
    per_file = c.get("2023-12")
    if not per_file:
        return None
    v = per_file[sorted(per_file, key=M.file_end)[0]]
    for p in v.parts:
        p["basis"] = "IFRS17"
    return v


def unit_m(v):
    """Largest printing unit among the parts, in NIS millions (rounding tolerance)."""
    return max(M.UNIT[p["unit"]] for p in v.parts) / SCALE


def pick(cands, name, notes):
    """Report choice for one series. -> {key: V}.
    A period of 2024 or later comes from the reports of 2025 or later (IFRS 17); an earlier period from the IFRS 4 reports.
    Full year: the latest annual report that prints it. Every other key: the report of the period itself, else the earliest report
    that prints it as a comparative. Every other printed value that differs by more than one printing unit is logged."""
    out = {}
    for key, per_file in cands.items():
        y, m = M.key_end(key)
        ok = [f for f in sorted(per_file, key=M.file_end) if ifrs17(f) == (y >= 2024)]
        if not ok:
            notes.append({"series": name, "key": M.label(key), "rule": "not available on the basis of its year (IFRS 17 from 2024, IFRS 4 before): "
                          "printed only in " + ", ".join(sorted(per_file)) + "; no value"})
            continue
        full = isinstance(key, tuple) and key[0] != "q" and m == 12
        if full:
            ann = [f for f in ok if f.endswith("FY")]
            if not ann:
                continue
            use = ann[-1]
        else:
            own = [f for f in ok if M.file_end(f) == (y, m)]
            use = own[0] if own else ok[0]
        out[key] = per_file[use]
        other = {}
        for f in sorted(per_file, key=M.file_end):
            if f != use and abs(per_file[f].value - per_file[use].value) > max(unit_m(per_file[f]), unit_m(per_file[use])):
                other.setdefault(round(per_file[f].value, 6), []).append(f)
        for val, files in other.items():
            why = ("IFRS 4 report of 2024, superseded by the IFRS 17 comparative of the 2025 reports" if y >= 2024 and not ifrs17(files[0])
                   else "restated or reclassified in another report; the report chosen by the rule is used")
            notes.append({"series": name, "key": M.label(key), "used": round(per_file[use].value, 6), "used_file": use, "other": val,
                          "other_files": files, "rule": why})
    return out


def flow_windows(name, cands, notes):
    """Deck windows of one flow series. -> {period label: V with formula}."""
    ch = pick(cands, name, notes)
    ytd = {k: v for k, v in ch.items() if k[0] != "q"}
    qs = {(k[1], k[2]): v for k, v in ch.items() if k[0] == "q"}
    out, years = {}, sorted({k[0] for k in ytd})

    def V(v, formula):
        return M.V(v.value, v.parts, formula)

    def put(lab, v):
        if v is not None:
            out[lab] = v

    def diff(a, b, lab, txt):
        d = a.value - b.value
        if d < -1e-9:
            notes.append({"series": name, "key": lab, "rule": f"not derived: {txt} is negative ({a.value:.3f} - {b.value:.3f} NIS m)"})
            return None
        return M.V(d, a.parts + b.parts, txt)

    def check(lab, printed, derived):
        if printed is not None and derived is not None and abs(printed.value - derived.value) > 2 * max(unit_m(printed), unit_m(derived)):
            notes.append({"series": name, "key": lab, "rule": f"printed three-month figure {printed.value:.3f} differs from the year-to-date "
                          f"difference {derived.value:.3f} (NIS m); the printed figure is used where the report prints it, Q4 is always FY - 9M"})

    for y in years:
        tag = basis_tag(y)
        q1, h1, m9, fy = ytd.get((y, 3)), ytd.get((y, 6)), ytd.get((y, 9)), ytd.get((y, 12))
        if q1:
            put(f"Q1-{y}", V(q1, tag + f"{name} printed for Q1-{y}"))
        if h1:
            put(f"H1-{y}", V(h1, tag + f"{name} printed for H1-{y} (year to date)"))
        if m9:
            put(f"9M-{y}", V(m9, tag + f"{name} printed for 9M-{y} (year to date)"))
        if fy:
            put(f"FY{y}", V(fy, tag + f"{name} printed for FY{y} (latest annual report that prints it)"))
        # Q2, Q3
        for qn, cur, prev, ql in ((2, h1, q1, "H1"), (3, m9, h1, "9M")):
            lab, pl = f"Q{qn}-{y}", {"H1": "Q1", "9M": "H1"}[ql]
            der = diff(cur, prev, lab, f"{name} {ql}-{y} - {name} {pl}-{y}") if cur and prev else None
            pr = qs.get((y, qn * 3))
            if pr is not None:
                check(lab, pr, der)
                put(lab, V(pr, tag + f"{name} printed for the three months Q{qn}-{y}"))
            elif der is not None:
                der.formula = tag + der.formula
                put(lab, der)
        # Q4 = FY - 9M always
        if fy and m9:
            der = diff(fy, m9, f"Q4-{y}", f"{name} FY{y} - {name} 9M-{y}")
            pr = qs.get((y, 12))
            if pr is not None:
                check(f"Q4-{y}", pr, der)
            if der is not None:
                der.formula = tag + der.formula
                put(f"Q4-{y}", der)
    return out


def build(key):
    F = M.load(key + "_ic")
    bad = [x for x in F if x["value"] is not None and x.get("unit") not in M.UNIT]
    if bad:
        raise ValueError(f"{key}: unknown unit {bad[0]['unit']}")
    notes, facts = [], []

    # ---- ic.aum: liabilities for yield-dependent investment contracts, each quarter end ----
    bal = pick(collect(F, METRICS["aum"]), "ic.aum", notes)
    op17 = opening17(F)
    for d in sorted(set(bal) | ({"2023-12"} if op17 else set())):
        y = int(d[:4])
        if d == "2023-12" and op17 is not None:
            ifrs4 = bal.get(d)
            txt = ("[IFRS 17 basis] liabilities for yield-dependent investment contracts: opening balance at 1.1.2024 (= 31.12.2023 restated) "
                   "as printed in the first IFRS 17 annual report")
            if ifrs4 is not None:
                same = abs(ifrs4.value - op17.value) <= 2 * max(unit_m(ifrs4), unit_m(op17))
                txt += (f"; equals the IFRS 4 balance of 31.12.2023 ({ifrs4.value:.3f}), so no break" if same else
                        f"; replaces the IFRS 4 balance of 31.12.2023 ({ifrs4.value:.3f} NIS m): basis break")
            f = M.fact("ic.aum", d, op17.value, txt, op17.parts)
            f["basis"] = "IFRS17"
            facts.append(f)
            continue
        v = bal[d]
        txt = "liabilities for yield-dependent investment contracts at the balance date, as printed"
        if y < 2024:
            txt = basis_tag(y) + txt
        facts.append(M.fact("ic.aum", d, v.value, txt, v.parts))

    # ---- ic.dep and ic.fees on every window ----
    flows = [("dep", METRICS["dep"]), ("fees", METRICS["fees"])]
    present = {x["metric"] for x in F if x["segment"] == SEG}
    for name, metric in (("sm", "selling_and_marketing_expenses"), ("ga", "general_and_administrative_expenses")):
        if metric in present:  # only if the reports print it for this activity
            flows.append((name, metric))
    for name, metric in flows:
        wins = flow_windows("ic." + name, collect(F, metric), notes)
        order = sorted(wins, key=lambda lab: (int(lab[-4:]), {"Q1": 1, "H1": 2, "Q2": 3, "9M": 4, "Q3": 5, "FY": 6, "Q4": 7}[lab[:2]]))
        for lab in order:
            v = wins[lab]
            facts.append(M.fact("ic." + name, lab, v.value, v.formula, v.parts))

    # ---- what the reports do not print ----
    for name, metric in (("sm", "selling_and_marketing_expenses"), ("ga", "general_and_administrative_expenses")):
        if metric not in present:
            notes.append({"series": "ic." + name, "key": "all", "rule": "not output: the reports print no selling / acquisition or general / administrative "
                          "expenses for this activity, only one line 'הוצאות תפעוליות אחרות' (metric other_expenses), which is neither; nothing is derived."})
    return facts, notes, F


def anchors(key, facts):
    deck = json.loads((M.ROOT / "web" / "public" / "data" / "lts.json").read_text(encoding="utf-8"))["facts"]
    ours = {(f["metric"], f["period"]): f["value"] for f in facts}
    out = []
    for m, c, p, v, _slide in deck:
        if c != key or m not in ("ic.aum", "ic.dep"):
            continue
        o = ours.get((m, p))
        r = None if o is None else M.rnd(o, 0)
        out.append({"metric": m, "period": p, "deck": v, "ours": r, "ours_exact": o, "ok": r is not None and abs(r - v) < 1e-9})
    return out


def write(key, facts, anc, notes):
    M.OUT.mkdir(parents=True, exist_ok=True)
    dest = M.OUT / f"ic_{key}.json"
    row = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    body = ('{"company":%s,\n"facts":[\n%s\n],\n"anchors":[\n%s\n],\n"notes":[\n%s\n]}\n'
            % (row(key), ",\n".join(map(row, facts)), ",\n".join(map(row, anc)), ",\n".join(map(row, notes))))
    dest.write_text(body, encoding="utf-8")
    ok = sum(a["ok"] for a in anc)
    print(f"{key}: {len(facts)} facts, anchors {ok}/{len(anc)} -> {dest}")
    for a in anc:
        if not a["ok"]:
            print("  MISS", a["metric"], a["period"], "deck", a["deck"], "ours", a["ours"], a["ours_exact"])
    return ok, len(anc)


if __name__ == "__main__":
    tot = [0, 0]
    for k in KEYS:
        facts, notes, _ = build(k)
        ok, n = write(k, facts, anchors(k, facts), notes)
        tot[0] += ok
        tot[1] += n
    print(f"all insurers: anchors {tot[0]}/{tot[1]}")
