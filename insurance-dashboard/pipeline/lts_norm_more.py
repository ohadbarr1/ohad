"""More Pension & Gemel (מור גמל ופנסיה בע"מ): raw report facts -> base series -> deck metrics (data/lts_norm/more.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

More's reports print the fund-type table (directors' report / description of the business) with one column per fund
(extraction: `fund_type`; sub-rows in `sub`: active / inactive / pension recipients for assets, active_and_inactive /
recipients / total for collected fees) and no segment total of assets or flows, so the columns are summed here. The library
separates same-metric facts of one segment by `component` / `population`, so the two extraction fields are copied onto
those keys (in memory only; no value is touched).
  pension  = new comprehensive + new general (More manages no veteran funds: aum == aum_new);
  provident = gemel for compensation, study fund, investment gemel, child-savings investment gemel (four columns).
The P&L comes from the operating-segments note (note 3: the `pension` and `provident` columns), never from note 15
(management fees by fund), which is a different cut."""
import lts_method as M

CO = "more"
PEN = ("pension_new",)
GEM = ("provident",)
PEN_FUNDS = ("comprehensive_new_pension", "general_new_pension")
GEM_FUNDS = ("provident_savings_compensation", "study_fund", "investment_provident", "child_savings")


def prep(x):
    y = dict(x)
    if x.get("fund_type"):
        y["component"] = x["fund_type"]
    if x.get("sub"):
        y["population"] = x["sub"]
    return y


def fund_col(x):
    """A fact of one fund column of the fund-type table (not the printed 'total' column, not a segment-level row)."""
    return x.get("fund_type") in PEN_FUNDS + GEM_FUNDS


def seg_note(x, label):
    """Operating-segments note: the `pension` / `provident` column, one printed row (label prefix), no fund split."""
    return x["segment"] in ("pension", "provident") and not x.get("fund_type") and x["label"].startswith(label)


def build():
    F = [prep(x) for x in M.load(CO)]
    # No raw fact is excluded: column sums equal the printed total column in every report (assets, transfers, deposits,
    # new-business premiums, fees from deposits), fees from assets (members + recipients) equal the printed total row, segment
    # fees / S&M / G&A are single-valued in every report, cumulative windows rise within each year, and no two reports print
    # different values for the same period (so no restatement is recorded).
    notes = [
        {"series": "pen.aum / gem.aum", "key": "all", "rule": "sum of the fund columns of the 'total net assets' row (active + inactive + pension recipients) of the "
         "fund-type table; pension = new comprehensive + new general (no veteran funds, aum == aum_new); provident = gemel for compensation, "
         "study fund, investment gemel, child-savings investment gemel. The AUM-by-segment table in NIS millions is not used."},
        {"series": "pen.fees_a", "key": "all", "rule": "collected from assets, fund columns: active_and_inactive + recipients (equals the printed 'total' row)."},
        {"series": "pen.fees / sm / ga, gem.fees / sm / ga", "key": "all", "rule": "operating-segments note, pension and provident columns "
         "(sm = commissions, marketing and other acquisition expenses). Not note 15 (fees by fund)."},
        {"series": "pen.out_rate", "key": "Q4-2025", "rule": "deck 12.4 implies transfers out of about 0.48 bn; printed FY2025 1.1996 - 9M-2025 0.8215 = 0.3781 (9.71%). The deck's FY2025 rate (9.2) and Q1-Q3 reproduce."},
        {"series": "pen.out_rate", "key": "Q2-2026", "rule": "deck 11.0 reproduces (10.95) only with the average assets of the half-year (Dec-25, Jun-26: 18.59); the quarter definition (Mar-26, Jun-26: 19.40) gives 10.50."},
        {"series": "pen.gross_m / pen.op_m", "key": "H1-2026", "rule": "deck 0.229 / -0.168 reproduce (0.2292 / -0.1679) only with the Q2-2026 average assets (19.40); the half-year average (18.59) gives 0.239 / -0.175. Same swap as pen.out_rate Q2-2026."},
        {"series": "gem.gross_m / gem.sm_aum / gem.ga_aum", "key": "H1-2026", "rule": "deck gross_m 0.29 needs average assets of 111.3-115.2 (Q2 average 111.42; half-year 110.40 gives 0.30), while sm_aum 0.38 and ga_aum 0.15 need 104.4-107.2 and 103.1-110.2 (Q1 average 106.33 gives 0.378 / 0.150): the deck uses different averages inside one period."},
    ]

    def flow(name, metric, segs, scale, extra=fund_col):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant" and extra(x), scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def bal(name, segs):
        # "total net assets" row (active + inactive + pension recipients), summed over the fund columns
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] in segs and x["window"] == "instant"
                      and fund_col(x) and x.get("sub") == "total", 1e9)
        return M.choose(c, name, notes)

    def add(a, b):  # sum of two base series, report by report
        both = lambda x, y: {k: M.V(x[k].value + y[k].value, x[k].parts + y[k].parts) for k in x if k in y}
        return {"first": both(a["first"], b["first"]), "annual": both(a["annual"], b["annual"]), "q": both(a["q"], b["q"]),
                "all": {k: both(a["all"][k], b["all"][k]) for k in a["all"] if k in b["all"]}}

    members = lambda x: fund_col(x) and x.get("sub") == "active_and_inactive"
    recips = lambda x: fund_col(x) and x.get("sub") == "recipients"
    from_dep = lambda x: fund_col(x) and x["label"].startswith("דמי ניהול מהפקדות")
    note = lambda lab: (lambda x: seg_note(x, lab))
    FEES, SM, GA = "הכנסות מדמי ניהול", "עמלות, הוצאות שיווק", "הוצאות הנהלה וכלליות"

    pen = {
        "aum": bal("pen.aum", PEN),
        "tr_in": flow("pen.tr_in", "transfers_in", PEN, 1e9),
        "tr_out": flow("pen.tr_out", "transfers_out", PEN, 1e9),
        "dep": flow("pen.dep", "deposits", PEN, 1e9),
        "nb": flow("pen.nb", "new_business_annualized_premiums", PEN, 1e9),
        "fees_a": add(flow("pen.fees_a", "management_fees_from_assets", PEN, 1e6, members),
                      flow("pen.fees_a (pensioners)", "management_fees_from_assets", PEN, 1e6, recips)),
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", PEN, 1e6, from_dep),
        "fees": flow("pen.fees", "management_fees", ("pension",), 1e6, note(FEES)),
        "sm": flow("pen.sm", "selling_and_marketing_expenses", ("pension",), 1e6, note(SM)),
        "ga": flow("pen.ga", "general_and_administrative_expenses", ("pension",), 1e6, note(GA)),
    }
    gem = {
        "aum": bal("gem.aum", GEM),
        "tr_in": flow("gem.tr_in", "transfers_in", GEM, 1e9),
        "tr_out": flow("gem.tr_out", "transfers_out", GEM, 1e9),
        "dep": flow("gem.dep", "deposits", GEM, 1e9),
        "fees": flow("gem.fees", "management_fees", ("provident",), 1e6, note(FEES)),
        "sm": flow("gem.sm", "selling_and_marketing_expenses", ("provident",), 1e6, note(SM)),
        "ga": flow("gem.ga", "general_and_administrative_expenses", ("provident",), 1e6, note(GA)),
    }
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
