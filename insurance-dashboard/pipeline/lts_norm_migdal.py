"""Migdal Makefet Pension & Gemel: raw report facts -> base series -> deck metrics (data/lts_norm/migdal.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

Two vintages of the extraction use different field names for the same thing; `prep` reads both into one vocabulary
without changing a value:
  2023FY-2024Q3: `fund_type` = comprehensive_new_pension / general_new_pension / veteran_pension / other_provident_funds /
                 provident_savings_compensation / ..., `sub` = the population row (active, inactive, recipients, or none = total);
                 the directors' report by-fund table carries `sub` = by_fund_*.
  2025FY-2026Q2: `fund_type` = comprehensive / general / veteran / other_funds / personal_provident / ..., `member_status` =
                 the population row, `table` = the table name.
Result of prep: `component` = the fund column (comprehensive, general, veteran, study_fund, ...), `population` = the row
(active, inactive, pension_recipients, total, active_and_inactive) and `fund_table` = True for the fund-type summary table."""
import lts_method as M

CO = "migdal"
COMP = {"comprehensive_new_pension": "comprehensive", "general_new_pension": "general", "veteran_pension": "veteran",
        "other_provident_funds": "other_funds", "provident_savings_compensation": "personal_provident"}
POP = {None: "total", "recipients": "pension_recipients"}
PEN_NEW = ("comprehensive", "general")
PEN_ALL = PEN_NEW + ("veteran",)
GEM = ("personal_provident", "study_fund", "investment_provident", "child_savings", "other_funds")  # every column of the fund-type table that is not pension


def prep(x):
    """Same fact, one vocabulary. Never touches `value`."""
    y = dict(x)
    ft = x.get("fund_type")
    y["component"] = COMP.get(ft, ft)
    pop = x.get("member_status") or x.get("sub")
    y["population"] = POP.get(pop, pop)
    tab = x.get("table") or ""
    by_fund = str(x.get("sub") or "").startswith("by_fund") or tab.startswith("היקף הנכסים")
    y["fund_table"] = bool(ft) and not by_fund and (tab.startswith("ריכוז") or "doc" not in x)
    return y


