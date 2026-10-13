"""Harel Pension & Gemel (הראל פנסיה וגמל בע"מ): raw report facts -> base series -> deck metrics (data/lts_norm/harel.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md.

Harel's extraction has one fact per fund column (`column` / `fund_type`) and, for the fee table, a population in `sub`
(active_and_inactive / recipients / total). The library keys a fact on (segment, component, population), so a working
copy of each fact gets component = fund_type and population = sub; no value is touched."""
import lts_method as M

CO = "harel"
PEN_NEW = ("pension_new",)               # comprehensive + general new funds (two columns)
PEN_ALL = ("pension_new", "pension_veteran")  # the deck's pension assets include the veteran fund
# provident = the five provident columns of the fund-type tables; קחצ"ק (army career savings fund) is a separate
# managing company and is not in the Harel tables at all.


def prep(x):
    y = dict(x)
    y["component"] = x.get("fund_type") or x.get("column")
    y["population"] = None if x.get("sub") in (None, "total") else x["sub"]  # the all-members column of a population split
    return y


def build():
    F = [prep(x) for x in M.load(CO)]
    notes = [
        {"series": "pen.aum / gem.aum", "key": "all", "rule": "sum of the fund-type columns of the business-description table; equals the printed 'סה\"כ קרנות "
         "פנסיה' / 'סה\"כ קופות גמל' of the managed-assets table at every balance date. Pension = new comprehensive + new general + "
         "veteran fund (קרן פנסיה ותיקה ה.ע.ל); provident = personal gemel, study funds, investment gemel, child savings, other "
         "central funds. קחצ\"ק is a separate managing company and is in none of the Harel tables."},
        {"series": "pen.tr_* / dep / nb / fees_a / fees_d", "key": "all", "rule": "new funds only (comprehensive + general columns); the "
         "veteran fund's transfers are printed in a few reports only. fees_a = the all-members column (active + inactive + pension "
         "recipients) of the collected-from-assets table."},
        {"series": "pen.fees / sm / ga", "key": "all", "rule": "segment note, combined pension segment (new funds + veteran fund, as printed); "
         "provident = the provident segment. No report prints a different value for the same period, so no restatement is recorded."},
    ]

    def table(x):  # a fund-type column of the business-description tables (not the 'total' or the AUM-by-product list)
        return bool(x.get("column"))

    def flow(name, metric, segs, scale, extra=lambda x: True):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant" and extra(x), scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def bal(name, segs):
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] in segs and x["window"] == "instant"
                      and table(x) and x.get("population") is None, 1e9)
        return M.choose(c, name, notes)

    pen = {
        "aum": bal("pen.aum", PEN_ALL),
        "aum_new": bal("pen.aum_new", PEN_NEW),
        "tr_in": flow("pen.tr_in", "transfers_in", PEN_NEW, 1e9),
        "tr_out": flow("pen.tr_out", "transfers_out", PEN_NEW, 1e9),
        "dep": flow("pen.dep", "deposits", PEN_NEW, 1e9),
        "nb": flow("pen.nb", "new_business_annualized_premiums", PEN_NEW, 1e9),
        "fees_a": flow("pen.fees_a", "management_fees_from_assets", PEN_NEW, 1e6, lambda x: x.get("sub") == "total"),
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", PEN_NEW, 1e6),
        "fees": flow("pen.fees", "management_fees", ("pension",), 1e6),
        "sm": flow("pen.sm", "selling_and_marketing_expenses", ("pension",), 1e6),
        "ga": flow("pen.ga", "general_and_administrative_expenses", ("pension",), 1e6),
    }
    gem = {
        "aum": bal("gem.aum", ("provident",)),
        "tr_in": flow("gem.tr_in", "transfers_in", ("provident",), 1e9),
        "tr_out": flow("gem.tr_out", "transfers_out", ("provident",), 1e9),
        "dep": flow("gem.dep", "deposits", ("provident",), 1e9),
        "fees": flow("gem.fees", "management_fees", ("provident",), 1e6),
        "sm": flow("gem.sm", "selling_and_marketing_expenses", ("provident",), 1e6),
        "ga": flow("gem.ga", "general_and_administrative_expenses", ("provident",), 1e6),
    }
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
