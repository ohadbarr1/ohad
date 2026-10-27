"""The Fragility Monitor (module A10): the threshold rules, the A2 line reading, the percentile, the no-composite assertion, and the A6 hook
(a published position on a company that crosses into watch / alert is marked for review and reaches the feed). Standard library only.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_fragility as bf  # noqa: E402
import build_positions as bp  # noqa: E402
import check_schemas  # noqa: E402
import position as cli  # noqa: E402


class Rules(unittest.TestCase):
    def test_flow(self):
        x = {"v3": -100.0, "p3": -50.0, "a0": 1000.0, "run": 3}
        self.assertEqual(bf.state("flow", x), "alert")                       # 10% of assets, three negative windows
        self.assertEqual(bf.state("flow", {**x, "run": 2}), "watch")         # below the previous window
        self.assertEqual(bf.state("flow", {**x, "run": 2, "p3": -200.0}), "ok")  # negative but improving
        self.assertEqual(bf.state("flow", {**x, "v3": 5.0}), "ok")
        self.assertEqual(bf.state("flow", {**x, "a0": 100000.0}), "watch")   # 0.1% of assets: not an alert
        self.assertEqual(bf.state("flow", {**x, "a0": 100000.0}, {"flow_pct": 0.05}), "alert")

    def test_fee_reads_the_peers(self):
        self.assertEqual(bf.state("fee", {"d": -3.0, "rel": -0.1}), "ok")    # the whole sector compressed
        self.assertEqual(bf.state("fee", {"d": -3.0, "rel": -1.5}), "watch")
        self.assertEqual(bf.state("fee", {"d": -6.0, "rel": -2.0}), "alert")
        self.assertEqual(bf.state("fee", {"d": -6.0, "rel": None}), "alert")  # no peers: the absolute rule

    def test_perf_cost_solv_csm_scen(self):
        self.assertEqual(bf.state("perf", {"g": -0.31, "d": None}), "alert")
        self.assertEqual(bf.state("perf", {"g": 0.4, "d": -0.3}), "ok")      # decay of a positive gap is not a warning
        self.assertEqual(bf.state("perf", {"g": -0.05, "d": -0.2}), "watch")
        self.assertEqual(bf.state("cost", {"l": 100.0, "d": -30.0}), "alert")
        self.assertEqual(bf.state("cost", {"l": 80.0, "d": 3.0}), "watch")
        self.assertEqual(bf.state("solv", {"h": -0.1, "d": None}), "alert")
        self.assertEqual(bf.state("solv", {"h": 30.0, "d": -10.0}), "watch")
        self.assertEqual(bf.state("solv", {"h": 30.0, "d": None}), "ok")
        self.assertEqual(bf.state("csm", {"y": 4.9, "d": None}), "alert")
        self.assertEqual(bf.state("csm", {"y": 12.0, "d": -1.0}), "watch")
        self.assertEqual(bf.state("scen", {"hw": 5.0, "h0": 20.0}), "watch")
        self.assertEqual(bf.state("scen", {"hw": -1.0, "h0": 20.0}), "alert")
        self.assertEqual(bf.state("scen", {"hw": 15.0, "h0": -1.0}), "alert")

    def test_eval_line_is_the_stress_lab_reading(self):
        pts = [{"x": -50.0, "v": -14.0}]
        self.assertEqual(bf.read_line(pts, -50)["v"], -14.0)
        self.assertAlmostEqual(bf.read_line(pts, -25)["v"], -7.0)          # between the origin and the point
        r = bf.read_line(pts, -120)
        self.assertEqual((r["v"], r["extra"]), (-14.0, True))              # clamped beyond the disclosure
        self.assertEqual(bf.read_line(pts, 100)["v"], 0)                   # no point on that side: the origin
        self.assertIsNone(bf.read_line([], -50))

    def test_percentile(self):
        self.assertEqual(bf.percentile([1, 2, 3, 4, 5], 5, "hi"), 100)
        self.assertEqual(bf.percentile([1, 2, 3, 4, 5], 1, "hi"), 0)
        self.assertEqual(bf.percentile([1, 2, 3, 4, 5], 1, "lo"), 100)
        self.assertIsNone(bf.percentile([1, 2], 1, "hi"))

    def test_js_month_arithmetic(self):
        self.assertEqual(bf.add_months_iso("2025-12-31", 6), "2026-07-01")
        self.assertEqual(bf.add_months_iso("2026-06-30", -15), "2025-03-30")


class Built(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = bf.build()
        cls.spec = json.loads((bf.ROOT / "web" / "src" / "lib" / "schemas.json").read_text(encoding="utf-8"))

    def test_clean_and_schema(self):
        self.assertEqual(bf.problems(self.out), [])
        errs = []
        check_schemas.Validator(self.spec).check(self.out, {"$ref": "#/$defs/fragility"}, "", errs)
        self.assertEqual(errs, [])

    def test_no_composite_is_asserted(self):
        o = copy.deepcopy(self.out)
        o["rows"][0]["score"] = 72
        self.assertTrue(any("composite" in b for b in bf.problems(o)))
        o = copy.deepcopy(self.out)
        o["rows"][0]["sig"]["flow"]["segs"] = {k: {**x, "rating": 1} for k, x in o["rows"][0]["sig"]["flow"]["segs"].items()}
        self.assertTrue(any("composite" in b for b in bf.problems(o)))

    def test_stale_or_missing_is_never_a_pass(self):
        by = {r["c"]: r for r in self.out["rows"]}
        h = by["hachshara"]["sig"]["solv"]
        self.assertEqual(h["st"], "nodata")
        self.assertTrue(h.get("stale"))
        self.assertIn("30.06.24", h["why"])
        for r in self.out["rows"]:
            for s in bf.SIG_IDS:
                for x in r["sig"][s]["segs"].values():
                    if x.get("stale"):
                        self.assertEqual(x["st"], "nodata", f"{r['c']} {s}")

    def test_examples_of_the_plan(self):
        by = {r["c"]: r for r in self.out["rows"]}
        lens = by["altshuler"]["sig"]["flow"]["segs"]["pen"]["lens"]
        self.assertEqual((lens["q"], round(lens["tr"]), round(lens["fs"], 1)), ("Q2'26", -2160, -7.3))   # -NIS 2.16bn, -7.3% flow share
        self.assertEqual(round(by["more"]["sig"]["cost"]["segs"]["pen"]["q"]), 164)                   # More pension cost / income
        self.assertEqual(by["more"]["sig"]["cost"]["st"], "alert")

    def test_a_published_position_is_marked_for_review(self):
        ctx = bp.Ctx()
        with tempfile.TemporaryDirectory() as t:
            work, led = Path(t) / "positions", Path(t) / "ledger"
            book = cli.Book(work, led, ctx=ctx, today="2025-01-02")
            gap = "lens:clal:pg:ci.ltm - lens:median(harel,migdal,menora,phoenix):pg:ci.ltm"
            book.new({"id": "test-clal-frag", "claim": "כלל תסגור מחצית מפער יחס ההוצאות להכנסות מול חציון המבטחות עד FY'28.", "horizon": "2029-03-31",
                      "confidence": "low", "direction": "constructive", "company": "clal", "mechanism": "הוצאות שגדלות מהר מדמי הניהול.",
                      "evidence": [{"ref": "/fragility", "note": "המוניטור"}, {"ref": "lens:clal:pg:ci.ltm", "note": "LTM"}],
                      "falsifiers": [{"metric": gap, "op": ">", "value": 7.0, "period": "Q4'28", "note": ""}], "review": "print"})
            book.publish("test-clal-frag")
            out, _ = bp.build(ctx, led, work)
            p = out["positions"][0]
            self.assertTrue(p["frag"], "Clal crossings after 02.01.25 mark the position")
            self.assertTrue(all(m["c"] == "clal" and m["d"] > "2025-01-02" and m["st"] in ("watch", "alert") for m in p["frag"]))
            ev = [e for e in out["events"] if e.get("pk") == "fragility"]
            self.assertEqual(len(ev), len(p["frag"]))
            errs = []
            check_schemas.Validator(self.spec).check(out, {"$ref": "#/$defs/positions"}, "", errs)
            self.assertEqual(errs, [])


if __name__ == "__main__":
    unittest.main()
