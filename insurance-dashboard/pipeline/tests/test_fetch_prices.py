"""fetch_prices.py --update: the incremental merge keeps one row per trading day, the 15-month recent file, and moves older days into the
long history so mkt.json stays continuous. No network.

/usr/bin/python3 -m unittest pipeline.tests.test_fetch_prices
"""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_prices as fp  # noqa: E402


def row(d, close, **kw):
    return {"TradeDate": d.strftime("%d/%m/%Y"), "CloseRate": close, "BaseRate": close, "MarketValue": 1000.0, "RegisteredCapital": 10,
            "ExeDesc": None, "Change": 0.1, **kw}


class Merge(unittest.TestCase):
    def test_new_days_append_and_override_and_old_days_move_to_history(self):
        today = date(2026, 11, 23)
        cut = today - timedelta(days=fp.MONTHS * 31)
        recent = [row(cut + timedelta(days=i), 100 + i) for i in range(-3, 5)]  # three days already older than the window
        recent.reverse()  # the feed returns newest first
        hist = [row(cut - timedelta(days=10), 90)]
        hist = [{k: x.get(k) for k in fp.KEEP} for x in hist]
        new = [row(cut + timedelta(days=4), 777), row(today, 200)]  # a corrected day and a new day
        keep, h = fp.merge_update(recent, new, hist, today)
        days = [fp.iso(x["TradeDate"]) for x in keep]
        self.assertEqual(days, sorted(days, reverse=True), "newest first, as the feed")
        self.assertTrue(all(d >= cut.isoformat() for d in days))
        self.assertEqual(days[0], today.isoformat())
        self.assertEqual(len(days), len(set(days)), "one row per trading day")
        self.assertEqual(next(x for x in keep if fp.iso(x["TradeDate"]) == (cut + timedelta(days=4)).isoformat())["CloseRate"], 777)
        hd = [fp.iso(x["TradeDate"]) for x in h]
        self.assertEqual(len(hd), 4, "the old history row plus the three days that left the window")
        self.assertEqual(hd, sorted(hd))
        self.assertEqual(set(h[0]), set(fp.KEEP), "history rows are slim")

    def test_idempotent(self):
        today = date(2026, 11, 23)
        recent = [row(today - timedelta(days=i), 100) for i in range(5)]
        keep, h = fp.merge_update(recent, recent[:2], [], today)
        keep2, h2 = fp.merge_update(keep, recent[:2], h, today)
        self.assertEqual((keep, h), (keep2, h2))


if __name__ == "__main__":
    unittest.main()
