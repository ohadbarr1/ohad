"""W8 feeds: the static RSS / Atom feeds (pipeline/build_rss.py) and the calendar files (pipeline/build_calendar.py). Standard library only.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import copy
import json
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_rss as br  # noqa: E402

PUB = br.PUB
DATA = br.DATA


def feed():
    return json.loads((DATA / "feed.json").read_text(encoding="utf-8"))


class Published(unittest.TestCase):
    def test_every_feed_well_formed_and_complete(self):
        files = sorted(PUB.glob("feed.*")) + sorted((PUB / "feed").glob("*.*"))
        self.assertGreaterEqual(len(files), 8)
        for p in files:
            self.assertEqual(br.validate(p.read_bytes(), p.suffix == ".atom"), [], p.name)

    def test_named_feeds_exist(self):
        for rel in ("feed.xml", "feed.atom", "feed/months.xml", "feed/funds.xml", "feed/harel.xml", "feed/market.xml"):
            self.assertTrue((PUB / rel).exists(), rel)

    def test_months_feed_is_regulator_months_only(self):
        root = ET.fromstring((PUB / "feed" / "months.xml").read_bytes())
        guids = [g.text for g in root.iter("guid")]
        self.assertTrue(guids and all(g.startswith(br.TAG + "regmonth:") for g in guids))

    def test_check_passes(self):
        self.assertEqual(br.check(), [])


class Ledger(unittest.TestCase):
    def test_backfill_then_received(self):
        F = feed()
        led, n = br.seen_dates(F, None)
        self.assertEqual(n, len(F["events"]))
        fetched = [e for e in F["events"] if e["dk"] == "fetched"]
        for e in F["events"]:
            d, k = led["seen"][e["id"]]
            self.assertEqual(k, "r" if e in fetched else "b")
            self.assertLessEqual(d, F["built"])
        # a later build: an id the ledger has keeps its date; a new id gets that build's day
        F2 = copy.deepcopy(F)
        F2["built"] = "2027-01-05"
        new = copy.deepcopy(next(e for e in F["events"] if e["t"] == "filing"))
        new["id"] = "filing:999999999"
        F2["events"].insert(0, new)
        led2, n2 = br.seen_dates(F2, led)
        self.assertEqual(n2, 1)
        self.assertEqual(led2["seen"]["filing:999999999"], ["2027-01-05", "r"])
        self.assertEqual({k: v for k, v in led2["seen"].items() if k != "filing:999999999"}, led["seen"])

    def test_guid_stable_and_pubdate_is_received(self):
        F = feed()
        led, _ = br.seen_dates(F, None)
        a, _, _ = br.build(F, led)
        b, _, _ = br.build(copy.deepcopy(F), copy.deepcopy(led))
        self.assertEqual(a, b)                       # deterministic: a pure function of feed.json and the ledger
        root = ET.fromstring(a["feed/months.xml"].encode())
        it = next(i for i in root.iter("item") if i.findtext("guid").endswith("regmonth:202609")) if any(
            i.findtext("guid").endswith("regmonth:202609") for i in root.iter("item")) else None
        if it is not None:
            got = led["seen"]["regmonth:202609"][0]
            self.assertIn(f"{int(got[8:10]):02d} ", it.findtext("pubDate"))

    def test_escaping(self):
        F = feed()
        led, _ = br.seen_dates(F, None)
        e = copy.deepcopy(next(x for x in F["events"] if x["t"] == "filing"))
        e["h"] = 'דוח <רבעוני> & "בדיקה"'
        F["events"] = [e]
        files, _, _ = br.build(F, led)
        self.assertEqual(br.validate(files["feed.xml"].encode(), False), [])
        self.assertEqual(br.validate(files["feed.atom"].encode(), True), [])
        self.assertIn('&lt;רבעוני&gt; &amp;', files["feed.xml"])

    def test_figures_as_the_site_shows_them(self):
        self.assertEqual(br.fmt_fig({"v": 0.18, "u": "pct"}), "0.18%")
        self.assertEqual(br.fmt_fig({"v": -0.05, "u": "pp"}), "−0.05")
        self.assertEqual(br.fmt_fig({"v": 1234.5, "u": "m"}), "1,235")
        self.assertEqual(br.fmt_fig({"v": -0.0001, "u": "dm"}), "0.0")
        self.assertEqual(br.rfc822("2026-11-01"), "Sun, 01 Nov 2026 00:00:00 +0200")
        self.assertEqual(br.rfc822("2026-07-01")[-5:], "+0300")


class Calendars(unittest.TestCase):
    def test_ics_files(self):
        files = [DATA / "calendar.ics"] + sorted((DATA / "cal").glob("*.ics"))
        self.assertIn(DATA / "cal" / "reminders.ics", files)
        for p in files:
            raw = p.read_bytes()
            self.assertTrue(raw.endswith(b"\r\n"), p.name)
            lines = raw.split(b"\r\n")[:-1]
            for ln in lines:
                self.assertLessEqual(len(ln), 75, f"{p.name}: line over 75 octets")
                ln.decode("utf-8")                    # never folded inside a character
            text = raw.decode("utf-8")
            self.assertEqual(text.count("BEGIN:VEVENT"), text.count("END:VEVENT"), p.name)
            self.assertTrue(text.startswith("BEGIN:VCALENDAR") and "END:VCALENDAR" in text, p.name)

    def test_reminders_content(self):
        t = (DATA / "cal" / "reminders.ics").read_text(encoding="utf-8").replace("\r\n ", "")
        self.assertIn("UID:fox-annual-statement@", t)
        self.assertIn("RRULE:FREQ=YEARLY", t)
        self.assertRegex(t, r"DTSTART;VALUE=DATE:\d{4}0331")
        self.assertIn("UID:fox-regmonth@", t)
        self.assertIn("(אומדן)", t)                    # the regulator publishes no schedule: labelled an estimate


if __name__ == "__main__":
    unittest.main()
