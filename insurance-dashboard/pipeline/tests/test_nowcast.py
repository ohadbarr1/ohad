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


if __name__ == "__main__":
    unittest.main()
