"""Meitav Gemel and Pension (מיטב גמל ופנסיה): raw report facts -> base series -> deck metrics (data/lts_norm/meitav.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

Meitav's extraction has one fact per fund column (`fund_type`) and, for assets, a population in `sub` (active / inactive /
recipients / total). The library keys a fact on (segment, component, population), so a working copy of each fact gets
component = fund_type and population = sub; no value is touched.
Meitav manages new pension funds only (comprehensive + general), so aum == aum_new (no `aum_new` series is given)."""
import lts_method as M

CO = "meitav"
PEN = ("pension_new",)   # comprehensive + general new pension funds (two columns); no veteran fund
GEM = ("provident",)     # five provident columns: personal gemel (compensation + severance), study funds, investment gemel,
                         # child savings, "other" (central severance funds and the central fund for budget pensions)


def prep(x):
    y = dict(x)
    y["component"] = x.get("fund_type")
    y["population"] = x.get("sub")
    return y


def fund_table(x):
    """Fund-type table of the directors' report / description of the business: one fact per fund column. Not the fs notes
    13 / 14א / 14ב (per-fund note tables, also keyed by fund column, which repeat figures on other bases) and not the
    'total' segment (column 'סך הכל')."""
    return bool(x.get("fund_type")) and not (x.get("table") or "").startswith("באור")


def collected_from_assets(x):
    """Fees collected from assets, fund-type table: one fact per fund column and population (active + inactive; pension
    recipients). The 2023FY / 2024FY files carry no table name on note 13, whose per-fund 'from accrual' figures (no
    population) have the same metric: they are not the collected-from-assets rows and would be added a second time."""
    return fund_table(x) and x.get("population") in ("active_and_inactive", "recipients")


def seg_note(x):
    """Operating-segments note (באור 3: gemel / pension / unallocated) of the financial statements."""
    return x["segment"] in ("pension", "provident") and not x.get("fund_type")


