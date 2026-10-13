"""Analyst Provident Funds (אנליסט קופות גמל בע"מ): raw report facts -> base series -> deck metrics (data/lts_norm/analyst.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

Analyst is a provident-only managing company: no pension funds, so the `pen` family is empty and only `gem` is built.

Extraction conventions (they changed with the report vintage):
  * the fund-type table has one fact per fund column (`fund_type`) plus the printed total column ("סך הכל": `fund_type`
    'all_funds' in the 2023-2024 files, no `fund_type` and `column` 'סך הכל' from 2025). Columns are summed, the printed
    total is never used (it equals the sum of the columns in every report; checked in the notes below);
  * the central-severance column is `central_severance` in the 2023-2024 files and `other_provident_funds` from 2025
    (same column, label 'קופה מרכזית לפיצויים'); the library separates facts of one segment by `component`, so a working
    copy of each fact gets component = the fund column (renamed to one name) and population = `sub` (assets are printed
    for active / inactive / total members; the all-members row is `total`). No value is touched;
  * the company-level P&L is printed in the financial statements (`financial_statements` / `fs`) and again in the directors'
    report (`directors_report` / `board`); the financial statements are the only source used."""
import lts_method as M

CO = "analyst"
COLUMNS = ("child_savings", "investment_provident", "central_severance", "study_fund", "provident_savings_compensation")
RENAME = {"other_provident_funds": "central_severance"}   # same column, relabelled in the 2025+ files


def prep(x):
    y = dict(x)
    ft = RENAME.get(x.get("fund_type"), x.get("fund_type"))
    if ft:
        y["component"] = ft
    if x.get("sub"):
        y["population"] = x["sub"]
    return y


def src(x):
    return x.get("source_doc") or x.get("doc")


def fs(x):
    """Financial statements (annual `financial_statements`, interim `fs`), not the directors' report table."""
    return src(x) in ("financial_statements", "fs")


def column(x):
    """One fund column of the fund-type table of the business description / directors' report (not the printed total)."""
    return x.get("component") in COLUMNS and x["segment"] == "provident" and x.get("component") != "quarterly_split"


def build():
    F = [prep(x) for x in M.load(CO)]
    # the fund tables are printed in the business description and again in the directors' report of the same file: same
    # facts, collect() counts a fact printed twice with the same value once.
    notes = [
        {"series": "gem.aum / tr_in / tr_out / dep", "key": "all", "rule": "sum of the five fund columns of the fund-type table "
         "(personal gemel for compensation and severance, study funds, investment gemel, child savings, central severance fund); "
         "the printed total column ('סך הכל') equals this sum at every balance date and window (checked), so it is not added again. "
         "Assets: the all-members row (active + inactive). Deposits: 'תקבולים מדמי גמולים' (one-time deposits are a separate row and are not added)."},
        {"series": "gem.fees / sm / ga", "key": "all", "rule": "company level from the financial statements (the company manages only provident "
         "funds: its single segment). fees = 'הכנסות מדמי ניהול'; sm = 'עמלות שיווק והפצה' (agent commissions net of the change in "
         "deferred acquisition costs, distribution commissions); ga = 'הוצאות הנהלה וכלליות' + 'הוצאות בגין קבלת שירותים ושאילת "
         "עובדים מהחברה האם' (the company has no payroll: its staff and services are charged by the parent, so these are its "
         "operating costs other than S&M). Not included: finance and investment income/expense, tax."},
    ]

    def flow(name, metrics, scale):
        c = M.collect(F, lambda x: x["metric"] in metrics and column(x) and x["window"] != "instant", scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def pl(name, metrics):
        c = M.collect(F, lambda x: x["metric"] in metrics and x["segment"] == "provident" and fs(x) and x["window"] != "instant", 1e6)
        return M.choose_base(c, name, notes)

    c = M.collect(F, lambda x: x["metric"] == "aum" and column(x) and x["window"] == "instant" and x.get("population") == "total", 1e9)
    gem = {
        "aum": M.choose(c, "gem.aum", notes),
        "tr_in": flow("gem.tr_in", ("transfers_in",), 1e9),
        "tr_out": flow("gem.tr_out", ("transfers_out",), 1e9),
        "dep": flow("gem.dep", ("deposits",), 1e9),
        "fees": pl("gem.fees", ("management_fees",)),
        "sm": pl("gem.sm", ("selling_and_marketing_expenses",)),
        "ga": pl("gem.ga", ("general_and_administrative_expenses", "other_expenses")),
    }
    notes += [
        {"series": "gem.gross_m / gem.sm_aum", "key": "H1-2026", "rule": "deck gross_m 0.31 needs average assets of at least 87.16 "
         "(ours (83.125 + 91.105) / 2 = 87.115 gives 0.3151), deck sm_aum 0.30 needs them at most 85.65: the two deck figures of one "
         "period are not consistent with one average; no definition reproduces both."},
        {"series": "gem.tr_in / gem.dep", "key": "9M-2024", "rule": "sum of the fund columns differs from the printed total column "
         "(deposits 3,229,051 vs 3,232,872; transfers in 12,571,046 vs 12,567,225, NIS thousands; same 3,821 in opposite directions: "
         "a cell is probably in the wrong row of the Q3-2024 and Q3-2025 extraction). Columns used as printed; not an anchor."},
        {"series": "gem.dep", "key": "Q1-2024, Q1-2025 (and interim windows)", "rule": "the Q1 reports print deposits of 1.415 / 1.904 bn, the quarterly "
         "split of the 2025 annual report 1.108 / 1.749 bn; interim year-to-date deposits are not on the basis of the quarterly split "
         "(full years agree). Report of the period used; not an anchor."},
    ]
    pen = {"aum": {}}   # no pension funds
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
