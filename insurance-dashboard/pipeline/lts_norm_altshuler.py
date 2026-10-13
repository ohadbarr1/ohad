"""Altshuler Shaham Gemel & Pension (אלטשולר שחם גמל ופנסיה): raw report facts -> base series -> deck metrics
(data/lts_norm/altshuler.json). Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

The extraction has two vintages. The 2023FY-2024Q3 files carry the fund column in `fund_type`, the population of a row in
`sub`, and mark every note table with `source_table` (the fund-type tables of the business description have none). The
2025FY-2026Q2 files carry `component`, `population` and `table`. A working copy of each fact gets `component` /
`population` from whichever vintage it is, so the library can key on them; no value is touched.
"""
import lts_method as M

CO = "altshuler"
PEN = ("pension_new",)    # comprehensive + general new pension funds; the company manages no veteran pension fund -> aum == aum_new
GEM = ("provident",)     # personal gemel, study funds, investment gemel, child-savings gemel, central funds ("קופות מרכזיות")

FUND_TABLE_NEW = "נתונים כלליים"   # fund-type table of the business description (directors' report section 2.1)
SEG_NOTE_NEW = "segment note (דיווח בדבר מגזרי פעילות)"
SEG_NOTE_OLD = "ביאור מגזרי פעילות"


def prep(x):
    y = dict(x)
    if "source_entity" in x:  # 2023FY-2024Q3 vintage
        y["component"] = x.get("fund_type") or x.get("column")
        y["population"] = x.get("sub")
        y["is_fund"] = not x.get("source_table")
        y["is_seg"] = x.get("source_table") == SEG_NOTE_OLD
    else:
        y["is_fund"] = (x.get("table") or "").startswith(FUND_TABLE_NEW)
        y["is_seg"] = x.get("table") == SEG_NOTE_NEW
    return y


