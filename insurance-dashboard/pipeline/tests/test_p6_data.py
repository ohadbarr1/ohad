"""P6 data defects found by the Pro tester on the peers board and the company pages (26.11.26), one test per fix (standard library only).

cd pipeline && /usr/bin/python3 -m unittest tests.test_p6_data -v

  B2   one value per (company, metric, period): the IFRS 17 note families follow the statements' restatement rule (latest print), so the
       peer board's Harel Q4'25 (FY − Q1 − Q2 − Q3) equals the company page's (FY − 9M)
  B7   Harel's Q3'26 statement rewords the pre-tax line ("רווח תפעולי לפני מסים על ההכנסה"): one line, role pbt, Q3'26 = 670 (p. 54)
  B11  the ROE bridge runs to Q3'26 (the pre-tax line is no longer missing there)
  B1   the model workbook a company page links runs to the latest filed quarter
  W7   Phoenix's 30.09.25 CSM (printed without a basis) is proven net by the same report's segment lines, so the industry CSM balance
       counts Phoenix at Q3'26 against a year earlier
  P6-D1 the CSM resolver follows the site's latest-print rule (Harel 31.12.24 16,358 · 31.03.25 16,333 · 30.06.25 16,520 · 30.09.25
       16,983, each flag 8 with its first print), a figure read from prose or a rounded chart never outranks a printed one, a balance at
       01.01 is the 31.12 balance before it
  P6-D2 the company workbook's CSM row = the peer file for every quarter, and the series rows follow the same vintage (openings of later
       roll-forwards are prints of the closing; the annual report is later than the year's interim reports)
  P6-D3 no basis mix inside a CSM series: every insurer's resolved CSM is net (printed, proven, or gross less reinsurance of one report)
  P4   a computed CSM cell (a sum or a net) carries the page of its first line and its signed lines
  T    a solvency target is compared with the ratio on its own basis (with / without the transitional measures)
"""
import json
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import restate_rule as R  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "web" / "public" / "data"


def load(rel):
    return json.loads((DATA / rel).read_text(encoding="utf-8"))


class RestateRule(unittest.TestCase):
    def pick(self, *prints):
        cs = [{"v": v, "from": f, "own": o} for v, f, o in prints]
        c, first = R.pick(cs, lambda c: c["from"], lambda c: c["own"])
        return c["v"], c["from"], first["v"]

    def test_restatement_taken(self):
        # Harel Q1'25 insurance revenue: 3,544 in its own report, 3,560 in the Q1'26 comparative
        self.assertEqual(self.pick((3544, "2025Q1", True), (3560, "2026Q1", False)), (3560, "2026Q1", 3544))

    def test_reprint_within_rounding_keeps_first(self):
        self.assertEqual(self.pick((100, "2025FY", False), (100.4, "2026Q1", False)), (100, "2025FY", 100))
        self.assertEqual(self.pick((7092, "2025Q2", True), (7092, "2026Q2", False))[1], "2025Q2")

    def test_not_the_same_figure_keeps_first(self):
        self.assertEqual(self.pick((6233, "2025Q2", True), (7493, "2026Q2", False))[0], 6233)   # +20%: another basis, not a restatement
        self.assertEqual(self.pick((106, "2025FY", True), (-106, "2026Q1", False))[0], 106)     # a sign flip is a presentation change

    def test_own_report_is_first(self):
        # two prints from one report period: the own report's print is the first print
        self.assertEqual(self.pick((10, "2025Q1", False), (12, "2025Q1", True))[2], 12)


