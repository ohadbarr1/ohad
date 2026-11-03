"""The standardised IFRS 17 layer and the investment houses: portfolio codes, derived quarters, the roll-forward identity, run-off buckets,
segment selection and the published files equal a rebuild.  python3 -m unittest pipeline/tests/test_ifrs_std.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_houses as H  # noqa: E402
import build_ifrs_std as S  # noqa: E402


def row(**k):
    base = {"c": "harel", "rp": "2026Q2", "m": "insurance_revenue", "seg": "life", "ph": "total", "port": "total", "b": "na", "w": "q", "d": "2026-06-30",
            "v": 1.0, "pg": 10, "r": 1766123, "l": "", "src": "table"}
    base.update(k)
    return base


class PortfolioCodes(unittest.TestCase):
    def test_regulator_groups(self):
        self.assertEqual(S.port_std("life", "פוליסות הכוללות רכיב חיסכון שאינו תלוי תשואה"), "life_nonyield")
        self.assertEqual(S.port_std("life", "פוליסות הכוללות מרכיב חיסכון תלוי תשואה"), "life_yield")
        self.assertEqual(S.port_std("life", "פוליסות ללא רכיב חסכון"), "life_risk")
        self.assertEqual(S.port_std("health", "סיעודי: פרט"), "ltc_ind")
        self.assertEqual(S.port_std("health", "סיעוד קבוצתי"), "ltc_grp")
        self.assertEqual(S.port_std("health", "בריאות - אחר: הוצאות רפואיות ונכויות פרט"), "med_ind")
        self.assertEqual(S.port_std("health", "בריאות אחר - אחר"), "health_other")
        self.assertEqual(S.port_std("pc", "אחר"), "pc_other")
        self.assertEqual(S.port_std("pc", "רכב חובה"), "motor_comp")
        self.assertIsNone(S.port_std("life", "חוזי השקעה"))


class Quarters(unittest.TestCase):
    def test_printed_quarter_wins_and_derived_from_cumulative(self):
        rows = [row(w="q", d="2026-03-31", v=100, rp="2026Q1"), row(w="ytd", d="2026-06-30", v=230), row(w="fy", d="2025-12-31", v=420, rp="2025FY"),
                row(w="ytd", d="2025-09-30", v=300, rp="2025Q3")]
        s = S.series(rows, "harel", "life", "total", "insurance_revenue")
        self.assertEqual(s["2026Q1"][:3], [100, 10, 1766123])
        self.assertEqual(s["2026Q2"][0], 130)  # 230 - 100, derived
        self.assertEqual(s["2026Q2"][3], 1)
        self.assertEqual(s["2025Q4"][0], 120)  # FY - 9M
        self.assertNotIn("2025Q3", s)  # no quarter column and no 6M to subtract: an explicit null, not a guess

    def test_own_report_first_and_restatement_flag(self):
        rows = [row(w="instant", m="csm", d="2025-12-31", v=500, rp="2025FY", pg=5), row(w="instant", m="csm", d="2025-12-31", v=510, rp="2026Q2", pg=7)]
        s = S.series(rows, "harel", "life", "total", "csm")
        self.assertEqual(s["2025Q4"][0], 500)
        self.assertTrue(s["2025Q4"][3] & 2)
        self.assertEqual(s["2025Q4"][4][0], 510)


class RollForward(unittest.TestCase):
    def rf(self, close):
        base = dict(seg="group", b="net", port="total", ph="total")
        rows = [row(m="csm_opening", w="instant", d="2025-12-31", v=1000, **base), row(m="csm_new_business", w="ytd", v=60, **base),
                row(m="csm_interest_accretion", w="ytd", v=20, **base), row(m="csm_release", w="ytd", v=-50, **base),
                row(m="csm_closing", w="instant", v=close, **base)]
        return S.rollforwards(rows)

    def test_closes(self):
        r = self.rf(1030)
        self.assertEqual(len(r), 1)
        self.assertTrue(r[0]["ok"])
        self.assertEqual(r[0]["k"], "2026Q2")

    def test_break_is_listed_not_forced(self):
        r = self.rf(1100)
        self.assertFalse(r[0]["ok"])
        self.assertAlmostEqual(r[0]["diff"], 70)

    def test_sub_book_release_enters_only_without_a_whole_book_row(self):
        base = dict(seg="group", b="net")
        rows = [row(m="csm_opening", w="instant", d="2025-12-31", v=1000, **base), row(m="csm_new_business", w="ytd", v=60, **base),
                row(m="csm_release", w="ytd", v=-30, port=None, ph="מוצרי צמיחה", **base), row(m="csm_release", w="ytd", v=-20, port=None, ph="Run Off", **base),
                row(m="csm_closing", w="instant", v=1010, **base)]
        r = S.rollforwards(rows)
        self.assertTrue(r[0]["ok"])
        self.assertEqual(len(r[0]["rows"]), 3)


class Runoff(unittest.TestCase):
    def test_buckets_add_into_standard_ranges(self):
        rows = [row(c="clal", rp="2025FY", m="csm_expected_release", seg="group", b="gross", w="instant", d="2025-12-31", v=v, bucket=bk)
                for bk, v in [("up to 1 year", 10), ("1-2 years", 9), ("2-3 years", 8), ("3-4 years", 7), ("4-5 years", 6), ("5-10 years", 30), ("10-15 years", 20), ("over 15 years", 10)]]
        out = S.runoff(rows)["clal"]["group|gross"]
        std = {b[0]: b[2] for b in out["std"]}
        self.assertEqual(std, {"1": 10, "2-5": 30, "5-10": 30, "10+": 30})
        self.assertEqual(len(out["printed"]), 8)


class Houses(unittest.TestCase):
    def hr(self, **k):
        base = {"rp": "2025FY", "m": "segment_revenue", "code": "provident_pension", "he": "גמל", "w": "fy", "d": "2025-12-31", "v": 100.0, "u": "NIS millions",
                "pg": 3, "r": 1, "l": "הכנסות", "src": "table", "n": "", "ent": None}
        base.update(k)
        return base

    def test_parent_beats_sub_rows_and_two_printed_segments_add(self):
        rows = [self.hr(he="ניהול קופות גמל וקרנות פנסיה", v=900), self.hr(he="ניהול קופות גמל וקרנות פנסיה: גמל", v=600)]
        s, _ = H.segment_series(rows, "segment_revenue")
        self.assertEqual(s["provident_pension"]["fy|2025"][0], 900)
        rows = [self.hr(he="גמל", v=600, rp="2024FY", d="2024-12-31"), self.hr(he="פנסיה", v=300, rp="2024FY", d="2024-12-31")]
        s, _ = H.segment_series(rows, "segment_revenue")
        self.assertEqual(s["provident_pension"]["fy|2024"][0], 900)
        self.assertEqual(s["provident_pension"]["fy|2024"][3], 1)

    def test_units_and_margin(self):
        rows = [self.hr(v=200000, u="NIS thousands"), self.hr(m="segment_profit", v=50000, u="NIS thousands")]
        rev, _ = H.segment_series(rows, "segment_revenue")
        prof, _ = H.segment_series(rows, "segment_profit")
        self.assertEqual(rev["provident_pension"]["fy|2025"][0], 200)
        self.assertEqual(H.margins(rev, prof)["provident_pension"]["fy|2025"][0], 25.0)


class Published(unittest.TestCase):
    def test_files_equal_a_rebuild(self):
        self.assertEqual(S.main(["--check"]), 0)
        self.assertEqual(H.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main()