def build():
    F = [prep(x) for x in M.load(CO)]
    notes = []

    def flow(name, metric, segs, scale, table, extra=lambda x: True):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant" and x[table] and extra(x),
                      scale, magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def bal(name, segs):
        # 'סה"כ נכסים מנוהלים, נטו' row (active + inactive + pension recipients), summed over the fund columns
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] in segs and x["window"] == "instant" and x["is_fund"]
                      and x["population"] == "total", 1e9)
        return M.choose(c, name, notes)

    def add(a, b):  # sum of two base series, report by report
        both = lambda x, y: {k: M.V(x[k].value + y[k].value, x[k].parts + y[k].parts) for k in x if k in y}
        return {"first": both(a["first"], b["first"]), "annual": both(a["annual"], b["annual"]), "q": both(a["q"], b["q"]),
                "all": {k: both(a["all"][k], b["all"][k]) for k in a["all"] if k in b["all"]}}

    total = lambda x: x["population"] in (None, "total")  # the 'סה"כ דמי ניהול שנגבו מנכסים' row

    def seg(name, segs):
        """Segment-note lines. S&M = 'עמלות, הוצאות שיווק והוצאות רכישה אחרות'. G&A = the income statement's 'הוצאות הנהלה
        וכלליות', which the segment note splits into G&A net of operating fees plus 'דמי תפעול' (operating fees)."""
        return {
            "fees": flow(f"{name}.fees", "management_fees", segs, 1e6, "is_seg"),
            "sm": flow(f"{name}.sm", "selling_and_marketing_expenses", segs, 1e6, "is_seg"),
            "ga": add(flow(f"{name}.ga", "general_and_administrative_expenses", segs, 1e6, "is_seg"),
                      flow(f"{name}.ga (operating fees)", "operating_fees", segs, 1e6, "is_seg")),
        }

    pen = {
        "aum": bal("pen.aum", PEN),
        "tr_in": flow("pen.tr_in", "transfers_in", PEN, 1e9, "is_fund"),
        "tr_out": flow("pen.tr_out", "transfers_out", PEN, 1e9, "is_fund"),
        "dep": flow("pen.dep", "deposits", PEN, 1e9, "is_fund"),
        "nb": flow("pen.nb", "new_business_annualized_premiums", PEN, 1e9, "is_fund"),
        "fees_a": flow("pen.fees_a", "management_fees_from_assets", PEN, 1e6, "is_fund", total),
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", PEN, 1e6, "is_fund"),
        **seg("pen", ("pension",)),
    }
    gem = {
        "aum": bal("gem.aum", GEM),
        "tr_in": flow("gem.tr_in", "transfers_in", GEM, 1e9, "is_fund"),
        "tr_out": flow("gem.tr_out", "transfers_out", GEM, 1e9, "is_fund"),
        "dep": flow("gem.dep", "deposits", GEM, 1e9, "is_fund"),
        **seg("gem", ("provident",)),
    }
    notes += [
        {"series": "pen.aum / gem.aum", "key": "all", "rule": "'סה\"כ נכסים מנוהלים, נטו' row of the fund-type table (active + inactive + pension recipients), summed over the fund "
         "columns: pension = new comprehensive + new general (no veteran funds, so aum == aum_new); provident = personal gemel, study funds, investment "
         "gemel, child-savings gemel, central funds. Reproduces the deck's 34 / 39 / 38 and 132 / 125 / 112."},
        {"series": "pen.tr_* / dep / nb / fees_a / fees_d, gem.tr_* / dep", "key": "all", "rule": "fund-type table of the business description (one column per "
         "fund, YTD from 1 January); transfers printed negative are taken as amounts; fees_a = the 'סה\"כ דמי ניהול שנגבו מנכסים' row (active + inactive + recipients); "
         "one-time deposits are not added to dep. The audited fee note (2023FY / 2024FY only) is not used: it differs from the table by a reclassification of 17 "
         "between asset and deposit fees in the general fund."},
        {"series": "pen.fees / sm / ga, gem.fees / sm / ga", "key": "all", "rule": "operating-segments note, pension column and provident column. fees = 'הכנסות מדמי ניהול, נטו'; "
         "sm = 'עמלות, הוצאות שיווק והוצאות רכישה אחרות'; ga = the income statement's 'הוצאות הנהלה וכלליות', which the segment note prints in two lines: G&A net of "
         "operating fees plus 'דמי תפעול' (operating fees), both summed. The gemel 'additional data' table (gross of refunds, by fund) is not used."},
        {"series": "pen.fee_d", "key": "FY2024, FY2025, H1-2026", "rule": "deck 1.35 / 1.27 / 1.26 against 1.31 / 1.24 / 1.23 from the printed 'fees collected from deposits' row. The deck figures equal "
         "(segment management fees - fees collected from assets) / deposits: 54.449 / 4.047 = 1.345, 54.220 / 4.285 = 1.265, 24.864 / 1.978 = 1.257. "
         "The difference is the refunds line of the fee note (FY2024: assets 43.720 + deposits 53.186 + refunds received 1.281 = segment fees 98.186), which is printed "
         "as a separate row only in the 2023FY / 2024FY fee note and not at all in 2025FY - 2026Q2; no printed deposit-fee row gives it."},
        {"series": "pen.sm_fees / sm_aum / ga_fees / ga_aum, gem.same", "key": "H1-2026", "rule": "the deck puts operating fees in S&M for H1-2026 (pension sm_fees 24 = (10.615 + 2.655) / 54.707, ga_fees 54 = 29.374 / 54.707; "
         "provident sm_fees 39, ga_fees 51) but in G&A for FY2024 and FY2025 (pension sm_fees 17 / 19, ga_fees 60 / 56 reproduce only with operating fees in G&A). One mapping for all periods "
         "keeps operating fees in G&A: 88 anchors against 74 with operating fees in S&M. Same cause: pen.gross_m and gem.gross_m of H1-2025 (deck 0.23 / 0.36 are (fees - S&M - operating fees); "
         "the library gives 0.245 / 0.38)."},
        {"series": "pen.gross_m", "key": "H1-2026", "rule": "deck 0.221; (54.707 - 10.615) x 2 / 38.222 = 0.2307, with operating fees in S&M 0.2168. 0.221 needs average assets of 37.4-37.6 (Mar-26 / Jun-26 average 37.425), while the deck's own "
         "ga_aum 0.15 needs 37.9 or more."},
        {"series": "pen.gross_m / pen.op_m", "key": "FY2024", "rule": "0.266065 against 0.267 and 0.074985 against 0.076: average assets would have to be 30.56 / 30.40 or less, ours (27.442 + 33.775) / 2 = 30.609."},
        {"series": "pen.out_rate", "key": "Q2-2026", "rule": "28.38 against 27.8: the deck's 27.8 equals Q2 transfers 2.655 x 4 / 38.222, i.e. the half-year average assets (Dec-25, Jun-26) instead of the quarter average 37.425. "
         "Provident Q2-2026 (33.0) uses the quarter average."},
        {"series": "pen.out_rate", "key": "Q3-2025, Q4-2025", "rule": "deck 17.8 / 22.6 imply transfers out of 1.68 / 2.17 bn against the printed 9M - H1 = 1.568 and FY - 9M = 1.901; the deck's four 2025 quarters sum to about 6.4 "
         "against the printed year 6.039 that the deck's own FY2025 (6.0 bn, 16.7%) uses. Q1 and Q2 reproduce. No definition tested gives it."},
        {"series": "gem.out_rate", "key": "Q3-2025, Q4-2025", "rule": "21.15 / 20.53 against 20.7 / 20.1. The deck figures imply a September-2025 provident balance of about 134.5 bn (both quarters), against the printed 129.075 "
         "(2025Q3 report; Jun-25 130.053, Dec-25 125.347). Q1-2025, Q2-2025 and both 2026 quarters reproduce."},
    ]
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
