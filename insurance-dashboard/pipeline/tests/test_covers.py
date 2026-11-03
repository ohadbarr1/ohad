"""W11 · the cover price: pipeline/extract_covers.py's row reader on printed lines, and pipeline/build_covers.py's arithmetic and rules
on the committed tables (standard library only, no PDFs needed).

/usr/bin/python3 -m unittest pipeline.tests.test_covers -v   (or: discover -s pipeline/tests)
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_covers  # noqa: E402
import extract_covers  # noqa: E402


class RowReader(unittest.TestCase):
    def test_full_rows_with_dashes_and_hebrew_label(self):
        cols = [2010, 2005, 2000, 1995, "age"]
        text = "גיל המבוטח\n  294.77  294.44  -  -  עד 18\n 286.69  286.28  285.84  285.38  30\n  84\n"
        rows = extract_covers.data_rows(text, cols, "full")
        self.assertEqual(sorted(rows), [18, 30])
        self.assertEqual(rows[18]["2000"], None)
        self.assertEqual(rows[30]["1995"], 285.38)

    def test_left_filled_rows(self):
        cols = [2010, 2005, 2000, 1995, "age"]
        rows = extract_covers.data_rows("1.57  18\n0.99  1.07  1.17  1.29  30\n", cols, "left")
        self.assertEqual(rows[18], {"2010": 1.57, "2005": None, "2000": None, "1995": None})
        self.assertEqual(rows[30]["1995"], 1.29)

    def test_two_tables_side_by_side_and_age_first(self):
        cols = ["xf", "xm", "age", "f", "m", "age"]
        rows = extract_covers.data_rows("163.778  166.641  30  106.112  77.072  30\n", cols, "full")
        self.assertEqual(rows[30]["m"], 77.072)
        rows = extract_covers.data_rows("30  4.4659  4.8321\n", ["age", "m60", "f60"], "full")
        self.assertEqual(rows[30]["f60"], 4.8321)

    def test_mismatched_ages_are_not_a_row(self):
        self.assertEqual(extract_covers.data_rows("1.0  2.0  30  3.0  4.0  31\n", ["a", "b", "age", "c", "d", "age"], "full"), {})

    def test_left_table_with_a_hole_fails_the_check(self):
        t = {"kind": "mort", "fill": "left"}
        v = {a: [1.0, 1.1, 1.2] if a != 31 else [1.0, None, None] for a in range(28, 52)}
        self.assertIn("row length", extract_covers.check(t, v, [2010, 2005, 2000]))

    def test_out_of_range_cell_fails_the_check(self):
        t = {"kind": "dis", "fill": "full"}
        v = {a: 4.5 for a in range(18, 67)}
        v[40] = 450.0
        self.assertIn("outside", extract_covers.check(t, v, []))


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc, cls.errs = build_covers.build()

    def test_rules_hold_and_file_is_current(self):
        self.assertEqual(self.errs, [])
        text = json.dumps(self.doc, ensure_ascii=False, separators=(",", ":")) + "\n"
        self.assertEqual(build_covers.OUT.read_text(encoding="utf-8"), text)

    def test_the_formula_on_one_cell(self):
        """More, man, 30: (750 + 185 × 0.94) × 4.56 / 1000 and (600 × 285.57 + 400 × 77.07) × 1.29 / 100,000"""
        c = next(x for x in self.doc["funds"]["more"]["cells"] if x["sex"] == "m" and x["age"] == 30)
        self.assertEqual(c["dis"]["f"], 4.56)
        self.assertAlmostEqual(c["dis"]["cost"], (750 + 185 * 0.94) * 4.56 / 1000, places=3)
        self.assertEqual((c["surv"]["w"], c["surv"]["o"], c["surv"]["m"], c["surv"]["by"]), (285.57, 77.07, 1.29, 1995))
        self.assertAlmostEqual(c["surv"]["cost"], (600 * 285.57 + 400 * 77.07) * 1.29 / 100000, places=3)
        self.assertEqual(c["dis"]["pg"], [89])

    def test_migdal_combined_factor(self):
        c = next(x for x in self.doc["funds"]["migdal"]["cells"] if x["sex"] == "f" and x["age"] == 40)
        self.assertNotIn("w", c["surv"])
        self.assertEqual(c["surv"]["by"], 1984)  # nearest printed column to 1986
        self.assertAlmostEqual(c["surv"]["sar"], 1000 * c["surv"]["comb"], places=1)

    def test_excluded_table_leaves_a_null_with_the_reason(self):
        c = next(x for x in self.doc["funds"]["altshuler"]["cells"] if x["sex"] == "f" and x["age"] == 50)
        self.assertIsNone(c["surv"])
        self.assertIsNone(c["total"])
        self.assertIn("העתק", c["surv_why"])
        self.assertIsNotNone(c["dis"])

    def test_every_comprehensive_group_has_coverage(self):
        self.assertEqual({c["status"] for c in self.doc["coverage"]}, {"table"})
        self.assertEqual(len(self.doc["coverage"]), 9)

    def test_spread_rule_catches_a_misread_column(self):
        doc = json.loads(json.dumps(self.doc))
        doc["funds"]["more"]["cells"][0]["dis"]["f"] *= 3
        self.assertTrue(any(e.startswith("spread: more") for e in build_covers.check(doc, [])))


if __name__ == "__main__":
    unittest.main()
