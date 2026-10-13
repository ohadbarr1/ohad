"""Clal Pension & Gemel (כלל פנסיה וגמל): raw report facts -> base series -> deck metrics (data/lts_norm/clal.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

Clal's reports print the fund-type table with one column per fund type (extraction: `fund_type`) and, for assets and
collected fees, one row per population (extraction: `member_status`). The library separates same-metric facts of one
segment by `component` / `population`, so the two extraction fields are copied onto those keys (in memory only)."""
import lts_method as M

CO = "clal"
PEN = ("pension_new",)    # comprehensive + general new pension funds; Clal manages no veteran funds, so aum == aum_new
GEM = ("provident",)     # the four provident columns: gemel, study funds, investment gemel, central funds


def prep(x):
    y = dict(x)
    if x.get("fund_type"):
        y["component"] = x["fund_type"]
    if x.get("member_status"):
        y["population"] = x["member_status"]
    return y


def bad(x):
    """Known extraction error, excluded (the raw file is not touched): the 2024Q1 report's prior-year-end column of the
    fund-type table (dated 2023-12-31, window fy) carries the FY2022 pension new-business premiums (comprehensive 1,557,589,
    general 164,521 = the FY2022 figures of the 2024FY report) instead of FY2023 (1,536,584 / 91,473 in 2023FY, 2024FY, 2025FY)."""
    return (x["file"] == "2024Q1" and x["metric"] == "new_business_annualized_premiums" and x["segment"] == "pension_new"
            and x["window"] == "fy" and x["date"] == "2023-12-31")


def fund_table(x):
    """Fund-type table of the business description / directors' report. (Note 18ב of the financial statements repeats
    collected fees from assets with slightly different figures in FY2021-2023; the fund-type table is the one source.)"""
    return "fund-type table" in x["table"]


def seg_note(x):
    """Operating-segments note of the financial statements (pension column / provident column, which includes the
    provident funds managed for the parent company). Not note 18ב and not the directors' report presentation."""
    return x["table"].startswith("operating segments note") and not x.get("component")


def build():
    F = [prep(x) for x in M.load(CO) if not bad(x)]
    notes = [{"series": "pen.nb", "key": "FY2023", "rule": "2024Q1 facts for pension new-business premiums dated 2023-12-31 (window fy) are "
              "excluded: they repeat the FY2022 figures (extraction error, wrong column)"}]

    def flow(name, metric, segs, scale, extra=fund_table):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant" and extra(x), scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def bal(name, segs):
        # total-net-assets row (members + pension recipients), summed over the fund-type columns
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] in segs and x["window"] == "instant"
                      and fund_table(x) and x.get("member_status") == "total", 1e9)
        return M.choose(c, name, notes)

    total = lambda x: fund_table(x) and x.get("member_status") == "total"  # fees from assets: active + inactive + pension recipients
    pen = {
        "aum": bal("pen.aum", PEN),
        "tr_in": flow("pen.tr_in", "transfers_in", PEN, 1e9),
        "tr_out": flow("pen.tr_out", "transfers_out", PEN, 1e9),
        "dep": flow("pen.dep", "deposits", PEN, 1e9),
        "nb": flow("pen.nb", "new_business_annualized_premiums", PEN, 1e9),
        "fees_a": flow("pen.fees_a", "management_fees_from_assets", PEN, 1e6, total),
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", PEN, 1e6),
        "fees": flow("pen.fees", "management_fees", PEN, 1e6, seg_note),
        "sm": flow("pen.sm", "selling_and_marketing_expenses", PEN, 1e6, seg_note),
        "ga": flow("pen.ga", "general_and_administrative_expenses", PEN, 1e6, seg_note),
    }
    gem = {
        "aum": bal("gem.aum", GEM),
        "tr_in": flow("gem.tr_in", "transfers_in", GEM, 1e9),
        "tr_out": flow("gem.tr_out", "transfers_out", GEM, 1e9),
        "dep": flow("gem.dep", "deposits", GEM, 1e9),
        "fees": flow("gem.fees", "management_fees", GEM, 1e6, seg_note),
        "sm": flow("gem.sm", "selling_and_marketing_expenses", GEM, 1e6, seg_note),
        "ga": flow("gem.ga", "general_and_administrative_expenses", GEM, 1e6, seg_note),
    }
    notes += [
        {"series": "pen.out_rate", "key": "Q4-2025", "rule": "deck 9.5 implies transfers out of about 3.97 bn; printed FY2025 13.202 - 9M-2025 9.565 = 3.638 "
         "(8.71%). The deck's four 2025 quarterly rates (Q1-Q3 reproduce) imply a year of about 13.5, above the printed 13.202 that the deck's own FY2025 rate (8.4) uses."},
        {"series": "pen.out_rate", "key": "Q2-2026", "rule": "7.129 against 7.2: needs average assets of at most 181.7 (ours (175.134 + 189.279) / 2 = 182.2) or transfers out of at least 3.27 (ours 3.247)."},
        {"series": "pen.gross_m", "key": "H1-2026", "rule": "(227.665 - 77.229) x 2 / 180.04 = 0.1671 against 0.165, which needs average assets of 181.8-182.9; the deck's own op_m (0.028), sm_aum (0.09) and ga_aum (0.14) of H1-2026 reproduce with 180.04."},
        {"series": "gem.sm_aum / gem.ga_aum", "key": "H1-2026", "rule": "deck 0.29 / 0.22 need average assets of about 65.8 / 66.6 (Dec-25 assets 66.2), while the deck's gem.fee_a 0.488, gross_m 0.22 and sm_fees 55 / ga_fees 42 of the same period reproduce with 70.7; "
         "fee_a x sm_fees = 0.27 and fee_a x ga_fees = 0.21 are what the deck's own figures imply."},
    ]
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)

