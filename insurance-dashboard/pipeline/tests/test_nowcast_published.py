"""P5 (fox 3.0 phase 1): the nowcast is published as a forecast made BEFORE the report. The live quarter's stage is frozen in the
append-only ledgers before the first expected print, a rebuild never rewrites it, and every frozen row carries the date the page shows.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_nowcast as B  # noqa: E402


class Published(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.I = B.Inputs()
        cls.y, cls.q, cls.st = B.live_stage(cls.I)
        cls.qk = B.qkey(cls.y, cls.q)

    def test_live_stage_frozen(self):
        """the stage today's data supports is on disk: a run of build_nowcast.py writes nothing over it"""
        if not self.st:
            self.skipTest("no stage before month 2 of the quarter is in")
        p = B.ledger_path(self.qk, self.st)
        self.assertTrue(p.exists(), f"{p} not frozen: run python3 pipeline/build_nowcast.py before the first {B.qlabel(self.qk)} print")
        if self.st == 2:
            self.assertTrue(B.f2e_ledger_path(self.qk).exists(), "the flow-to-earnings stage 2 is not frozen")

    def test_frozen_before_first_print(self):
        """every frozen entry of the quarter was created before the earliest expected print of its rows, and before any actual print"""
        for L in B.read_ledger() + B.f2e_read_ledger():
            rows = L["inputs"]["rows"]
            first = min((e["T_expected"] for e in rows if e.get("T_expected")), default=None)
            if first:
                self.assertLess(L["created_at"][:10], first, f"{L['quarter']} stage {L['stage']} frozen {L['created_at']} after {first}")
            y, q = B.qparse(L["quarter"])
            for e in rows:
                T = self.I.print_day(e["c"], y, q)
                if T:
                    self.assertLess(L["created_at"][:10], T, f"{e['c']} {L['quarter']}: printed {T} before the freeze")

    def test_freeze_is_write_once(self):
        """the freeze writes a stage file only when it does not exist (main's guard); the hash of every frozen entry recomputes"""
        src = Path(B.__file__).read_text(encoding="utf-8")
        self.assertIn("if p.exists():", src)
        self.assertIn("if not p.exists():", src)
        for L in B.read_ledger():
            self.assertEqual(B.sha(L["inputs"]), L["inputs_hash"])

    def test_page_reads_the_ledger(self):
        """nowcast_f2e.json carries the frozen quarter the published view shows, with its freeze time and range"""
        f = json.loads((B.WEB / "nowcast_f2e.json").read_text(encoding="utf-8"))
        qs = {L["quarter"] for L in f["ledger"]}
        self.assertIn(self.qk, qs)
        for s in f["score"]:
            self.assertLessEqual(s["lo"], s["rev"])
            self.assertLessEqual(s["rev"], s["hi"])


if __name__ == "__main__":
    unittest.main()