class HarelQ425(unittest.TestCase):
    """B2: series, registry and the company page agree on Harel Q1'25, Q2'25 and the derived Q4'25"""

    @classmethod
    def setUpClass(cls):
        cls.series = {(r["m"], r["s"], r["b"]): r["vals"] for r in load("series/harel.json")["rows"]}
        cls.reg = {f: load(f"peers/m/{f}.json")["e"]["harel"]["c"] for f in ("ifrs-insurance_revenue", "ifrs-insurance_service_result")}
        wb = load("companies/harel.json")
        P, role = wb["periods"], {m.get("role"): i for i, m in enumerate(wb["metrics"]) if m.get("role")}
        cls.st = {}
        for f in wb["facts"]:
            for key in ("ins_rev", "ins_res"):
                if f[0] == role.get(key):
                    cls.st[(key, P[f[1]]["type"], P[f[1]]["end"])] = f[2] / 1000

    def test_series_latest_print(self):
        rev, isr = self.series[("insurance_revenue", "group", "na")], self.series[("insurance_service_result", "group", "na")]
        self.assertEqual((rev["2025Q1"]["v"], rev["2025Q1"]["rst"], rev["2025Q1"]["rfrom"]), (3560, 3544, "2025Q1"))
        self.assertEqual((isr["2025Q1"]["v"], isr["2025Q1"]["rst"]), (565, 543))
        self.assertEqual((isr["2025Q2"]["v"], isr["2025Q2"]["rst"]), (559, 565))
        self.assertNotIn("rst", rev["2025Q2"])  # printed again within rounding: the own report's print and page stand

    def test_registry_flags_restated(self):
        for f, q1, fy, want in (("ifrs-insurance_revenue", 3560, 14409, 3669), ("ifrs-insurance_service_result", 565, 2314, 576)):
            c = {x[0]: x for x in self.reg[f]}
            self.assertEqual(c["2025Q1"][1], q1)
            self.assertTrue(c["2025Q1"][4] & 8, f"{f}: Q1'25 carries flag 8 (restated)")
            q4 = c["2025FY"][1] - c["2025Q1"][1] - c["2025Q2"][1] - c["2025Q3"][1]
            self.assertEqual(q4, want, f"{f}: Q4'25 = FY − Q1 − Q2 − Q3")

    def test_company_page_agrees(self):
        self.assertEqual(self.st[("ins_rev", "Q", "2025-12-31")], 3669)
        self.assertEqual(self.st[("ins_res", "Q", "2025-12-31")], 576)
        ltm = lambda f: sum(x[1] for x in self.reg[f] if x[0] in ("2025Q4", "2026Q1", "2026Q2", "2026Q3")) + (
            {x[0]: x for x in self.reg[f]}["2025FY"][1] - sum({x[0]: x for x in self.reg[f]}[q][1] for q in ("2025Q1", "2025Q2", "2025Q3")))
        self.assertEqual(ltm("ifrs-insurance_revenue"), 14372)   # LTM Q3'26 = 3,669 + 3,478 + 3,550 + 3,675
        self.assertEqual(ltm("ifrs-insurance_service_result"), 2324)


class HarelPretax(unittest.TestCase):
    """B7 / B11: the reworded pre-tax line"""

    def test_norm_joins_reworded_caption(self):
        src = (ROOT / "pipeline" / "build_workbook.py").read_text(encoding="utf-8")
        ns = {"re": re}
        exec(src[src.index("def norm(t)"):src.index("\n\n\nPOOL")], ns)
        norm = ns["norm"]
        self.assertEqual(norm("רווח תפעולי לפני מסים על ההכנסה"), norm("רווח לפני מסים על ההכנסה"))
        self.assertNotEqual(norm("רווח תפעולי"), norm("רווח לפני מסים על ההכנסה"))  # the fund houses' operating profit stays apart

    def test_pbt_q3_26(self):
        wb = load("companies/harel.json")
        P = wb["periods"]
        mi = next(i for i, m in enumerate(wb["metrics"]) if m.get("role") == "pbt")
        got = {(P[f[1]]["type"], P[f[1]]["end"]): (f[2], f[3]) for f in wb["facts"] if f[0] == mi}
        self.assertEqual(got[("Q", "2026-09-30")], (670000, 54))
        self.assertEqual(got[("Q", "2026-06-30")][0], 1651000)
        self.assertEqual(got[("Q", "2025-09-30")][0], 1283000)
        self.assertFalse(any(m.get("role") == "op_profit" for m in wb["metrics"]), "an insurer's pre-tax line is not an operating-profit role")

    def test_report_day_role_reads_it(self):
        import reportday
        self.assertTrue(reportday.BY_KEY["pbt"]["re"].match("רווח תפעולי לפני מסים על ההכנסה"))

    def test_roe_bridge_reaches_q3_26(self):
        a = load("attribution/harel.json")
        ids = {b["id"] for b in a["bridges"]}
        self.assertTrue({"qoq:2026Q3", "yoy:2026Q3", "ltm:2026Q3"} <= ids)
        self.assertFalse([g for g in a["gaps"] if g["id"].endswith("2026Q3")])


