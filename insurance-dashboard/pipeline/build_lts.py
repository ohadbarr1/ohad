"""Long-term savings, sector comparison: web/public/data/lts.json.

The anchor is the deck "חיסכון ארוך טווח, השוואות ענפיות, Q2-2026" (figures checked by its authors). Every figure is keyed
metric x company x period and carries the slide it was read from. Other periods are added to the same file as they are
built from the reports; nothing here is estimated.

Periods: a balance date is "2026-06"; a flow window is "FY2025", "H1-2026", "9M-2025" or "Q2-2026".
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECK = "מצגת השוואות ענפיות, חיסכון ארוך טווח, Q2'26"

CO = {"phoenix": "הפניקס", "menora": "מנורה", "harel": "הראל", "clal": "כלל", "migdal": "מגדל", "meitav": "מיטב", "altshuler": "אלטשולר",
      "more": "מור", "yelin": "ילין", "analyst": "אנליסט", "hachshara": "הכשרה", "ayalon": "איילון", "direct": "ישיר", "all": "מצרפי"}
PEN = ["phoenix", "menora", "clal", "migdal", "harel", "altshuler", "meitav", "more"]
GEM = PEN + ["yelin", "analyst"]
AM = ["phoenix", "menora", "clal", "migdal", "harel", "altshuler", "meitav", "more", "yelin", "analyst", "hachshara", "ayalon", "direct"]
IC = ["phoenix", "hachshara", "migdal", "harel", "clal", "ayalon", "menora", "direct"]

D4 = ["2023-12", "2024-12", "2025-12", "2026-06"]
D3 = D4[1:]
F3 = ["FY2024", "FY2025", "H1-2026"]
A3 = ["FY2023", "FY2024", "FY2025"]
H3 = ["H1-2024", "H1-2025", "H1-2026"]
Q6 = ["Q1-2025", "Q2-2025", "Q3-2025", "Q4-2025", "Q1-2026", "Q2-2026"]

facts = []


def put(metric, slide, periods, rows, order=None):
    """rows: {company: [values per period]} or, with `order`, a list of per-period lists in company order."""
    if order is not None:
        rows = {c: [r[i] for r in rows] for i, c in enumerate(order)}
    for c, vals in rows.items():
        assert c in CO, c
        assert len(vals) == len(periods), (metric, c)
        for p, v in zip(periods, vals):
            if v is not None:
                facts.append([metric, c, p, v, slide])


# ---- asset management: pension + provident + investment contracts (slides 4-7) ----
put("am.aum", 4, D4, {"menora": [262, 309, 365, 397], "harel": [227, 273, 320, 355], "phoenix": [191, 233, 296, 329], "clal": [192, 215, 251, 280],
                      "migdal": [155, 197, 256, 289], "meitav": [120, 156, 206, 242], "altshuler": [157, 166, 164, 150], "more": [70, 87, 122, 136],
                      "yelin": [55, 78, 87, 82], "analyst": [30, 54, 83, 91], "hachshara": [16, 21, 27, 29], "ayalon": [1, 1, 3, 6], "direct": [0, 0, 0, 0],
                      "all": [1476, 1791, 2180, 2387]})
put("am.aum.g", 4, ["2026-06"], {"menora": [8.8], "harel": [10.8], "phoenix": [11.2], "clal": [11.7], "migdal": [12.6], "meitav": [17.5], "altshuler": [-8.4],
                                 "more": [11.9], "yelin": [-5.6], "analyst": [9.6], "hachshara": [8.6], "ayalon": [119.8], "direct": [25.8], "all": [9.5]})
MIX = {  # pension / provident / investment contracts, % of the company's managed assets
    "2023-12": {"phoenix": [48, 39, 12], "menora": [84, 14, 2], "clal": [62, 31, 7], "migdal": [78, 19, 3], "harel": [66, 26, 8], "altshuler": [18, 82, None],
                "meitav": [32, 68, None], "more": [6, 94, None], "all": [52, 42, 6]},
    "2024-12": {"phoenix": [50, 36, 14], "menora": [84, 14, 2], "clal": [66, 28, 6], "migdal": [78, 19, 4], "harel": [67, 25, 8], "altshuler": [20, 80, None],
                "meitav": [35, 65, None], "more": [11, 89, None], "all": [53, 41, 6]},
    "2025-12": {"phoenix": [49, 35, 16], "menora": [84, 14, 2], "clal": [68, 26, 5], "migdal": [77, 18, 5], "harel": [68, 25, 7], "altshuler": [24, 76, None],
                "meitav": [37, 63, None], "more": [14, 86, None], "all": [54, 40, 6]},
    "2026-06": {"phoenix": [49, 34, 16], "menora": [84, 14, 2], "clal": [68, 27, 6], "migdal": [76, 19, 5], "harel": [66, 27, 7], "altshuler": [25, 75, None],
                "meitav": [36, 64, None], "more": [15, 85, None], "all": [54, 40, 6]},
}
for d, rows in MIX.items():
    rows = {**rows, "yelin": [None, 100, None], "analyst": [None, 100, None], "hachshara": [None, None, 100], "ayalon": [None, None, 100], "direct": [None, None, 100]}
    for i, m in enumerate(["am.mix.pen", "am.mix.gem", "am.mix.ic"]):
        put(m, 5, [d], {c: [v[i]] for c, v in rows.items()})

put("am.fees", 6, F3, {"phoenix": [1025, 1237, 724], "menora": [998, 1120, 615], "clal": [789, 834, 456], "migdal": [663, 804, 465], "harel": [1000, 1112, 622],
                       "altshuler": [906, 897, 410], "meitav": [625, 797, 509], "more": [515, 647, 395], "yelin": [448, 551, 277], "analyst": [253, 404, 264],
                       "hachshara": [155, 202, 120], "ayalon": [6, 12, 16], "direct": [3, 3, 2]})
put("am.fees.g", 6, ["FY2025"], [[20.7, 12.3, 5.7, 21.2, 11.2, -0.9, 27.5, 25.5, 23.0, 59.9, 30.1, 90.7, 5.1]], AM)
put("am.gross", 6, F3, {"phoenix": [464, 543, 302], "menora": [727, 825, 434], "clal": [429, 432, 223], "migdal": [350, 404, 247], "harel": [597, 645, 353],
                        "altshuler": [587, 584, 260], "meitav": [357, 443, 274], "more": [255, 314, 186], "yelin": [272, 319, 161], "analyst": [140, 212, 137],
                        "hachshara": [40, 48, 37], "ayalon": [1, 4, 3], "direct": [0, -1, -5]})
put("am.gross.g", 6, ["FY2025"], [[17.1, 13.5, 0.7, 15.4, 8.1, -0.5, 24.0, 23.3, 17.5, 52.1, 19.4, 408.2, 707.8]], AM)
put("am.op", 6, F3, {"phoenix": [187, 285, 152], "menora": [317, 386, 230], "clal": [35, 31, 20], "migdal": [27, 26, 67], "harel": [133, 170, 95],
                     "altshuler": [85, 98, 48], "meitav": [221, 300, 161], "more": [72, 110, 68], "yelin": [57, 67, 35], "analyst": [44, 91, 73],
                     "hachshara": [19, 36, 30], "ayalon": [0, 3, 2], "direct": [-1, -2, -5]})
put("am.op.g", 6, ["FY2025"], [[52.7, 21.6, -11.3, -4.7, 28.4, 15.1, 36.2, 52.5, 19.2, 109.3, 87.3]], AM[:11])
put("am.rev_rate", 7, F3, {"phoenix": [.48, .47, .46], "menora": [.35, .33, .32], "clal": [.39, .36, .34], "migdal": [.38, .35, .34], "harel": [.40, .37, .37],
                           "altshuler": [.56, .54, .52], "meitav": [.45, .44, .45], "more": [.66, .62, .61], "yelin": [.67, .67, .66], "analyst": [.60, .59, .61],
                           "hachshara": [.85, .85, .86], "ayalon": [.72, .67, .73], "direct": [.92, .83, .76]})
put("am.gross_m", 7, F3, {"phoenix": [.22, .21, .19], "menora": [.25, .24, .23], "clal": [.21, .19, .17], "migdal": [.20, .18, .18], "harel": [.24, .22, .21],
                          "altshuler": [.36, .35, .33], "meitav": [.26, .24, .24], "more": [.32, .30, .29], "yelin": [.41, .39, .38], "analyst": [.33, .31, .32],
                          "hachshara": [.22, .20, .26], "ayalon": [.08, .21, .16]})
put("am.op_m", 7, F3, {"phoenix": [.09, .11, .10], "menora": [.11, .11, .12], "clal": [.02, .01, .01], "migdal": [.02, .01, .05], "harel": [.05, .06, .06],
                       "altshuler": [.05, .06, .06], "meitav": [.16, .17, .14], "more": [.09, .11, .11], "yelin": [.08, .08, .08], "analyst": [.10, .13, .17],
                       "hachshara": [.11, .15, .21], "ayalon": [-.03, .17, .11]})

# ---- investment policies (slide 9), NIS millions ----
put("ic.dep", 9, ["FY2025", "Q1-2026", "Q2-2026"], {"phoenix": [14524, 4118, 3429], "hachshara": [6186, 1289, 1190], "migdal": [4782, 1569, 1548],
                                                     "harel": [3344, 1120, 1173], "clal": [1794, 849, 1028], "ayalon": [1660, 1326, 1860], "menora": [1409, 593, 560],
                                                     "direct": [143, 68, 92], "all": [33841, 10933, 10881]})
put("ic.dep", 9, Q6[:4], {"all": [8000, 5900, 8800, 11100]})  # printed in NIS billions, one decimal
put("ic.dep.share", 9, Q6, {"phoenix": [47, 45, 39, 42, 38, 32]})
put("ic.dep.share", 9, ["FY2025"], [[43, 18, 14, 10, 5, 5, 4, 0]], IC)
put("ic.dep.share", 9, ["Q1-2026"], [[None, 12, 14, 10, 8, 12, 5, 1]], IC)
put("ic.dep.share", 9, ["Q2-2026"], [[None, 11, 14, 11, 9, 17, 5, 1]], IC)
put("ic.aum", 9, D3, {"phoenix": [32751, 46887, 54215], "hachshara": [20763, 26777, 29083], "migdal": [7584, 12174, 15201], "harel": [21284, 23025, 24814],
                      "clal": [12537, 13575, 15405], "ayalon": [983, 2683, 5897], "menora": [5602, 6965, 8047], "direct": [307, 387, 487],
                      "all": [101812, 132472, 153148]})
put("ic.aum", 9, ["2023-12"], {"all": [83000]})  # printed as 83 billion
put("ic.aum.share", 9, D4, {"phoenix": [29, 32, 35, 35]})
put("ic.aum.g", 9, ["2026-06"], [[16, 9, 25, 8, 13, 120, 16, 26]], IC)
put("ic.aum.g", 9, ["2026-06"], {"all": [16]})

# ---- pension (slides 11-21) ----
put("pen.aum", 11, D3, {"menora": [259, 306, 332], "harel": [183, 217, 235], "migdal": [153, 197, 219], "clal": [142, 171, 189], "phoenix": [116, 146, 162],
                        "meitav": [55, 75, 86], "altshuler": [34, 39, 38], "more": [10, 16, 21], "all": [952, 1168, 1282]})
put("pen.aum.g", 11, ["2026-06"], {"menora": [8.3], "harel": [8.3], "migdal": [10.9], "clal": [10.8], "phoenix": [10.6], "meitav": [14.6], "altshuler": [-1.6], "more": [26.0]})
put("pen.aum.share", 11, D3, [[12.2, 27.2, 14.9, 16.1, 19.3, 3.5, 5.8, 1.0], [12.5, 26.2, 14.6, 16.9, 18.6, 3.3, 6.5, 1.4], [12.6, 25.9, 14.8, 17.1, 18.4, 3.0, 6.7, 1.6]], PEN)
TR_PEN = {  # transfers in, out, net: NIS billions
    "H1-2026": [[10.5, 7.6, 2.8], [8.9, 10.3, -1.4], [9.5, 7.1, 2.4], [12.4, 7.6, 4.8], [7.1, 9.6, -2.4], [1.1, 5.1, -4.0], [6.6, 3.4, 3.2], [2.9, 1.1, 1.8]],
    "FY2025": [[16.1, 13.0, 3.1], [12.5, 16.7, -4.2], [12.6, 13.2, -0.6], [23.5, 11.3, 12.2], [12.6, 15.3, -2.7], [2.9, 6.0, -3.1], [10.8, 4.9, 5.9], [4.6, 1.2, 3.4]],
    "Q1-2026": [[6.1, 3.8, 2.3], [4.5, 5.6, -1.1], [4.7, 3.9, 0.9], [6.5, 4.0, 2.6], [3.8, 5.2, -1.4], [0.6, 2.5, -1.9], [3.6, 1.7, 1.9], [1.4, 0.6, 0.8]],
    "Q2-2026": [[4.4, 3.8, 0.5], [4.4, 4.7, -0.3], [4.8, 3.2, 1.6], [5.9, 3.7, 2.2], [3.4, 4.4, -1.1], [0.5, 2.7, -2.2], [3.0, 1.7, 1.3], [1.5, 0.5, 1.0]],
}
for p, rows in TR_PEN.items():
    for i, m in enumerate(["pen.tr_in", "pen.tr_out", "pen.tr_net"]):
        put(m, 12 if p in ("H1-2026", "FY2025") else 13, [p], [[r[i] for r in rows]], PEN)
put("pen.out_rate", 14, F3, [[10.8, 5.1, 8.6, 6.6, 6.9, 14.8, 7.7, 7.7, 7.4], [10.1, 5.9, 8.4, 6.5, 8.4, 16.7, 7.6, 9.2, 7.9], [10.1, 6.5, 7.9, 7.4, 9.2, 26.8, 8.3, 11.6, 8.6]], PEN + ["all"])
put("pen.out_rate", 14, Q6, [[12.7, 6.3, 9.3, 7.0, 9.2, 14.1, 8.8, 10.7, 8.7], [10.0, 5.7, 8.4, 6.1, 7.3, 15.4, 7.4, 8.5, 7.5], [9.1, 5.6, 7.7, 5.8, 7.0, 17.8, 6.8, 8.5, 7.1],
                             [10.4, 7.0, 9.5, 8.2, 9.5, 22.6, 9.1, 12.4, 9.2], [10.6, 7.3, 9.0, 8.0, 10.3, 26.1, 8.7, 13.1, 9.4], [10.1, 5.8, 7.2, 7.1, 8.5, 27.8, 8.4, 11.0, 8.2]], PEN + ["all"])
put("pen.nb", 15, F3, {"migdal": [3.0, 3.6, 1.6], "harel": [3.2, 2.8, 1.5], "phoenix": [2.2, 2.3, 1.1], "menora": [1.9, 2.0, 1.3], "clal": [1.5, 1.7, 1.1],
                       "meitav": [1.6, 1.5, 0.5], "more": [0.7, 0.8, 0.6], "altshuler": [0.7, 0.7, 0.3], "all": [14.6, 15.5, 8.0]})
put("pen.nb.share", 15, F3, [[14.8, 12.9, 10.1, 20.4, 21.6, 5.0, 10.6, 4.6], [14.8, 12.6, 11.2, 23.0, 18.4, 4.8, 9.9, 5.3], [13.7, 16.8, 13.5, 19.6, 19.2, 4.2, 5.9, 7.1]], PEN)
put("pen.fee_a", 16, F3, [[.162, .186, .174, .181, .164, .143, .129, .202, .172], [.157, .182, .164, .166, .156, .152, .132, .198, .165], [.158, .183, .157, .156, .154, .156, .136, .192, .163]], PEN + ["all"])
put("pen.fee_d", 16, F3, [[1.53, 1.70, 1.51, 1.56, 1.48, 1.35, 1.28, 1.00, 1.52], [1.51, 1.69, 1.48, 1.52, 1.45, 1.27, 1.23, 1.01, 1.49], [1.48, 1.67, 1.49, 1.50, 1.43, 1.26, 1.20, 1.08, 1.47]], PEN + ["all"])
put("pen.op", 17, F3, [[44, 278, 30, 22, 69, 23, 46, -30], [67, 324, 39, 19, 91, 27, 65, -33], [36, 186, 26, 47, 50, 12, 43, -16]], PEN)
put("pen.gross_m", 18, F3, [[.152, .249, .196, .185, .221, .267, .275, .255, .216], [.142, .238, .183, .174, .203, .246, .237, .234, .201], [.133, .215, .165, .175, .190, .221, .207, .229, .186]], PEN + ["all"])
put("pen.gross_m", 19, ["FY2023"], [[.165, .257, .216, .215, .239, .280, .300, .301, .233]], PEN + ["all"])
put("pen.gross_m", 19, H3[:2], [[.153, .245, .200, .189, .220, .261, .292, .262, .217], [.147, .248, .187, .163, .201, .230, .245, .231, .202]], PEN + ["all"])
put("pen.op_m", 18, F3, [[.042, .116, .023, .016, .041, .076, .097, -.441, .056], [.051, .115, .025, .011, .045, .076, .100, -.253, .057], [.046, .116, .028, .044, .044, .064, .104, -.168, .062]], PEN + ["all"])
put("pen.sm_fees", 20, F3, [[55, 22, 34, 41, 28, 17, 15, 24, 31], [53, 21, 32, 40, 28, 19, 17, 27, 31], [54, 25, 34, 34, 28, 24, 19, 25, 32]], PEN + ["all"])
put("pen.sm_aum", 20, F3, [[.19, .07, .10, .13, .08, .05, .05, .08, .10], [.16, .06, .09, .11, .08, .06, .05, .09, .09], [.16, .07, .09, .09, .08, .07, .05, .08, .09]], PEN + ["all"])
put("pen.ga_fees", 21, F3, [[32, 42, 59, 54, 59, 60, 55, 208, 51], [30, 41, 59, 56, 56, 56, 48, 152, 50], [31, 35, 55, 49, 55, 54, 40, 130, 46]], PEN + ["all"])
put("pen.ga_aum", 21, F3, [[.11, .13, .17, .17, .18, .19, .18, .70, .16], [.09, .12, .16, .16, .16, .17, .14, .49, .14], [.09, .10, .14, .13, .15, .15, .10, .41, .12]], PEN + ["all"])

# ---- provident (slides 23-33) ----
put("gem.aum", 23, D3, {"meitav": [101, 131, 156], "altshuler": [132, 125, 112], "phoenix": [84, 103, 114], "more": [77, 105, 115], "yelin": [78, 87, 82],
                        "harel": [68, 80, 95], "analyst": [54, 83, 91], "clal": [61, 66, 75], "menora": [45, 52, 57], "migdal": [37, 47, 55], "all": [737, 879, 952]})
put("gem.aum.g", 23, ["2026-06"], {"meitav": [19.2], "altshuler": [-10.4], "phoenix": [10.1], "more": [9.7], "yelin": [-5.6], "harel": [18.4], "analyst": [9.6],
                                   "clal": [13.6], "menora": [11.0], "migdal": [16.8]})
put("gem.aum.share", 23, D3, [[11.4, 6.0, 8.2, 5.0, 9.3, 17.9, 13.7, 10.5, 10.6, 7.3], [11.7, 5.9, 7.5, 5.3, 9.1, 14.3, 14.9, 12.0, 9.9, 9.5], [11.9, 6.0, 7.9, 5.8, 9.9, 11.8, 16.4, 12.1, 8.6, 9.6]], GEM)
TR_GEM = {
    "H1-2026": [[8.4, 4.3, 4.1], [4.0, 1.9, 2.1], [6.1, 2.4, 3.7], [5.7, 2.0, 3.7], [9.6, 3.3, 6.4], [0.3, 19.0, -18.7], [19.1, 4.3, 14.8], [5.6, 4.3, 1.2], [0.6, 9.9, -9.2], [6.1, 5.8, 0.3]],
    "FY2025": [[11.2, 6.5, 4.7], [3.5, 3.6, -0.1], [3.3, 6.7, -3.5], [6.4, 3.6, 2.8], [6.9, 7.6, -0.7], [1.4, 23.7, -22.3], [18.6, 7.2, 11.4], [21.6, 10.0, 11.6], [4.5, 8.9, -4.4], [18.9, 3.8, 15.1]],
    "Q1-2026": [[5.2, 2.2, 2.9], [2.0, 1.0, 0.9], [2.2, 1.4, 0.8], [2.4, 1.1, 1.3], [4.6, 1.9, 2.7], [0.2, 9.7, -9.5], [10.0, 2.1, 7.9], [2.6, 2.2, 0.4], [0.4, 4.8, -4.3], [4.1, 2.7, 1.4]],
    "Q2-2026": [[3.2, 2.1, 1.1], [2.0, 0.9, 1.2], [3.9, 1.0, 2.9], [3.3, 0.9, 2.4], [5.0, 1.4, 3.7], [0.1, 9.3, -9.2], [9.1, 2.2, 7.0], [2.9, 2.1, 0.8], [0.2, 5.1, -4.9], [2.0, 3.1, -1.1]],
}
for p, rows in TR_GEM.items():
    for i, m in enumerate(["gem.tr_in", "gem.tr_out", "gem.tr_net"]):
        put(m, 24 if p in ("H1-2026", "FY2025") else 25, [p], [[r[i] for r in rows]], GEM)
put("gem.dep", 26, F3, {"harel": [6, 8, 6], "phoenix": [6, 8, 4], "altshuler": [8, 7, 3], "meitav": [6, 7, 5], "more": [6, 7, 4], "analyst": [5, 6, 3], "clal": [5, 5, 3],
                        "yelin": [5, 5, 2], "menora": [4, 5, 3], "migdal": [4, 4, 3], "all": [54, 61, 34]})
put("gem.dep.share", 26, F3, [[11.4, 8.0, 8.7, 6.7, 11.0, 14.9, 10.5, 10.4, 9.2, 9.2], [12.7, 7.5, 7.4, 7.2, 13.0, 11.0, 11.6, 11.5, 7.6, 10.5], [12.1, 7.4, 7.6, 8.1, 17.3, 8.2, 13.4, 10.7, 5.4, 9.7]], GEM)
put("gem.out_rate", 27, F3, [[11.80, 6.97, 14.89, 8.44, 9.79, 13.35, 7.00, 10.27, 4.51, 4.81, 10.49], [6.95, 7.55, 10.63, 8.55, 10.31, 18.47, 6.24, 10.97, 10.74, 5.54, 10.12],
                             [8.02, 6.98, 6.89, 7.92, 7.46, 31.96, 6.00, 7.83, 23.41, 13.29, 12.50]], GEM + ["all"])
put("gem.out_rate", 27, Q6, [[7.9, 8.6, 13.4, 9.6, 12.5, 12.9, 7.3, 24.7, 7.2, 4.8, 11.2], [6.3, 8.7, 10.9, 7.8, 10.2, 19.3, 5.8, 9.0, 7.0, 4.0, 9.5], [6.7, 8.6, 9.8, 8.6, 10.0, 20.7, 6.3, 7.4, 11.1, 5.5, 10.1],
                             [7.3, 11.5, 9.3, 8.8, 9.9, 20.1, 6.3, 6.2, 16.5, 7.4, 10.6], [8.6, 7.9, 8.7, 9.4, 9.1, 32.3, 6.3, 8.2, 22.6, 12.8, 13.2], [7.7, 6.3, 5.5, 6.9, 6.2, 33.0, 5.9, 7.7, 25.0, 14.1, 12.2]], GEM + ["all"])
put("gem.fee_a", 28, F3, [[.574, .469, .501, .514, .531, .619, .519, .687, .672, .600, .579], [.577, .469, .489, .500, .511, .613, .527, .662, .667, .590, .572],
                          [.576, .476, .488, .502, .527, .598, .564, .662, .657, .605, .576]], GEM + ["all"])
put("gem.op", 29, F3, [[102, 37, 6, -6, 37, 62, 93, 103, 57, 44], [145, 56, 0, 0, 50, 70, 149, 143, 67, 91], [68, 40, 4, 11, 30, 36, 119, 84, 35, 73]], GEM)
put("gem.gross_m", 30, F3, [[.30, .30, .26, .24, .29, .39, .25, .33, .41, .33, .32], [.29, .30, .23, .21, .27, .38, .25, .31, .39, .31, .30], [.25, .30, .22, .19, .26, .39, .26, .29, .39, .31, .29]], GEM + ["all"])
put("gem.gross_m", 31, ["FY2023"], [[.31, .27, .27, .25, .30, .41, .22, .35, .42, .34, .33]], GEM + ["all"])
put("gem.gross_m", 31, H3[:2], [[.30, .30, .27, .25, .29, .39, .25, .32, .42, .33, .32], [.27, .31, .23, .22, .27, .36, .24, .32, .38, .31, .30]], GEM + ["all"])
put("gem.op_m", 30, F3, [[.13, .09, .01, -.02, .06, .05, .10, .14, .08, .10, .08], [.15, .12, .00, .00, .07, .05, .13, .16, .08, .13, .10], [.12, .15, .01, .04, .07, .06, .16, .15, .08, .17, .11]], GEM + ["all"])
put("gem.sm_fees", 32, F3, [[48, 37, 48, 54, 46, 37, 52, 52, 39, 45, 45], [50, 36, 53, 58, 48, 37, 53, 53, 42, 47, 47], [56, 35, 55, 61, 50, 39, 53, 55, 42, 48, 49]], GEM + ["all"])
put("gem.sm_aum", 32, F3, [[.27, .17, .24, .28, .24, .23, .27, .36, .26, .27, .26], [.29, .17, .26, .29, .24, .23, .28, .35, .28, .28, .27], [.33, .17, .29, .33, .28, .23, .32, .38, .28, .30, .30]], GEM + ["all"])
put("gem.ga_fees", 33, F3, [[30, 44, 50, 49, 43, 55, 29, 27, 48, 38, 41], [23, 39, 47, 42, 39, 54, 23, 23, 46, 30, 36], [23, 34, 42, 30, 37, 51, 17, 22, 46, 24, 32]], GEM + ["all"])
put("gem.ga_aum", 33, F3, [[.17, .21, .25, .25, .23, .34, .15, .19, .32, .23, .24], [.13, .18, .23, .21, .20, .33, .12, .15, .31, .18, .21], [.13, .17, .22, .16, .21, .30, .10, .15, .30, .15, .19]], GEM + ["all"])

NOTES = {
    "am.gross": "רווח גולמי: בחוזי השקעה הונח שהוצאות הרכישה מסך ההוצאות ביתר החברות זהות לפניקס.",
    "pen.op": "מגדל: שנות ההפחתה בפנסיה עלו מ-7 ל-9.",
    "gem.out_rate": "נתוני הפניקס 2024 מנוטרלים מהעברות בין מסלולים שבדוחות הכספיים; ביתר החברות לא ברור אם כולל העברות בין מסלולים.",
}


def check():
    """Internal consistency of the transcription: what the deck prints must agree with itself to its own rounding."""
    by = {(m, c, p): v for m, c, p, v, _ in facts}
    assert len(by) == len(facts), "duplicate fact"
    bad = []
    for fam, cos in (("pen", PEN), ("gem", GEM)):
        for (m, c, p), v in by.items():
            if m == f"{fam}.tr_net":
                d = by[(f"{fam}.tr_in", c, p)] - by[(f"{fam}.tr_out", c, p)] - v
                if abs(d) > 0.15:
                    bad.append((m, c, p, round(d, 2)))
        for p in D3:
            s = sum(by[(f"{fam}.aum", c, p)] for c in cos)
            if abs(s - by[(f"{fam}.aum", "all", p)]) > len(cos) * 0.5:
                bad.append((f"{fam}.aum total", p, s))
            sh = sum(by[(f"{fam}.aum.share", c, p)] for c in cos)
            if abs(sh - 100) > 0.6:
                bad.append((f"{fam}.aum.share", p, sh))
            for c in cos:
                if abs(by[(f"{fam}.aum", c, p)] / by[(f"{fam}.aum", "all", p)] * 100 - by[(f"{fam}.aum.share", c, p)]) > 0.45:
                    bad.append((f"{fam}.aum.share vs value", c, p))
    for p in D3:
        s = sum(by[("ic.aum", c, p)] for c in IC)
        if abs(s - by[("ic.aum", "all", p)]) > 2:
            bad.append(("ic.aum total", p, s))
        tot = by[("pen.aum", "all", p)] + by[("gem.aum", "all", p)] + by[("ic.aum", "all", p)] / 1000
        if abs(tot - by[("am.aum", "all", p)]) > 3:
            bad.append(("am.aum = pension + provident + policies", p, round(tot, 1)))
    for p in ["FY2025", "Q1-2026", "Q2-2026"]:
        s = sum(by[("ic.dep", c, p)] for c in IC)
        if abs(s - by[("ic.dep", "all", p)]) > 2:
            bad.append(("ic.dep total", p, s))
    for m, cos in (("pen.nb.share", PEN), ("gem.dep.share", GEM)):
        for p in F3:
            sh = sum(by[(m, c, p)] for c in cos)
            if abs(sh - 100) > 0.6:
                bad.append((m, p, round(sh, 1)))
    return bad


SEG_HE = {"pension": "פנסיה", "pension_new": "פנסיה חדשה", "pension_new_general": "פנסיה חדשה כללית", "pension_new_comprehensive": "פנסיה חדשה מקיפה",
          "pension_veteran": "פנסיה ותיקה", "provident": "גמל", "provident_gemel": "קופות גמל", "provident_study_fund": "קרנות השתלמות",
          "provident_investment": "גמל להשקעה", "provident_child_savings": "חיסכון לילד", "provident_central_severance": "מרכזית לפיצויים",
          "provident_central_annuity": "מרכזית לקצבה", "other": "אחר", "total": "סך הכול",
          "general": "כללית", "comprehensive": "מקיפה", "general_new_pension": "כללית", "comprehensive_new_pension": "מקיפה", "veteran": "ותיקה",
          "veteran_pension": "ותיקה", "study_fund": "קרנות השתלמות", "investment_provident": "גמל להשקעה", "child_savings": "חיסכון לילד",
          "personal_provident": "קופות גמל אישיות", "provident_savings_compensation": "גמל לחיסכון ואישיות לפיצויים",
          "other_provident_funds": "קופות אחרות", "other_funds": "קופות אחרות"}
TERMS = [("sum of the printed assets at the balance date", "סכום הנכסים המודפסים ליום המאזן"), ("fees collected from deposits", "דמי ניהול שנגבו מהפקדות"),
         ("fees collected from assets", "דמי ניהול שנגבו מנכסים"), ("management fee income", "הכנסות מדמי ניהול"), ("average assets", "נכסים ממוצעים"),
         ("printed for the three months", "כפי שהודפס לשלושת החודשים"), ("printed for", "כפי שהודפס לתקופה"), ("deposits", "הפקדות"),
         ("tr_in", "ניוד פנימה"), ("tr_out", "ניוד החוצה"), ("fees", "דמי ניהול"), ("sm", "מכירה ושיווק"), ("ga", "הנהלה וכלליות"),
         ("nb", "פרמיה משונתת"), ("dep", "הפקדות"), (" x ", " × ")]


def formula_he(t):
    """The method's formula in the site's language: the same terms, word for word."""
    import re
    for en, he in TERMS:
        t = re.sub(rf"(?<![A-Za-z_]){re.escape(en)}(?![A-Za-z_])", he, t) if en.strip().isidentifier() else t.replace(en, he)
    t = re.sub(r"\b(Q[1-4]|H1|9M)-(20)(\d\d)\b", r"\1'\3", t)
    return re.sub(r"\bFY20(\d\d)\b", r"FY'\1", t)


def part_label(q):
    c = q.get("component") or ""
    who = c if any("\u0590" <= ch <= "\u05ff" for ch in c) else SEG_HE.get(c) or SEG_HE.get(q.get("segment") or "", "")
    pop = q.get("population") or ""
    pop = pop if any("\u0590" <= ch <= "\u05ff" for ch in pop) else ""
    return " · ".join(x for x in [q.get("label") or "", who if who and who not in (q.get("label") or "") else "", pop if pop and pop != q.get("label") else ""] if x)


IC_ONLY = {"hachshara", "ayalon", "direct"}


def basis_break(metric, c, period):
    """Investment-contract liabilities up to 31.12.2023 are printed under IFRS 4 and are not comparable with the IFRS 17 balances
    that follow (the sector total steps from 79.8 to 88.0 NIS bn in one quarter; Direct from 70 to 298 NIS mn, its IFRS 17 opening
    balance being 292.5). They are left out, with every rate of an investment-policy-only company whose average assets would
    span the break. For the groups the policies are a small part of managed assets and their rates are kept."""
    year = int(period[:4]) if period[4:5] == "-" and period[:4].isdigit() else int(period[-4:])
    if metric == "ic.aum":
        return year <= 2023
    if c in IC_ONLY and metric in ("am.rev_rate", "am.gross_m", "am.op_m", "am.aum", "am.mix.ic", "am.mix.pen", "am.mix.gem"):
        return year <= 2023 or period in ("FY2024", "Q1-2024", "H1-2024", "9M-2024")
    return False


def reports():
    """Figures built from the managing companies' own reports (pipeline/lts_norm_<company>.py, method in pipeline/LTS_METHOD.md).
    A deck figure is never replaced: where both exist the deck stands and the difference is listed. Report-based rows carry slide 0
    and their printed components go to web/public/data/lts_prov/<company>.json, read when a figure's source is opened."""
    # the deck is a check, never a source: its figures are set aside here and only compared with what the reports give
    deck = {(m, c, p): v for m, c, p, v, _ in facts}
    facts.clear()
    diffs, added, seen = [], 0, set()
    prov_dir = ROOT / "web" / "public" / "data" / "lts_prov"
    prov_dir.mkdir(parents=True, exist_ok=True)
    store = {}
    for f in sorted((ROOT / "data" / "lts_norm").glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        c = d["company"]
        if c not in CO:
            continue
        ic = f.stem.startswith("ic_")
        st = store.setdefault(c, {"entity": None, "urls": {}, "parts": [], "index": {}, "facts": {}})
        if not ic:
            st["entity"] = d.get("entity")
        tag = "ic:" if ic else ""
        for x in sorted((ROOT / "data" / "extracted_lts" / (c + "_ic" if ic else c)).glob("*.json")):
            st["urls"][tag + x.stem] = json.loads(x.read_text(encoding="utf-8")).get("url")
        parts, index, pf = st["parts"], st["index"], st["facts"]
        for r in d["facts"]:
            v = r.get("value")
            if v is None:
                continue
            key = (r["metric"], c, r["period"])
            ids = []
            for q in r.get("parts", []):
                t = (tag + str(q.get("file")), q.get("page"), part_label(q), q.get("value"), q.get("unit"), q.get("date"), q.get("window"))
                if t not in index:
                    index[t] = len(parts)
                    parts.append(list(t))
                ids.append(index[t])
            pf[f"{r['metric']}|{r['period']}"] = [formula_he(r.get("formula", "")), ids]
            if key in seen or basis_break(*key):
                continue
            seen.add(key)
            if key in deck:
                # the deck prints rounded figures: a difference counts only beyond half a unit of its last printed digit
                dv = deck[key]
                digits = len(str(dv).split(".")[1]) if "." in str(dv) else 0
                if abs(v - dv) > 0.5 * 10 ** -digits + 1e-9:
                    diffs.append([r["metric"], c, r["period"], dv, round(v, 4)])
            facts.append([r["metric"], c, r["period"], round(v, 4), 0])
            added += 1
    added += aggregates(store)
    have = {(m, c, p) for m, c, p, _, _ in facts}
    missing = sorted(k for k in deck if k not in have and not k[0].endswith(".g"))
    (ROOT / "data" / "lts_deck_check.json").write_text(json.dumps({"deck": DECK, "note": "validation only: none of these figures reaches the site",
        "differ_beyond_rounding": diffs, "in_deck_not_built_from_reports": missing}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"deck check: {len(deck)} deck figures, {len(missing)} not built from the reports, {len(diffs)} differ beyond rounding")
    if "all" in store:
        store["all"]["entity"] = "סכום החברות בענף"
    for c, st in store.items():
        (prov_dir / f"{c}.json").write_text(json.dumps({"entity": st["entity"], "urls": st["urls"], "parts": st["parts"], "facts": st["facts"]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return added, diffs


SUMS = {"pen": ["aum", "tr_in", "tr_out", "tr_net", "nb", "fees", "sm", "ga", "op"], "gem": ["aum", "tr_in", "tr_out", "tr_net", "dep", "fees", "sm", "ga", "op"]}
SHARES = {"pen.aum.share": ("pen.aum", PEN), "gem.aum.share": ("gem.aum", GEM), "pen.nb.share": ("pen.nb", PEN), "gem.dep.share": ("gem.dep", GEM)}


def aggregates(store):
    """Sector totals, shares and the three-product view for periods the deck does not print, built only when every company
    of the deck's set has a figure for the period. The components of a total are its companies' own figures."""
    by = {(m, c, p): v for m, c, p, v, _ in facts}
    n = 0
    al = store.setdefault("all", {"entity": "סכום החברות שבמצגת", "urls": {}, "parts": [], "index": {}, "facts": {}})

    def add(metric, c, p, v, formula, inputs):
        nonlocal n
        if (metric, c, p) in by or v is None:
            return
        by[(metric, c, p)] = v
        facts.append([metric, c, p, round(v, 4), 0])
        n += 1
        st = store.setdefault(c, {"entity": None, "urls": {}, "parts": [], "index": {}, "facts": {}})
        ids = []
        for label, val, unit in inputs:
            t = ("", None, label, val, unit, p, "")
            if t not in st["index"]:
                st["index"][t] = len(st["parts"])
                st["parts"].append(list(t))
            ids.append(st["index"][t])
        st["facts"][f"{metric}|{p}"] = [formula, ids]

    periods = sorted({p for _, _, p in by})
    for fam, cos in (("pen", PEN), ("gem", GEM)):
        for m in SUMS[fam]:
            for p in periods:
                vals = [by.get((f"{fam}.{m}", c, p)) for c in cos]
                if all(v is not None for v in vals):
                    unit = "מיליוני ש\"ח" if m in ("fees", "sm", "ga", "op") else "מיליארדי ש\"ח"
                    add(f"{fam}.{m}", "all", p, sum(vals), f"סכום {len(cos)} החברות", [(CO[c], round(v, 3), unit) for c, v in zip(cos, vals)])
        for m, den in (("sm_fees", "sm"), ("ga_fees", "ga")):
            for p in periods:
                a, f = by.get((f"{fam}.{den}", "all", p)), by.get((f"{fam}.fees", "all", p))
                if a is not None and f:
                    add(f"{fam}.{m}", "all", p, a / f * 100, "סך ההוצאה של החברות / סך דמי הניהול, %", [("הוצאה, כל החברות", round(a, 2), "מיליוני ש\"ח"), ("דמי ניהול, כל החברות", round(f, 2), "מיליוני ש\"ח")])
    for p in periods:
        vals = [by.get(("ic.aum", c, p)) for c in IC]
        if all(v is not None for v in vals):
            add("ic.aum", "all", p, sum(vals), f"סכום {len(IC)} המבטחות", [(CO[c], round(v, 1), "מיליוני ש\"ח") for c, v in zip(IC, vals)])
        vals = [by.get(("ic.dep", c, p)) for c in IC]
        if all(v is not None for v in vals):
            add("ic.dep", "all", p, sum(vals), f"סכום {len(IC)} המבטחות", [(CO[c], round(v, 1), "מיליוני ש\"ח") for c, v in zip(IC, vals)])
    for share, (base, cos) in SHARES.items():
        for p in periods:
            tot = by.get((base, "all", p))
            for c in cos:
                v = by.get((base, c, p))
                if v is not None and tot:
                    add(share, c, p, v / tot * 100, "נתון החברה / סך החברות, %", [(CO[c], round(v, 3), ""), ("סך החברות", round(tot, 3), "")])
    # the three products together: a company's managed assets and their mix, at balance dates
    for p in [x for x in periods if len(x) == 7 and x[4] == "-"]:
        tot_parts = []
        for c in AM + ["all"]:
            comp = [("pen.aum", 1, c in PEN or c == "all"), ("gem.aum", 1, c in GEM or c == "all"), ("ic.aum", 0.001, c in IC or c == "all")]
            vals = [(m, by.get((m, c, p)), k) for m, k, has in comp if has]
            if not vals or any(v is None for _, v, _ in vals):
                continue
            total = sum(v * k for _, v, k in vals)
            add("am.aum", c, p, total, "פנסיה + גמל + חוזי השקעה", [(m, round(v * k, 3), "מיליארדי ש\"ח") for m, v, k in vals])
            if (("am.mix.pen", c, p) not in by) and total > 0:
                for key, m in (("am.mix.pen", "pen.aum"), ("am.mix.gem", "gem.aum"), ("am.mix.ic", "ic.aum")):
                    hit = next((v * k for mm, v, k in vals if mm == m), None)
                    if hit is not None:
                        add(key, c, p, hit / total * 100, "נכסי המוצר / סך הנכסים המנוהלים, %", [(m, round(hit, 3), "מיליארדי ש\"ח"), ("סך הנכסים", round(total, 3), "מיליארדי ש\"ח")])
    return n


def main():
    bad = check()
    for b in bad:
        print("CHECK", b)
    added, diffs = reports()
    print(f"from the reports: {added} figures")
    out = {"source": "דוחות החברות המנהלות וחברות הביטוח", "companies": CO, "notes": {}, "facts": facts}
    dest = ROOT / "web" / "public" / "data" / "lts.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(facts)} figures, {len({f[0] for f in facts})} metrics, {len(bad)} inconsistencies -> {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
