"""Phoenix Pension & Gemel: raw report facts -> base series -> deck metrics (data/lts_norm/phoenix.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md."""
import lts_method as M

CO = "phoenix"
PEN_NEW = ("pension_new_comprehensive", "pension_new_general")
PEN_ALL = PEN_NEW + ("pension_veteran",)
GEM = ("provident_gemel", "provident_study_fund", "provident_investment", "provident_child_savings",
       "provident_central_severance", "provident_central_annuity", "other")  # every non-pension column of the fund tables


BASIS_2024 = ("9M-2024 provident transfers as printed (in 4.271, out 7.432, NIS bn) are below the H1-2024 figures (4.953, 7.583) "
              "and far below FY2024 (10.790, 14.235): the Q3-2024 report is on another basis (the deck says the 2024 figures of "
              "the statements include transfers between tracks). 9M-2024, Q3-2024 and Q4-2024 are not derived.")


def bad(x):
    """Known extraction error, excluded (the raw file is not touched): in 2025FY the segment-note facts dated 2023-12-31
    (window fy) for fees and expense lines carry the 9M-2024 column (e.g. pension management fees 263,256 = 9M-2024;
    the 2023 annual report prints 312,047)."""
    return (x["file"] == "2025FY" and x["date"] == "2023-12-31" and x["segment"] in ("pension", "provident")
            and x["metric"] in ("management_fees", "selling_and_marketing_expenses", "general_and_administrative_expenses"))


def build():
    F = [x for x in M.load(CO) if not bad(x)]
    notes = [{"series": "fees / sm / ga", "key": "FY2023", "rule": "2025FY facts dated 2023-12-31 for the pension and provident "
              "segment lines are excluded: they repeat the 9M-2024 column (extraction error)"}]

    def flow(name, metric, segs, scale):
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant", scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def bal(name, segs):
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] in segs and x["window"] == "instant", 1e9)
        return M.choose(c, name, notes)

    def add(a, b):  # sum of two base series, report by report
        both = lambda x, y: {k: M.V(x[k].value + y[k].value, x[k].parts + y[k].parts) for k in x if k in y}
        return {"first": both(a["first"], b["first"]), "annual": both(a["annual"], b["annual"]), "q": both(a["q"], b["q"]),
                "all": {k: both(a["all"][k], b["all"][k]) for k in a["all"] if k in b["all"]}}

    def drop(series, key, why):  # a printed figure that is not on the basis of its neighbours
        for part in ("first", "annual", "all"):
            series[part].pop(key, None)
        notes.append({"series": why[0], "key": M.label(key), "rule": why[1]})
        return series

    pen = {
        "aum": bal("pen.aum", PEN_ALL),        # the deck's pension assets include the veteran funds
        "aum_new": bal("pen.aum_new", PEN_NEW),  # activity-table metrics: new funds only
        "tr_in": flow("pen.tr_in", "transfers_in", PEN_NEW, 1e9),
        "tr_out": flow("pen.tr_out", "transfers_out", PEN_NEW, 1e9),
        "dep": flow("pen.dep", "deposits", PEN_NEW, 1e9),
        "nb": flow("pen.nb", "new_business_annualized_premiums", PEN_NEW, 1e9),
        "fees_a": add(flow("pen.fees_a", "management_fees_from_assets", PEN_NEW, 1e6),
                      flow("pen.fees_a (pensioners)", "management_fees_from_assets_pensioners", PEN_NEW, 1e6)),
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", PEN_NEW, 1e6),
        "fees": flow("pen.fees", "management_fees", ("pension",), 1e6),  # operating-segments note, veteran funds included
        "sm": flow("pen.sm", "selling_and_marketing_expenses", ("pension",), 1e6),
        "ga": flow("pen.ga", "general_and_administrative_expenses", ("pension",), 1e6),
    }
    gem = {
        "aum": bal("gem.aum", GEM),
        "tr_in": drop(flow("gem.tr_in", "transfers_in", GEM, 1e9), (2024, 9), ("gem.tr_in", BASIS_2024)),
        "tr_out": drop(flow("gem.tr_out", "transfers_out", GEM, 1e9), (2024, 9), ("gem.tr_out", BASIS_2024)),
        "dep": flow("gem.dep", "deposits", GEM, 1e9),
        "fees": flow("gem.fees", "management_fees", ("provident",), 1e6),
        "sm": flow("gem.sm", "selling_and_marketing_expenses", ("provident",), 1e6),
        "ga": flow("gem.ga", "general_and_administrative_expenses", ("provident",), 1e6),
    }
    notes.append({"series": "gem.tr_in / gem.tr_out / gem.out_rate", "key": "2023, 2024", "rule": "as printed; the deck says the 2024 figures of "
                  "the statements include transfers between tracks and shows a neutralised FY2024 rate (11.80%). The reports print no "
                  "between-tracks amount, so the neutralised figure cannot be rebuilt: FY2023 / FY2024 and the 2023-2024 quarters "
                  "are not comparable with 2025 onwards."})
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