class CsmProvenNet(unittest.TestCase):
    """W7: tier 3b of csm_resolve (mirrored in web/src/lib/csmResolve.ts; parity: web/scripts/csm-parity.mjs)"""

    def test_phoenix_q3_25(self):
        import csm_resolve
        reps = [(per, [x for x in load(f"ifrs_{per}.json") if x["c"] == "phoenix"]) for per in ("2025Q2", "2025Q3", "2025FY", "2026Q1", "2026Q2", "2026Q3")]
        r = csm_resolve.resolve(reps, "2025Q3", "2025-09-30")
        self.assertEqual((r["v"], r["b"], r["scope"]), (8766, "net", "group"))
        self.assertEqual([round(f["v"], 1) for f in r["proof"]], [2837.9, 228.5, 7405.1, 1248.1])
        # 30.06.25: the presentation's group line 8,736 (no basis) is not proven by the segments (8,739.7): since P6-D3 the net figure the
        # report's own lines give, life and health gross less reinsurance (tier 3d), outranks a group line of unstated basis
        r = csm_resolve.resolve(reps, "2025Q2", "2025-06-30")
        self.assertEqual((round(r["v"], 1), r["b"], r["scope"], r["flags"] & 1), (8739.7, "net", "lh", 1))

    def test_published(self):
        got = load("csm/facts/phoenix.json")["resolved"]["2025-09-30"]
        self.assertEqual(got[0], 8766)
        self.assertTrue(got[1].startswith("נטו"))


def fact(d, v, b="net", g="group", m="csm_closing", src=None, pg=1, s=None):
    f = {"m": m, "d": d, "w": "instant", "b": b, "g": g, "s": s or g, "v": v, "pg": pg}
    if src:
        f["src"] = src
    return f


class CsmRule(unittest.TestCase):
    """P6-D1 / P6-D3: the resolver's vintage, precision and basis rules, on synthetic facts"""

    @classmethod
    def setUpClass(cls):
        import csm_resolve
        cls.R = csm_resolve

    def test_report_order_fy_after_q3(self):
        self.assertLess(R.rkey("2025Q3"), R.rkey("2025FY"))
        self.assertLess(R.rkey("2025FY"), R.rkey("2026Q1"))
        c, first = R.pick([{"v": 100, "from": "2025Q1", "own": False}, {"v": 104, "from": "2025FY", "own": False}], lambda c: c["from"], lambda c: c["own"])
        self.assertEqual((c["v"], first["v"]), (104, 100))  # the annual report is the later print

    def test_restated_keeps_its_first_report(self):
        cs = [{"v": 16548, "from": "2025Q1", "own": False}, {"v": 16358, "from": "2026Q1", "own": False}, {"v": 16358, "from": "2026Q3", "own": False}]
        c, first = R.pick(cs, lambda c: c["from"], lambda c: c["own"])
        self.assertEqual((c["v"], c["from"], first["v"]), (16358, "2026Q1", 16548))

    def test_latest_restated_print(self):
        reps = [("2025Q1", [fact("2025-03-31", 16538, src="chart", pg=17), fact("2025-03-31", 16500, src="text", pg=13)]),
                ("2026Q1", [fact("2025-03-31", 16333, pg=16)])]
        r = self.R.resolve(reps, "2025Q1", "2025-03-31")
        self.assertEqual((r["v"], r["rp"], r["flags"] & 8, r["rst"], r["rfrom"]), (16333, "2026Q1", 8, 16538, "2025Q1"))
        self.assertEqual(self.R.first_note(r), "כפי שהודפס לראשונה (דוח Q1'25): 16,538")

    def test_prose_never_outranks_a_print(self):
        # in one report: the roll-forward chart label (16,538) over the prose "NIS 16.5 billion"
        r = self.R.resolve([("2025Q1", [fact("2025-03-31", 16500, src="text", pg=13), fact("2025-03-31", 16538, src="chart", pg=17)])], "2025Q1", "2025-03-31")
        self.assertEqual(r["v"], 16538)
        # across reports: a later prose figure is not a restatement of a printed one
        r = self.R.resolve([("2025Q1", [fact("2025-03-31", 16538, pg=17)]), ("2026Q1", [fact("2025-03-31", 16300, src="text", pg=5)])], "2025Q1", "2025-03-31")
        self.assertEqual((r["v"], r["flags"] & 8), (16538, 0))
        # prose alone is still served, flagged
        r = self.R.resolve([("2025Q1", [fact("2025-03-31", 16500, src="text", pg=13)])], "2025Q1", "2025-03-31")
        self.assertEqual((r["v"], r["flags"] & 16), (16500, 16))

    def test_rounded_chart_is_a_reading(self):
        # Phoenix 31.12.24: 8,900 on the Q1'25 chart (2.4 + 6.5 billion), 8,837.0 in the Q2'25 note: not a restatement
        reps = [("2025Q1", [fact("2024-12-31", 8900, src="chart", pg=39)]), ("2025Q2", [fact("2024-12-31", 8837.026, pg=120)])]
        r = self.R.resolve(reps, "2024FY", "2024-12-31")
        self.assertEqual((r["v"], r["rp"], r["flags"] & 8), (8837.026, "2025Q2", 0))

    def test_net_from_gross_less_reinsurance(self):
        # Menora 31.03.24 (Q1'25 p. 87): life and health gross and reinsurance only
        F = [fact("2024-03-31", 2585.819, "gross", "life", pg=87), fact("2024-03-31", 81.726, "reinsurance", "life", pg=87),
             fact("2024-03-31", 4480.801, "gross", "health", pg=87), fact("2024-03-31", 552.602, "reinsurance", "health", pg=87),
             fact("2024-06-30", 6370.21, pg=90)]
        r = self.R.resolve([("2025Q1", F)], "2024Q1", "2024-03-31")
        self.assertEqual((round(r["v"], 3), r["b"], r["scope"], r["flags"] & 1, r["sg"]), (6432.292, "net", "lh", 1, [1, -1, 1, -1]))
        self.assertTrue(r["label"].startswith("נטו"))
        # a printed net figure still wins
        r = self.R.resolve([("2025Q1", F + [fact("2024-03-31", 6432, pg=86)])], "2024Q1", "2024-03-31")
        self.assertEqual((r["v"], r["scope"]), (6432, "group"))

    def test_net_prose_beats_gross_print(self):
        # Ayalon 31.03.24: the four lines are read from prose; their net outranks the gross figure of the same lines
        F = [fact("2024-03-31", 617.644, "gross", "life", src="text"), fact("2024-03-31", 88.765, "reinsurance", "life", src="text"),
             fact("2024-03-31", 591.865, "gross", "health", src="text"), fact("2024-03-31", 100.045, "reinsurance", "health", src="text"),
             fact("2024-03-31", 1209.509, "gross", "group")]
        r = self.R.resolve([("2025Q1", F)], "2024Q1", "2024-03-31")
        self.assertEqual((round(r["v"], 3), r["b"]), (1020.699, "net"))

    def test_first_of_january_is_the_year_end(self):
        reps = [("2025Q1", [fact("2024-01-01", 15904, pg=135), fact("2024-01-01", 17011, "gross", pg=135)])]
        self.assertEqual(self.R.dates_of(reps[0][1]), ["2023-12-31"])
        r = self.R.resolve(reps, "2023FY", "2023-12-31")
        self.assertEqual((r["v"], r["b"], r["scope"]), (15904, "net", "group"))


