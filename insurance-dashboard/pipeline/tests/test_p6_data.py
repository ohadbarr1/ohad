"""P6 data defects found by the Pro tester on the peers board and the company pages (26.11.26), one test per fix (standard library only).

cd pipeline && /usr/bin/python3 -m unittest tests.test_p6_data -v

  B2   one value per (company, metric, period): the IFRS 17 note families follow the statements' restatement rule (latest print), so the
       peer board's Harel Q4'25 (FY − Q1 − Q2 − Q3) equals the company page's (FY − 9M)
  B7   Harel's Q3'26 statement rewords the pre-tax line ("רווח תפעולי לפני מסים על ההכנסה"): one line, role pbt, Q3'26 = 670 (p. 54)
  B11  the ROE bridge runs to Q3'26 (the pre-tax line is no longer missing there)
  B1   the model workbook a company page links runs to the latest filed quarter
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
