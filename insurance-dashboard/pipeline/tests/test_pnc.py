"""W10 · P&C ratios and the segment-note parser (pipeline/build_pnc.py, pipeline/extract_pnc.py)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_pnc  # noqa: E402
import extract_pnc  # noqa: E402


class Ratios(unittest.TestCase):
    def test_definitions(self):
        r = build_pnc.ratios({"rev": 100.0, "ise": 80.0, "cl": 70.0, "past": -5.0, "ri": 10.0, "rx": 20.0})
        self.assertAlmostEqual(r["lr"], 0.65)
        self.assertAlmostEqual(r["er"], 0.15)
        self.assertAlmostEqual(r["cr"], 0.80)
        self.assertAlmostEqual(r["lr"] + r["er"], r["cr"])
        self.assertAlmostEqual(r["crn"], (80 - 10) / (100 - 20))
        self.assertAlmostEqual(r["ces"], 0.20)

    def test_no_revenue_no_ratio(self):
        self.assertEqual(build_pnc.ratios({"rev": 0.0, "ise": 5.0}), {})

    def test_built_file_verifies(self):
        d = build_pnc.build()
        bad, n = build_pnc.verify(d)
        self.assertEqual(bad, [])
        self.assertGreater(n, 1000)
        for c in d["cos"].values():
            ltm = c["lines"]["pc"]["per"]["ltm"]
            self.assertTrue(0.3 < ltm["r"]["cr"] < 1.5)


class Parser(unittest.TestCase):
    def test_split_negative_forms_and_dashes(self):
        vals, lab = extract_pnc.split("  )(1,071   ()509   ( )7  ) (5   ‐    423      ‫הוצאות מביטוח משנה‬")
        self.assertEqual(vals, [-1071.0, -509.0, -7.0, -5.0, 0.0, 423.0])
        self.assertEqual(lab, "הוצאות מביטוח משנה")

    def test_broken_tav_inside_a_word_is_a_letter(self):
        vals, lab = extract_pnc.split("  2,321   1,339   657   325   הכנסו� משירו�י ביטוח")
        self.assertEqual(vals, [2321.0, 1339.0, 657.0, 325.0])
        self.assertEqual(lab, "הכנסות משירותי ביטוח")

    def test_identities_flag_a_bad_page(self):
        E = {"total": {"rev": 10.0, "ise": 7.0, "isr_gross": 3.0}, "mc": {"rev": 4.0, "ise": 3.0, "isr_gross": 1.0},
             "mp": {"rev": 3.0, "ise": 2.0, "isr_gross": 1.0}, "other": {"rev": 3.0, "ise": 2.0, "isr_gross": 2.0}}
        bad = extract_pnc.check(E, 0.5)
        self.assertTrue(any("other" in b for b in bad))


if __name__ == "__main__":
    unittest.main()