class CsmPublished(unittest.TestCase):
    """P6-D1 .. D3 and P4 on the published files"""

    @classmethod
    def setUpClass(cls):
        cls.peer = load("peers/m/ifrs-csm_closing.json")
        cls.summary = load("csm/summary.json")["resolved"]

    def test_harel_restated_comparatives(self):
        c = {x[0]: x for x in self.peer["e"]["harel"]["c"]}
        want = {"2023Q4": 15904, "2024Q4": 16358, "2025Q1": 16333, "2025Q2": 16520, "2025Q3": 16983, "2025Q4": 17177, "2026Q3": 17893}
        self.assertEqual({p: c[p][1] for p in want}, want)
        first = {"2024Q4": ("Q1'25", "16,548"), "2025Q1": ("Q1'25", "16,538"), "2025Q2": ("Q2'25", "16,687"), "2025Q3": ("Q3'25", "17,133")}
        pages = {"2024Q4": 16, "2025Q1": 16, "2025Q2": 19, "2025Q3": 22}
        for p, (rep, v) in first.items():
            self.assertTrue(c[p][4] & 8, f"{p} restated (flag 8)")
            self.assertIn(f"כפי שהודפס לראשונה (דוח {rep}): {v}", c[p][5])
            self.assertEqual(c[p][2], pages[p])
            self.assertTrue(c[p][5].startswith("נטו · קבוצה"))
        self.assertEqual(round((17893 / c["2025Q3"][1] - 1) * 100, 1), 5.4)  # Harel CSM YoY Q3'26

    def test_summary_agrees_with_peer_file(self):
        for co, e in self.peer["e"].items():
            res = {d[:4] + {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}[d[5:]]: x for d, x in self.summary.get(co, {}).items()}
            for c in e["c"]:
                self.assertEqual(c[1], res[c[0]][0], f"{co} {c[0]}")
                self.assertEqual(c[5].split("; ")[0], res[c[0]][1], f"{co} {c[0]} basis label")

    def test_no_basis_mix(self):
        for co in ("phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"):
            labs = {d: x[1] for d, x in self.summary[co].items()}
            self.assertTrue(all(l.startswith("נטו") for l in labs.values()), f"{co}: {labs}")

    def test_computed_cell_has_page_and_lines(self):
        for co, p, n in (("menora", "2024Q1", 4), ("migdal", "2024Q1", 2), ("ayalon", "2024Q3", 4)):
            c = {x[0]: x for x in self.peer["e"][co]["c"]}[p]
            self.assertTrue(c[4] & 1)
            self.assertIsNotNone(c[2], f"{co} {p}: page")
            self.assertIsNotNone(c[3], f"{co} {p}: link")
            self.assertEqual(len(c[6]), n)
            self.assertAlmostEqual(sum(x[1] for x in c[6]), c[1], places=3)
            self.assertIn("ברוטו פחות ביטוח משנה", c[5])

    def test_workbook_row_equals_peer_file(self):
        from xlsx_lib import read_book
        for co, e in self.peer["e"].items():
            f = DATA / "xlsx" / f"{co}.xlsx"
            if not f.exists():
                continue
            sh = next(s for s in read_book(f.read_bytes())["sheets"] if s[0] == "IFRS 17")[1]
            head = {k[:-1]: v[1] for k, v in sh.items() if re.fullmatch(r"[A-Z]+3", k)}
            row = next(int(k[1:]) for k, v in sh.items() if re.fullmatch(r"A\d+", k) and v[1] == "csm_resolved")
            got = {head[col]: sh[f"{col}{row}"][1] for col in head if f"{col}{row}" in sh and re.fullmatch(r"Q\d'\d\d", head[col])}
            for c in e["c"]:
                lab = f"Q{c[0][5]}'{c[0][2:4]}"
                if lab in head.values():
                    self.assertEqual(got.get(lab), c[1], f"{co} {lab}")

    def test_series_vintage(self):
        net = {(r["m"], r["s"], r["b"]): r["vals"] for r in load("series/harel.json")["rows"]}[("csm_closing", "group", "net")]
        self.assertEqual((net["2024Q4"]["v"], net["2024Q4"]["rst"]), (16358, 16548))
        self.assertEqual(net["2025Q3"]["v"], 16983)