def build():
    F = [prep(x) for x in M.load(CO)]
    notes = [
        {"series": "pen.aum / gem.aum", "key": "all", "rule": "sum over the fund-type columns of the 'total' population row (active + inactive + "
         "pension recipients, already added up in the report) of the fund-type table. Pension = comprehensive + general new funds "
         "(Meitav manages no veteran fund). Provident = personal gemel, study funds, investment gemel, child savings, other central funds."},
        {"series": "pen.tr_* / dep / nb / fees_a / fees_d", "key": "all", "rule": "fund-type table, summed over the two new-fund columns. "
         "fees_a = active+inactive plus pension recipients populations of the collected-from-assets rows."},
        {"series": "pen.fees / sm / ga ; gem.fees / sm / ga", "key": "all", "rule": "operating-segments note: pension segment (new funds) and "
         "provident segment, rows 'הכנסות מדמי ניהול', 'עמלות, הוצאות שיווק והוצאות רכישה אחרות', 'הוצאות הנהלה וכלליות'. The "
         "management fee Meitav pays to its controlling company (management_fees_to_controlling_company) is a separate expense line, "
         "not part of S&M or G&A, and is not deducted (the shared method defines op = fees - sm - ga)."},
    ]

    def flow(name, metric, segs, scale, extra=fund_table):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant" and extra(x), scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def add(a, b):
        both = lambda x, y: {k: M.V(x[k].value + y[k].value, x[k].parts + y[k].parts) for k in x if k in y}
        return {"first": both(a["first"], b["first"]), "annual": both(a["annual"], b["annual"]), "q": both(a["q"], b["q"]),
                "all": {k: both(a["all"][k], b["all"][k]) for k in a["all"] if k in b["all"]}}

    def bal(name, segs):
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] in segs and x["window"] == "instant"
                      and fund_table(x) and x.get("population") == "total", 1e9)
        return M.choose(c, name, notes)

    pen = {
        "aum": bal("pen.aum", PEN),
        "tr_in": flow("pen.tr_in", "transfers_in", PEN, 1e9),
        "tr_out": flow("pen.tr_out", "transfers_out", PEN, 1e9),
        "dep": flow("pen.dep", "deposits", PEN, 1e9),
        "nb": flow("pen.nb", "new_business_annualized_premiums", PEN, 1e9),
        "fees_a": flow("pen.fees_a", "management_fees_from_assets", PEN, 1e6, collected_from_assets),  # active+inactive plus recipients
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", PEN, 1e6),
        "fees": flow("pen.fees", "management_fees", ("pension",), 1e6, seg_note),
        "sm": flow("pen.sm", "selling_and_marketing_expenses", ("pension",), 1e6, seg_note),
        "ga": add(flow("pen.ga", "general_and_administrative_expenses", ("pension",), 1e6, seg_note),
                 flow("pen.ga (parent)", "management_fees_to_controlling_company", ("pension",), 1e6, seg_note)),
    }
    gem = {
        "aum": bal("gem.aum", GEM),
        "tr_in": flow("gem.tr_in", "transfers_in", GEM, 1e9),
        "tr_out": flow("gem.tr_out", "transfers_out", GEM, 1e9),
        "dep": flow("gem.dep", "deposits", GEM, 1e9),
        "fees": flow("gem.fees", "management_fees", ("provident",), 1e6, seg_note),
        "sm": flow("gem.sm", "selling_and_marketing_expenses", ("provident",), 1e6, seg_note),
        "ga": add(flow("gem.ga", "general_and_administrative_expenses", ("provident",), 1e6, seg_note),
                 flow("gem.ga (parent)", "management_fees_to_controlling_company", ("provident",), 1e6, seg_note)),
    }
    notes += [
        {"series": "pen.ga / gem.ga", "key": "all", "rule": "ga = 'הוצאות הנהלה וכלליות' + 'דמי ניהול לחברה בעלת שליטה' (management fee to the controlling "
         "company, Meitav Investment House), both rows of the same segment note. Meitav prints the parent fee as its own expense line; "
         "the deck's G&A contains it (pension FY2025 op 65 = 186.0 - 31.4 - 3.6 - 85.9; ga_fees 48 = (3.6 + 85.9) / 186.0), while the "
         "deck's S&M does not (sm_fees 17 = 31.4 / 186.0). Same for the provident segment (FY2025 op 149 = 610.7 - 322.5 - 16.3 - 122.5). "
         "Without the parent fee 19 anchors are lost. Printed profit before tax is not used."},
        {"series": "pen.fees / gem.fees", "key": "all", "rule": "fees = 'הכנסות מדמי ניהול מקופות גמל ומקרנות פנסיה, נטו' only. The separate segment-note line "
         "'הכנסות (החזרי הכנסות) דמי ניהול בגין תביעות משפטיות' (pension FY2024 -2.000; provident FY2023 -2.918, FY2025 +203.235, H1-2026 +1.473) "
         "is not added. The deck's pension FY2024 figures (op 46, gross_m 0.275, op_m 0.097, ga_fees 55) need fees of 151.406 = 153.406 - 2.000, "
         "but its provident FY2025 / H1-2026 figures (op 149 / 119) need 610.674 / 404.150 without the +203.235 / +1.473; no single "
         "rule on the printed row reproduces both, so the mapping is not adapted: 4 pension FY2024 anchors are missed."},
        {"series": "pen.out_rate", "key": "Q4-2025", "rule": "deck 9.1 implies transfers out of about 1.66 bn in the quarter (average assets 72.80); printed FY2025 4.927 - 9M-2025 3.499 = 1.427 "
         "(7.84%). The deck's Q1-Q3 2025 rates reproduce, and with Q4 at 1.66 the four quarters would sum to 5.15 bn, above the printed year 4.927 that the deck's own FY2025 rate (7.6) uses."},
        {"series": "pen.out_rate", "key": "Q2-2026", "rule": "1.693 x 4 / 82.59 = 8.20 against 8.4, which needs average assets of 80.1-81.1 (Mar-26 78.70, Jun-26 86.49; Dec-25 75.46); no balance pair gives it. The deck's Q2-2026 transfers (1.7) reproduce."},
        {"series": "pen.fee_d", "key": "FY2024, FY2025, H1-2026", "rule": "fees collected from deposits / deposits: 93.094 / 7.106 = 1.31 (the printed average rates are 1.31 comprehensive, 1.11 general) against deck 1.28; "
         "100.362 / 8.077 = 1.24 against 1.23; 50.730 / 4.187 = 1.21 against 1.20. The deck's figures imply deposits 0.6-3% higher than printed (7.24-7.30, 8.13-8.19, 4.21-4.25 bn); "
         "one-time deposits (0.004 bn) do not explain it and no printed row does."},
        {"series": "pen.gross_m / pen.op_m", "key": "H1-2026", "rule": "(105.251 - 19.904) x 2 / 80.97 = 0.211 against 0.207; the deck's 0.207 / 0.104 reproduce with the average of Mar-26 and Jun-26 assets (82.59), i.e. a quarter average "
         "in a half-year metric; the deck's own pen.fee_a (0.136) and pen.ga_aum (0.10) of H1-2026 use the Dec-25 / Jun-26 average (80.97)."},
        {"series": "gem.sm_aum / gem.op_m", "key": "H1-2026", "rule": "deck sm_aum 0.32 needs average assets of 132.8-136.9 and op_m 0.16 needs 143.7-152.9, while gross_m 0.26 needs 142.2-147.8 and ours is 143.34 "
         "(Dec-25 130.78, Jun-26 155.90): the deck is not consistent with itself; ours gives 0.30 and 0.17 (0.1654)."},
    ]
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
