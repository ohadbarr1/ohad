"""Menora Mivtachim Pension & Gemel: raw report facts -> base series -> deck metrics (data/lts_norm/menora.json).
Only the mapping lives here; every definition is in lts_method.py / LTS_METHOD.md."""
import lts_method as M

CO = "menora"
PEN_SEG = ("pension", "pension_new")  # the same segment-note column, labelled differently by report vintage
PEN_PL = "ניהול קרנות פנסיה (מקיפה וכללית)"
GEM_PL = "ניהול קופות גמל (קופות גמל וקרנות השתלמות)"  # the guaranteed-return tracks column is a separate segment: not in fees / expenses


def is_summary(x):
    """Summary table of the business description (active, inactive, every class of pension recipients); the track
    table totals of the directors' report (population starting with סה"כ) are a second, different count of assets."""
    return not (x.get("population") or "").startswith('סה"כ')


def build():
    F = M.load(CO)
    notes = []

    def flow(name, metric, seg, scale, extra=lambda x: True, n=None):
        segs = seg if isinstance(seg, tuple) else (seg,)
        c = M.collect(F, lambda x: x["metric"] == metric and x["segment"] in segs and x["window"] != "instant" and extra(x), scale,
                      magnitude=name.split(".")[1] in ("tr_in", "tr_out"))
        return M.choose_base(c, name, notes)

    def bal(name, seg, extra):
        c = M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] == seg and x["window"] == "instant" and extra(x), 1e9)
        return M.choose(c, name, notes)

    pl = lambda comp: (lambda x: x.get("component") == comp)
    pen = {
        "aum": bal("pen.aum", "pension_new", is_summary),
        "tr_in": flow("pen.tr_in", "transfers_in", "pension_new", 1e9),
        "tr_out": flow("pen.tr_out", "transfers_out", "pension_new", 1e9),
        "dep": flow("pen.dep", "deposits", "pension_new", 1e9),
        "nb": flow("pen.nb", "new_business_annualized_premiums", "pension_new", 1e9),
        "fees_a": flow("pen.fees_a", "management_fees_from_assets", "pension_new", 1e6),  # members + pension recipients
        "fees_d": flow("pen.fees_d", "management_fees_from_deposits", "pension_new", 1e6),
        "fees": flow("pen.fees", "management_fees", PEN_SEG, 1e6, pl(PEN_PL)),
        "sm": flow("pen.sm", "selling_and_marketing_expenses", PEN_SEG, 1e6, pl(PEN_PL)),
        "ga": flow("pen.ga", "general_and_administrative_expenses", PEN_SEG, 1e6, pl(PEN_PL)),
    }
    gem = {
        # every provident column, guaranteed-return tracks included; active + inactive rows of the summary table
        "aum": bal("gem.aum", "provident", lambda x: x.get("population") in ("פעילים", "לא פעילים")),
        "tr_in": flow("gem.tr_in", "transfers_in", "provident", 1e9),
        "tr_out": flow("gem.tr_out", "transfers_out", "provident", 1e9),
        "dep": flow("gem.dep", "deposits", "provident", 1e9),
        "fees": flow("gem.fees", "management_fees", "provident", 1e6, pl(GEM_PL)),
        "sm": flow("gem.sm", "selling_and_marketing_expenses", "provident", 1e6, pl(GEM_PL)),
        "ga": flow("gem.ga", "general_and_administrative_expenses", "provident", 1e6, pl(GEM_PL)),
    }
    # the second printed count of pension assets (track table), kept for the record only
    alt = M.choose(M.collect(F, lambda x: x["metric"] == "aum" and x["segment"] == "pension_new"
                             and (x.get("population") or "").startswith('סה"כ כולל'), 1e9), "pen.aum (track table)", [])
    for d in sorted(alt):
        if d in pen["aum"]:
            notes.append({"series": "pen.aum", "key": d, "used": round(pen["aum"][d].value, 3), "other": round(alt[d].value, 3),
                          "rule": "summary table (active + inactive + pension recipients) is used; `other` is the total of the "
                                  "directors' report track table (incl. existing entitled / recipients), printed in the same report"})
    return {"pen": pen, "gem": gem}, notes


if __name__ == "__main__":
    base, notes = build()
    M.write(CO, base, notes)