class SolvencyTargetBasis(unittest.TestCase):
    def test_harel_threshold_same_basis(self):
        rows = [r for r in load("targets.json")["rows"] if r["c"] == "harel" and r["m"].startswith("target_solvency_ratio_dividend_threshold")]
        got = {r["m"]: r.get("act") for r in rows}
        w, wo = got["target_solvency_ratio_dividend_threshold_with_tmtp"], got["target_solvency_ratio_dividend_threshold_without_tmtp"]
        self.assertEqual((w["v"], wo["v"]), (165, 148))
        self.assertIn("עם הוראות מעבר", w["f"])
        self.assertIn("ללא הוראות מעבר", wo["f"])
        self.assertEqual(len(w["in"]), 1)


class ModelWorkbookWindow(unittest.TestCase):
    """B1: the company workbook runs to the latest filed quarter"""

    def test_last_quarter(self):
        import build_model_xlsx as M
        from xlsx_lib import read_book
        self.assertEqual(M.last_reported(M.Ctx()), (2026, 3))
        wb = read_book((DATA / "xlsx" / "harel.xlsx").read_bytes())
        pl = next(s[1] for s in wb["sheets"] if s[0] == "P&L")
        self.assertIn("Q3'26", [v[1] for k, v in pl.items() if re.fullmatch(r"[A-Z]+3", k)])
        row = next(int(k[1:]) for k, v in pl.items() if re.fullmatch(r"A\d+", k) and v[1] == "pl.ins_rev")
        col = next(k[:-1] for k, v in pl.items() if k.endswith("3") and re.fullmatch(r"[A-Z]+3", k) and v[1] == "Q3'26")
        self.assertEqual(pl[f"{col}{row}"][1], 3675)


if __name__ == "__main__":
    unittest.main()
