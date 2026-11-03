"""pipeline/build_nowcast.py on the repo's published files (standard library only): no look-ahead, the Stage 2 path, the abstention.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import datetime as dt
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_nowcast as B  # noqa: E402


class Nowcast(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.I = B.Inputs()

    def test_no_lookahead_reports(self):
        """every base quarter of every backtest estimate was printed before the stage day"""
        y, q = B.FIRST_TARGET
        n = 0
        while (y, q) <= self.I.last_rep:
            for c in B.COVER:
                T = self.I.print_day(c, y, q)
                if not T:
                    continue
                for st in (1, 2):
                    day = B.stage_day(dt.date.fromisoformat(T), st)
                    e = B.estimate(self.I, c, y, q, st, day)
                    if not e:
                        continue
                    for s in e["segs"].values():
                        for b in s["base"]:
                            n += 1
                            self.assertLess(b["printed"], day.isoformat(), f"{c} {y}Q{q} stage {st}: {b['q']} printed {b['printed']}")
                            self.assertLess(B.qparse(b["q"]), (y, q))
            y, q = B.qnext(y, q)
        self.assertGreater(n, 500)

    def test_no_lookahead_months(self):
        """Stage 1 reads months 1-2 only (month 3 is extrapolated); Stage 2 reads all three"""
        e1 = B.estimate(self.I, "harel", 2025, 3, 1, dt.date(2025, 10, 20))
        e2 = B.estimate(self.I, "harel", 2025, 3, 2, dt.date(2025, 11, 14))
        for s in e1["segs"].values():
            self.assertEqual([m.get("est", 0) for m in s["months"]], [0, 0, 0, 1])
        for s in e2["segs"].values():
            self.assertEqual([m.get("est", 0) for m in s["months"]], [0, 0, 0, 0])

    def test_stage2_scored(self):
        bt = B.backtest(self.I)
        self.assertTrue(bt)
        self.assertTrue(all("s2" in x and x["s2"].get("e_rev") is not None for x in bt))
        self.assertTrue(all(x.get("rev_s1s2") is not None for x in bt))

    def test_phoenix_policy(self):
        """the flag decides: off (owner, 27.10.26) = phoenix covered like any manager; on = nothing about phoenix computed or stored"""
        d = json.loads(B.OUT.read_text(encoding="utf-8"))
        if B.ABSTAIN_PHOENIX:
            self.assertNotIn("phoenix", B.COVER)
            self.assertTrue(B.no_phoenix({k: v for k, v in d.items() if k != "abstain"}))
            self.assertEqual(d["abstain"].get("phoenix"), B.ABSTAIN_TEXT)
        else:
            self.assertIn("phoenix", B.COVER)
            self.assertEqual(d["abstain"], {})

    def test_ledger_hash(self):
        for f in B.LEDGER.glob("*/stage*.json"):
            L = json.loads(f.read_text(encoding="utf-8"))
            self.assertEqual(B.sha(L["inputs"]), L["inputs_hash"], f)
            self.assertEqual(L["method_version"], L["inputs"]["method"])



class F2E(unittest.TestCase):
    """the flow-to-earnings method (F2E section): no look-ahead, the implied revenue re-derives, the deposit-fee file ties to market.json"""

    @classmethod
    def setUpClass(cls):
        cls.I = B.Inputs()
        cls.R = B.RegBook(cls.I)
        cls.bt = B.f2e_backtest(cls.I, cls.R)

    def test_depfee_ties(self):
        self.assertEqual(B.f2e_depfee_check(self.R), [])

    def test_implied(self):
        t = self.R.implied(self.I.G["harel"], "pen", 2026, 2)
        R = [m["R"] for m in t["months"]]
        self.assertAlmostEqual(t["acc"], (R[0] / 2 + R[1] + R[2] + R[3] / 2) / 12, places=3)
        self.assertAlmostEqual(t["dep"], sum(m["D"] for m in t["dmonths"]), places=3)
        self.assertGreater(t["dep"], 0, "pension carries deposit fees")
        self.assertEqual([m["ym"] for m in t["months"]], [202603, 202604, 202605, 202606])

    def test_no_lookahead(self):
        n = 0
        for b in self.bt:
            y, q = B.qparse(b["q"])
            e = B.f2e_estimate(self.I, self.R, b["c"], y, q, dt.date.fromisoformat(b["day"]))
            for s in e["segs"].values():
                for h in s["base"]:
                    n += 1
                    self.assertLess(h["printed"], b["day"])
                    self.assertLess(B.qparse(h["q"]), (y, q))
        self.assertGreater(n, 500)

    def test_ratio_and_range(self):
        for b in self.bt:
            self.assertLess(b["day"], b["T"])
            self.assertLessEqual(b["lo"], b["rev"])
            self.assertLessEqual(b["rev"], b["hi"])
            for s in b["segs"].values():
                self.assertAlmostEqual(s["rev"], s["ratio"] * s["imp"], delta=0.01)
                self.assertAlmostEqual(s["hi"] - s["rev"], s["rev"] - s["lo"], delta=0.01)

    def test_profit_needs_disclosed_costs(self):
        for b in self.bt:
            if b["op"] is not None:
                self.assertTrue(all(s["ci"] is not None for s in b["segs"].values()))

    def test_summary(self):
        S = B.f2e_summary(self.bt)
        self.assertEqual(S["all"]["rev"]["n"], len(self.bt))
        self.assertLess(S["all"]["rev"]["mdae"], 5, "the method explains the reported fee line")

    def test_ledger_hash(self):
        for f in B.F2E_LEDGER.glob("*/stage2.json"):
            L = json.loads(f.read_text(encoding="utf-8"))
            self.assertEqual(B.sha(L["inputs"]), L["inputs_hash"], f)
            self.assertEqual(L["method_version"], B.F2E_METHOD)


if __name__ == "__main__":
    unittest.main()
