"""S10 Watch & Wake: the ledger diff (pipeline/build_watch.py) and the snapshot writer (pipeline/snapshot_answers.py) on synthetic snapshots.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_watch as W  # noqa: E402
import snapshot_answers as S  # noqa: E402


def ans(vk, corr, chg="holds", topic="flows", cos=("more",), h=None, st="ok"):
    return {"st": st, "vk": vk, "corr": corr, "cs": corr, "cf": {}, "chg_st": chg, "h": h or f"{vk}|{corr}", "topic": topic,
            "cos": list(cos), "q": "שאלה?", "asof": "Q2'26"}


def fnd(vk, corr, top=False, c="clal"):
    return {"st": "ok", "vk": vk, "corr": corr, "cs": corr, "cf": {}, "chg_st": None, "h": f"{vk}|{corr}", "det": "div", "cos": [c], "top": top,
            "asof": "Q2'26"}


def snap(date, answers, findings=None):
    return {"v": 1, "date": date, "src": "build", "answers": answers, "findings": findings or {}}


class DiffTest(unittest.TestCase):
    def setUp(self):
        self.a = snap("2026-10-28", {
            "Q-001": ans("yes", "כן, 1.4×."),
            "Q-002": ans("no", "לא, 0.8×."),
            "Q-003": ans("rank:3", "מקום 3."),
            "Q-004": ans("up", "עולה.", chg="holds"),
            "Q-005": ans("gone", "תשובה שתיעלם."),
            "Q-006": ans("x", "ללא שינוי."),
            "Q-007": ans("t", "נחצה.", chg="tripped"),
        }, {"F-div-clal-gem-a": fnd("fo:down", "פער 1."), "F-div-clal-gem-b": fnd("fo:up", "פער 2.", top=False)})
        self.b = snap("2026-11-01", {
            "Q-001": ans("yes", "כן, 1.4×."),                 # unchanged
            "Q-002": ans("yes", "כן, 1.1×."),                 # verdict changed
            "Q-003": ans("rank:3", "מקום 3, פער 2.1."),       # corridor only: the number moved, the verdict held
            "Q-004": ans("up", "עולה.", chg="tripped"),       # the falsifier crossed its threshold
            "Q-006": ans("x", "ללא שינוי."),
            "Q-007": ans("t", "נחצה.", chg="holds"),          # back under the threshold
            "Q-008": ans("new", "שאלה חדשה."),               # new
        }, {"F-div-clal-gem-a": fnd("fo:down", "פער 1."), "F-div-clal-gem-b": fnd("fo:up", "פער 2.", top=True),
            "F-peer-more-gem-ci": fnd("ci:up", "חדש.", c="more")})
        self.ch = {c["id"]: c for c in W.diff(self.a, self.b)}

    def test_unchanged_is_silent(self):
        self.assertNotIn("Q-001", self.ch)
        self.assertNotIn("Q-006", self.ch)
        self.assertNotIn("F-div-clal-gem-a", self.ch)

    def test_changed_vk(self):
        c = self.ch["Q-002"]
        self.assertEqual((c["kind"], c["sev"]), ("answer", "verdict"))
        self.assertEqual((c["from"]["vk"], c["to"]["vk"]), ("no", "yes"))
        self.assertEqual((c["from"]["corr"], c["to"]["corr"]), ("לא, 0.8×.", "כן, 1.1×."))
        self.assertEqual((c["d"], c["pd"], c["topic"], c["cos"]), ("2026-11-01", "2026-10-28", "flows", ["more"]))

    def test_changed_corr_only(self):
        c = self.ch["Q-003"]
        self.assertEqual((c["kind"], c["sev"]), ("answer", "figure"))
        self.assertEqual(c["from"]["vk"], c["to"]["vk"])

    def test_tripped_falsifier(self):
        c = self.ch["Q-004"]
        self.assertEqual(c["kind"], "tripped")
        self.assertEqual((c["from"]["chg"], c["to"]["chg"]), ("holds", "tripped"))
        u = self.ch["Q-007"]  # tripped -> holds: an answer change of the falsifier, not a new trip
        self.assertEqual((u["kind"], u["sev"]), ("answer", "falsifier"))

    def test_new_and_gone(self):
        n, g = self.ch["Q-008"], self.ch["Q-005"]
        self.assertEqual((n["kind"], n["from"]), ("new", None))
        self.assertEqual(n["to"]["vk"], "new")
        self.assertEqual((g["kind"], g["to"]), ("gone", None))
        self.assertEqual((g["from"]["corr"], g["topic"], g["q"]), ("תשובה שתיעלם.", "flows", "שאלה?"))
        f = self.ch["F-peer-more-gem-ci"]
        self.assertEqual((f["kind"], f["cos"], f["topic"], f["det"]), ("new", ["more"], None, "div"))

    def test_finding_top(self):
        c = self.ch["F-div-clal-gem-b"]
        self.assertEqual((c["kind"], c["sev"]), ("finding", "top"))

    def test_nodata_transition_is_a_verdict(self):
        b = snap("2026-11-02", {"Q-001": {**ans("nodata", "אין נתון", st="nodata"), "h": None, "chg_st": None}})
        c = W.diff(snap("2026-11-01", {"Q-001": ans("yes", "כן.")}), b)[0]
        self.assertEqual((c["kind"], c["sev"]), ("answer", "verdict"))

    def test_changes_over_the_ledger(self):
        c = snap("2026-11-02", {**self.b["answers"], "Q-002": ans("no", "לא, 0.7×.")}, self.b["findings"])
        out = W.changes([("2026-10-28", self.a), ("2026-11-01", self.b), ("2026-11-02", c)])
        self.assertEqual(out[0]["d"], "2026-11-02")                         # newest first
        self.assertEqual([x["id"] for x in out if x["d"] == "2026-11-02"], ["Q-002"])
        self.assertEqual(sum(x["id"] == "Q-002" for x in out), 2)           # once per day it changed
        day = [x for x in out if x["d"] == "2026-11-01"]
        self.assertEqual(day[0]["kind"], "tripped")                         # within a day: trips first
        self.assertEqual(W.problems({"changes": out}), [])

    def test_one_snapshot_no_changes(self):
        self.assertEqual(W.changes([("2026-11-01", self.b)]), [])


class UpcomingTest(unittest.TestCase):
    def test_regmonth_from_fetch_pattern(self):
        feed = {"events": [{"t": "regmonth", "per": "202607", "d": "2026-07-31", "dk": "month"},
                           {"t": "regmonth", "per": "202608", "d": "2026-10-09", "dk": "fetched"}]}
        latest, nxt = W.regmonth_next(feed, None)
        self.assertEqual(latest["label"], "08/26")
        self.assertEqual((nxt["per"], nxt["d"], nxt["n"], nxt["est"]), ("202609", "2026-11-09", 1, True))

    def test_regmonth_fallback_and_none(self):
        feed = {"events": [{"t": "regmonth", "per": "202608", "d": "2026-08-31", "dk": "month"}]}
        _, nxt = W.regmonth_next(feed, {"params": {"PUB_DAY": 9}})
        self.assertEqual((nxt["d"], nxt["n"]), ("2026-11-09", 0))
        self.assertEqual(W.regmonth_next({"events": []}, None), (None, None))

    def test_quarter_ends_and_labels(self):
        q = W.quarter_ends({"meta": {"live": {"q": "Q4-2026", "stage": 1}}})
        self.assertEqual([x["d"] for x in q], ["2026-12-31", "2027-03-31"])
        self.assertEqual((W.plabel("2026Q3"), W.plabel("2025FY")), ("Q3'26", "FY'25"))

    def test_calendar_rows(self):
        cal = {"basis": "חציון", "companies": [{"id": "harel", "next": {"period": "2026Q3", "expected": "2026-11-28", "lo": "2026-11-25", "hi": "2026-11-28", "lags": [1, 2, 3]}},
                                               {"id": "idi", "next": {"period": "2019FY", "n": 1}}]}
        _, up = W.upcoming(cal, {"events": []}, None)
        self.assertEqual([(u["c"], u["what"], u["lo"]) for u in up], [("harel", "דוח Q3'26", "2026-11-25")])


class SnapshotWriteTest(unittest.TestCase):
    def test_append_only_and_idempotent(self):
        with tempfile.TemporaryDirectory() as t:
            led = Path(t)
            s = snap("2026-11-01", {"Q-001": ans("yes", "כן.")})
            self.assertEqual(S.write(s, led), "written")
            first = (led / "2026-11-01.json").read_bytes()
            self.assertEqual(S.write(s, led), "kept")
            self.assertEqual(S.write(snap("2026-11-01", {"Q-001": ans("no", "לא.")}), led), "kept-differs")
            self.assertEqual((led / "2026-11-01.json").read_bytes(), first)  # never rewritten
            self.assertEqual(json.loads(first)["answers"]["Q-001"]["vk"], "yes")
            snaps, bad = W.load_ledger(led)
            self.assertEqual(([d for d, _ in snaps], bad), (["2026-11-01"], []))
            (led / "2026-11-02.json").write_text(S.dump({**s, "date": "2026-11-03"}))
            self.assertTrue(W.load_ledger(led)[1])  # a file whose name is not its date is a problem

    def test_entry_of_bodies(self):
        figs = {"x": {"l": "נתון", "v": 1.5, "u": "x", "t": "1.5×", "b": "actual", "asof": "Q2'26", "prov": {"k": "none", "title": "t", "why": "w"}}}
        e = S.entry({"st": "ok", "figs": figs, "corr": "יחס {x}.", "vk": "a", "chg": {"st": "tripped"}, "asof": "Q2'26"})
        self.assertEqual((e["corr"], e["cs"], e["chg_st"]), ("יחס 1.5×.", "יחס {x}.", "tripped"))
        self.assertNotIn("prov", e["cf"]["x"])
        n = S.entry({"st": "nodata", "why": "אין נתון"})
        self.assertEqual((n["vk"], n["corr"], n["h"]), ("nodata", "אין נתון", None))


if __name__ == "__main__":
    unittest.main()
