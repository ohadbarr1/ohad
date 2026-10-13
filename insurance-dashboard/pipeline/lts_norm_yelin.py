"""Yelin Lapidot provident funds (ילין לפידות ניהול קופות גמל): raw report facts -> base series -> deck metrics (data/lts_norm/yelin.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

The managing company's own reports were not reachable. The extraction therefore comes from the reports of its parent
(אטראו שוקי הון), which print (a) the fund-type table of the business description (assets per fund type) and (b) the
financial statements of Yelin Lapidot Holdings (100%, an associate) with one line "הכנסות מניהול קופות גמל".
Provident only: Yelin manages no pension funds, so the pension family is empty."""
import lts_method as M

CO = "yelin"
GEM_TYPES = ("gemel_savings", "study_fund", "central_severance", "investment_gemel")  # the four fund-type rows of the table
# printed 'total' rows (fund_type 'total' / segment 'total') are not summed: the columns are (and equal the printed total)


def prep(x):
    y = dict(x)
    if x.get("fund_type"):
        y["component"] = x["fund_type"]
    return y


def build():
    F = [prep(x) for x in M.load(CO)]
    notes = [
        {"series": "gem.aum", "key": "all", "rule": "sum of the four fund-type rows (gemel, study funds, central severance, investment gemel) of the "
         "parent's table 'data on the provident funds managed by Y.L. Gemel'; equals the printed 'total' row at every balance date "
         "(Dec-20 to Dec-25). Balance dates exist only at 31 December: no March / June / September balance is extracted."},
        {"series": "gem.fees", "key": "all", "rule": "'הכנסות מניהול קופות גמל' from the statements of Yelin Lapidot Holdings (100%, associate of the "
         "parent), the only P&L line extracted. The group's holding company manages all the group's provident funds, so this is the "
         "provident management-fee income; no segment note of the managing company itself is extracted."},
        {"series": "gem.tr_in / tr_out / dep / out_rate", "key": "all", "rule": "not built: the parent's table prints 'deposits, clearing fees and "
         "transfers in' and 'withdrawals and transfers out' as combined columns (FY2023-FY2025). Transfers cannot be separated from deposits "
         "or from withdrawals, and the tables are not printed at all in the interim reports. The combined columns are not used as tr_in / tr_out."},
        {"series": "gem.sm / ga / op / gross_m / op_m / sm_fees / sm_aum / ga_fees / ga_aum", "key": "all", "rule": "not built: no selling-and-marketing "
         "or general-and-administrative expense of the provident funds is printed (the parent prints expenses only for the whole Yelin Lapidot "
         "group; the holding's notes give DAC amortisation 42.173 / 26.094 and 'provident funds operations' 18.713 / 16.435 / 13.146, which are "
         "not S&M or G&A and are not mapped)."},
        {"series": "gem.aum", "key": "2026-06", "rule": "not built: no Jun-2026 (or any 2026) balance in the extraction, so the deck's 82 and every H1-2026 / "
         "quarterly average-assets metric (fee_a H1-2026 0.657, Q-rates) have no opening-or-closing balance."},
    ]

    def bal(name):
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] == "provident" and x["window"] == "instant"
                      and x.get("fund_type") in GEM_TYPES, 1e9)
        return M.choose(c, name, notes, n_parts={k: len(GEM_TYPES) for k in c})

    def flow(name, metric, scale):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] == "provident" and x["window"] != "instant", scale)
        return M.choose_base(c, name, notes)

    pen = {"aum": {}}  # no pension funds
    gem = {
        "aum": bal("gem.aum"),
        "fees": flow("gem.fees", "management_fees", 1e6),
    }
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