def build():
    F = [prep(x) for x in M.load(CO)]
    notes = []

    def flow(name, metric, segs, scale, extra=lambda x: True):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant" and extra(x), scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def bal(name, segs, comps):
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] in segs and x["window"] == "instant" and x["fund_table"]
                      and x["component"] in comps and x["population"] == "total", 1e9)
        return M.choose(c, name, notes)

    # fund-type summary table, one column per fund type; "total" row (active + inactive + pension recipients)
    tab = lambda comps, pop="total": (lambda x: x["fund_table"] and x["component"] in comps and x["population"] == pop)
    seg_note = lambda x: x["component"] is None  # operating-segments note (pension segment as printed, veteran funds included)

    pen = {
        "aum": bal("pen.aum", ("pension_new", "pension_veteran"), PEN_ALL),  # new comprehensive + new general + veteran (Yozma)
        "aum_new": bal("pen.aum_new", ("pension_new",), PEN_NEW),
        "tr_in": flow("pen.tr_in", "transfers_in", ("pension_new",), 1e9, tab(PEN_NEW)),
        "tr_out": flow("pen.tr_out", "transfers_out", ("pension_new",), 1e9, tab(PEN_NEW)),
        "dep": flow("pen.dep", "deposits", ("pension_new",), 1e9, tab(PEN_NEW)),
        "nb": flow("pen.nb", "new_business_annualized_premiums", ("pension_new",), 1e9, tab(PEN_NEW)),
        "fees_a": flow("pen.fees_a", "management_fees_from_assets", ("pension_new",), 1e6, tab(PEN_NEW)),  # members + pension recipients
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", ("pension_new",), 1e6, tab(PEN_NEW)),
        "fees": flow("pen.fees", "management_fees", ("pension",), 1e6, seg_note),
        "sm": flow("pen.sm", "selling_and_marketing_expenses", ("pension",), 1e6, seg_note),
        "ga": flow("pen.ga", "general_and_administrative_expenses", ("pension",), 1e6, seg_note),
    }
    gem = {
        "aum": bal("gem.aum", ("provident",), GEM),
        "tr_in": flow("gem.tr_in", "transfers_in", ("provident",), 1e9, tab(GEM)),
        "tr_out": flow("gem.tr_out", "transfers_out", ("provident",), 1e9, tab(GEM)),
        "dep": flow("gem.dep", "deposits", ("provident",), 1e9, tab(GEM)),
        "fees": flow("gem.fees", "management_fees", ("provident",), 1e6, seg_note),
        "sm": flow("gem.sm", "selling_and_marketing_expenses", ("provident",), 1e6, seg_note),
        "ga": flow("gem.ga", "general_and_administrative_expenses", ("provident",), 1e6, seg_note),
    }
    notes += [
        {"series": "pen.aum / gem.aum", "key": "all", "rule": "fund-type summary table, 'total' row (active + inactive + pension recipients), summed over its columns: "
         "pension = comprehensive + general + veteran (Yozma); provident = personal provident + study + investment + child savings + other "
         "(central severance, sick pay, budget pension; IRA tracks sit inside personal / study). Equals the printed segment totals of the "
         "directors' report by-fund table at all 16 balance dates. Deck anchors 153 / 197 / 219 and 37 / 47 / 55 reproduce only with "
         "veteran + recipients (new funds only: 150.9 / 195.1 / 216.5; active + inactive only: 137.1 / 177.6 / 196.7) and with the "
         "'other' column (without it 54.49 at Jun-26 rounds to 54)."},
        {"series": "pen.aum_new", "key": "all", "rule": "comprehensive + general, total row: denominator of out_rate and fee_a (the activity table covers the new funds only; "
         "the veteran fund prints no transfers). With veteran funds in the denominator 96 anchors instead of 101."},
        {"series": "pen.fees / sm / ga, gem.fees / sm / ga", "key": "all", "rule": "operating-segments note, segment 'pension' (new funds + veteran) and 'provident' as printed. "
         "The 'pension_new' column of the same note gives 86 anchors. Amortisation of fund-management rights (provident, printed as other expenses) is not in sm or ga."},
        {"series": "extraction vocabulary", "key": "2023FY-2024Q3 vs 2025FY-2026Q2", "rule": "the two vintages name fund columns and populations differently "
         "(comprehensive_new_pension / comprehensive, recipients / pension_recipients, sub / member_status); `prep` maps them to one vocabulary, no value is touched. "
         "Facts of the by-fund asset table are not used for balances."},
        {"series": "gem.tr_in", "key": "Q1-2025", "rule": "the 'other funds' column has no figure for 31 Mar 2025 in the 2025Q1 and 2026Q1 reports (blank cell, 2024 comparatives are printed): "
         "summed over the four printed columns (the column is NIS 1-4 million a year)."},
        {"series": "pen.sm", "key": "DAC amortisation, 7 to 9 years", "rule": "NOT ADJUSTED. S&M ('עמלות, הוצאות שיווק והוצאות רכישה אחרות') includes the amortisation of deferred acquisition costs. "
         "Printed: 2025FY report, note on DAC (pdf p.135): from 1 June 2025 the company lengthened the average DAC amortisation period in one of the pension contract portfolios from 7 to 9 years "
         "(cancellation rate observed to fall, per the fund actuary's tests); weighted period at 31 Dec 2025 9.2 years pension, 6.5 years provident. Effect printed: lower amortisation expense of about "
         "NIS 10.6m in Q3-2025 (2025Q3 report, pdf p.36 and p.60) and about NIS 21.8m in the six months to 31 Dec 2025 (2025FY report, pdf p.109 and p.148), "
         "i.e. about NIS 11.2m in Q4-2025. No prior period is restated (H1-2025 pension S&M 108.548 is identical in the 2026 comparatives). "
         "Pension S&M: Q1-25 52.8, Q2-25 55.8, Q3-25 45.4, Q4-25 46.2, Q1-26 51.2, Q2-26 42.9 (NIS m). Total DAC amortisation (all segments, board-report narrative, NIS m): "
         "Q1-25 41.1, H1-25 86.7, 9M-25 125.6, FY25 167.1, Q1-26 45.4, H1-26 94.6. Pension S&M, gross margin and operating profit from Q3-2025 are therefore not on the basis of earlier periods."},
        {"series": "deck vs method", "key": "pen.out_rate Q2/Q3/Q4-2025, Q2-2026", "rule": "deck quarterly rates imply transfers out of 2.50 / 2.58 / 3.89 / 3.70 against printed 2.55 / 2.61 / 3.44 / 3.66 (NIS bn). "
         "The deck's own four quarters of 2025 sum to 11.8 against the printed year 11.29 that its FY2025 rate (6.5) uses; same pattern as Menora. Not rebuilt."},
        {"series": "deck vs method", "key": "pen.gross_m, op_m H1-2026", "rule": "deck 0.175 / 0.044 need average assets of 209.7-210.9 / 210.0-214.9; start + end / 2 gives 207.9 (0.177 / 0.045). "
         "The deck's sm_aum 0.09 and ga_aum 0.13 reproduce on 207.9. Same pattern as Phoenix and Menora H1-2026."},
        {"series": "deck vs method", "key": "pen.gross_m FY2023", "rule": "deck 0.215 needs average assets of 110.5-111.0; Dec-22 102.36 and Dec-23 120.48 (both reconcile to the printed totals) give 111.42 (0.214)."},
        {"series": "deck vs method", "key": "gem.gross_m FY2023", "rule": "0.2552 against deck 0.25: needs average assets above 26.37, ours 26.35 (Dec-22 23.59, Dec-23 29.12)."},
        {"series": "deck vs method", "key": "gem.sm_aum, ga_aum H1-2026", "rule": "deck 0.33 / 0.16 need average assets of 46.7-48.1 / 46.9-49.9, below the Dec-25 opening balance 46.87 and the Jun-26 closing 54.77 (ours 50.82). "
         "The deck's own gem.fee_a 0.502 (50.8), sm_fees 61 and gross_m 0.19 imply sm_aum 0.31 and ga_aum 0.15, which we reproduce; the two deck figures are inconsistent with the rest of its column."},
    ]
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
