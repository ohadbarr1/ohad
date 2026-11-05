"""pipeline/build_feebook.py on the repo's published files (standard library only): the formula on hand cases, the file re-derives,
no EV without reported costs, the floor and the trend cap hold, the sensitivity grid recomputes.

/usr/bin/python3 -m unittest tests.test_feebook   (from pipeline/)
"""
import json
import sys
import unittest
from math import fsum
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_feebook as F  # noqa: E402


class Formula(unittest.TestCase):
    def test_hand(self):
        self.assertAlmostEqual(F.ev_book(1000, 1, 0, None, 1, 0.5, 8, 0, 1), 1000 * 0.01 * 0.5 / 1.08, places=12)
        self.assertAlmostEqual(F.ev_book(1000, 1, 0, None, 0.9, 0, 0, 10, 2), 10 + 9.9, places=12)

    def test_floor(self):
        self.assertAlmostEqual(F.ev_book(100, 0.3, -0.1, 0.22, 1, 0, 0, 0, 3), 0.3 + 0.22 + 0.22, places=12)
        self.assertAlmostEqual(F.ev_book(100, 0.15, -0.1, 0.22, 1, 0, 0, 0, 3), 0.45, places=12)

    def test_null(self):
        self.assertIsNone(F.ev_book(100, 0.5, 0, None, 0.9, None, 8, 0, 30))
        self.assertIsNone(F.ev_book(100, 0.5, 0, None, None, 0.5, 8, 0, 30))

    def test_monotone(self):
        b = F.ev_book(1000, 0.5, -0.01, None, 0.9, 0.6, 8, 0, 30)
        self.assertLess(F.ev_book(1000, 0.5, -0.01, None, 0.9, 0.6, 10, 0, 30), b)
        self.assertGreater(F.ev_book(1000, 0.5, -0.01, None, 0.95, 0.6, 8, 0, 30), b)
        self.assertGreater(F.ev_book(1000, 0.5, -0.01, None, 0.9, 0.6, 8, 0, 40), b)


class File(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = F.build()

    def test_disk_equals_build(self):
        disk = json.loads(F.OUT.read_text(encoding="utf-8"))
        self.assertEqual(disk, json.loads(json.dumps(self.d, ensure_ascii=False)))

    def test_verify(self):
        self.assertEqual(F.verify(self.d), [])

    def test_rows(self):
        A = self.d["assume"]
        n = 0
        for x in self.d["rows"]:
            if x.get("skip"):
                continue
            n += 1
            self.assertLessEqual(x["eros"], 0)
            if x["ci"] is None:
                self.assertIsNone(x["ev"])
                self.assertTrue(x["why"])
            if x["p"].startswith("pension"):
                self.assertEqual(x["floor"], A["floor"]["fee"])
            else:
                self.assertIsNone(x["floor"])
        self.assertGreater(n, 40)

    def test_grid(self):
        A = self.d["assume"]
        for m in self.d["managers"]:
            if not m["grid"]:
                continue
            i, j = A["grid_r"].index(A["disc"]), A["grid_s"].index(0.0)
            self.assertAlmostEqual(m["grid"][i][j], m["ev"], delta=0.06)
            col = [row[j] for row in m["grid"]]
            if m["ev"] > 0:
                self.assertEqual(col, sorted(col, reverse=True), f"{m['c']}: EV falls with the discount rate")

    def test_costs_from_reports(self):
        for m in self.d["managers"]:
            for s, c in m["costs"].items():
                if "ci" in c:
                    self.assertEqual(c["q"], self.d["meta"]["cost_quarters"])
                    self.assertAlmostEqual(c["ci"], (c["sm"] + c["ga"]) / c["fees"], places=5)

    def test_service_fee(self):
        """fb1.1: Meitav's fee to its controlling company enters G&A; no other manager carries one; the comparison that flagged the
        page (Meitav G&A at 1.7% of fees against 22% or more elsewhere) no longer holds"""
        mg = {m["c"]: m for m in self.d["managers"]}
        for c, m in mg.items():
            for s, x in m["costs"].items():
                if "ci" not in x:
                    continue
                if c in F.SERVICE_FEE:
                    self.assertAlmostEqual(x["ga"], fsum(p["ga"] for p in x["parts"]), places=3)
                    self.assertAlmostEqual(x["sf"], fsum(p["sf"] for p in x["parts"]), places=3)
                    self.assertGreater(x["ci_ga"], 0.15, f"{c} {s}: G&A without the service fee")
                else:
                    self.assertNotIn("sf", x)
                    self.assertTrue(all("sf" not in p for p in x["parts"]))
        mv = mg["meitav"]["costs"]
        self.assertAlmostEqual(mv["pen"]["sf"], 85.083, places=3)
        self.assertAlmostEqual(mv["gem"]["sf"], 124.832, places=3)
        self.assertLess(mg["meitav"]["ev_aum"], 1.2)

    def test_floor_source(self):
        f = self.d["assume"]["floor"]
        self.assertTrue(f and f["src"].startswith("https://") and f["fee"] > 0)


class ServiceFee(unittest.TestCase):
    """service_fee on the printed segment note (data/extracted_lts/meitav): printed quarters, Q4 = FY - 9M, the year adds up"""

    def test_quarters(self):
        q, why = F.service_fee("meitav", "pen", ["Q3-2025", "Q4-2025", "Q1-2026", "Q2-2026"])
        self.assertIsNone(why)
        self.assertAlmostEqual(q["Q3-2025"], 20.830, places=6)           # printed three months, 2025Q3 p.40
        self.assertAlmostEqual(q["Q4-2025"], 85.883 - 62.460, places=6)  # FY-2025 (p.104) - 9M-2025 (p.39)
        self.assertAlmostEqual(q["Q2-2026"], 20.432, places=6)

    def test_year_adds_up(self):
        for seg, fy in (("pen", 81.741), ("gem", 119.732)):
            q, _ = F.service_fee("meitav", seg, ["Q1-2024", "Q2-2024", "Q3-2024", "Q4-2024"])
            self.assertAlmostEqual(fsum(q.values()), fy, places=6)

    def test_none(self):
        self.assertEqual(F.service_fee("clal", "gem", ["Q1-2026"]), (None, None))
        q, why = F.service_fee("meitav", "pen", ["Q1-2019"])
        self.assertIsNone(q)
        self.assertTrue(why)

    def test_q_end(self):
        self.assertEqual([F.q_end(q) for q in ("Q1-2026", "Q2-2026", "Q3-2025", "Q4-2025")], ["2026-03-31", "2026-06-30", "2025-09-30", "2025-12-31"])


if __name__ == "__main__":
    unittest.main()
