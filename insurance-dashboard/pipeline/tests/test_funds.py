"""F1 · the funds module's data: the net-of-fee estimate, real returns, percentile ranks, the official taxonomy mapping, the track rules,
and the funds contract (pipeline/check_funds_contract.py) on synthetic files and on the published ones. Standard library only."""
import ast
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPE))
import check_funds_contract as CF  # noqa: E402
import funds_lib as FL  # noqa: E402


def _track_rules():
    """build_funds.TRACK read as data (build_funds needs pandas to import), as build_warroom.py does"""
    for n in ast.parse((PIPE / "build_funds.py").read_text(encoding="utf-8")).body:
        if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "TRACK":
            return [(re.compile(rx), lab) for rx, lab in ast.literal_eval(n.value)]
    raise AssertionError("TRACK not found")


RULES = _track_rules()


def track_of(sub, name):
    for text in (sub, name):
        t = "" if text is None else str(text).lower()
        hit = next((lab for rx, lab in RULES if rx.search(t)), None)
        if hit:
            return hit
    return "אחר"


class Net(unittest.TestCase):
    def test_month(self):
        self.assertAlmostEqual(FL.net_month(1.0, 0.6), 0.95)
        self.assertIsNone(FL.net_month(None, 0.6))
        self.assertIsNone(FL.net_month(1.0, None))

    def test_fee_fill_forward_then_backward_within_limit(self):
        xs = [0.5, None, None, 0.4]
        self.assertEqual(FL.fill_fee(xs), [0.5, 0.5, 0.5, 0.4])
        self.assertEqual(FL.fill_fee([None, None, 0.7]), [0.7, 0.7, 0.7])          # the next published fee
        self.assertEqual(FL.fill_fee([0.5] + [None] * 13, limit=12)[-1], None)      # 13 months after the last print: none
        self.assertEqual(FL.fill_fee([0.5] + [None] * 12, limit=12)[-1], 0.5)

    def test_period_is_anchored_on_the_published_gross(self):
        ys = [1.0, -0.5, 2.0]
        self.assertAlmostEqual(FL.net_period(10.0, ys, ys), 10.0)                   # zero fee: net = published gross exactly
        ns = [y - 0.6 / 12 for y in ys]
        drag = (1.0095 * 0.9945 * 1.0195) / (1.01 * 0.995 * 1.02)
        self.assertAlmostEqual(FL.net_period(10.0, ys, ns), (1.10 * drag - 1) * 100)
        self.assertLess(FL.net_period(10.0, ys, ns), 10.0)
        self.assertIsNone(FL.net_period(10.0, ys, ns[:2]))
        self.assertIsNone(FL.net_period(None, ys, ns))

    def test_compound_and_annualise(self):
        self.assertAlmostEqual(FL.compound([10.0, 10.0]), 21.0)
        self.assertIsNone(FL.compound([1.0, None]))
        self.assertAlmostEqual(FL.annualise(45.69, 3), 13.36, places=2)             # the regulator's a3 from its y3 (p2009, 09/26)

    def test_one_year_of_a_fee_costs_about_the_fee(self):
        ys = [0.8] * 12
        g, n = FL.compound(ys), FL.compound([FL.net_month(y, 0.5) for y in ys])
        self.assertAlmostEqual(g - n, 0.5 * (1 + g / 100), delta=0.03)


class Real(unittest.TestCase):
    def test_one_year(self):
        self.assertAlmostEqual(FL.real(5.0, [2.0]), (1.05 / 1.02 - 1) * 100)
        self.assertIsNone(FL.real(5.0, [None]))

    def test_annualised(self):
        self.assertAlmostEqual(FL.real_ann(5.0, [2.0, 2.0, 2.0]), (1.05 / 1.02 - 1) * 100)
        self.assertAlmostEqual(FL.real_ann(5.0, [1.0, 2.0, 3.0]), (1.05 / (1.01 * 1.02 * 1.03) ** (1 / 3) - 1) * 100)


class Percentile(unittest.TestCase):
    def test_rule(self):
        p = FL.percentiles([("a", 1.0), ("b", 2.0), ("c", 3.0), ("d", 4.0), ("e", 5.0)])
        self.assertEqual({k: x for k, (x, _) in p.items()}, {"a": 0, "b": 25, "c": 50, "d": 75, "e": 100})
        self.assertTrue(all(n == 5 for _, n in p.values()))

    def test_ties_and_minimum(self):
        p = FL.percentiles([("a", 1.0), ("b", 1.0), ("c", 3.0), ("d", 4.0), ("e", 5.0)])
        self.assertEqual(p["a"][0], 13)                                              # 100 × (0 + ½) ÷ 4 = 12.5, half up
        self.assertEqual(FL.percentiles([("a", 1.0), ("b", 2.0), ("c", None), ("d", 3.0), ("e", 4.0)]), {})  # 4 values < 5


class Taxonomy(unittest.TestCase):
    def test_official_labels(self):
        o = lambda s, u: FL.official_track(s, u, track_of)  # noqa: E731
        self.assertEqual(o("מקבלי קצבה", "הלכה למקבלי קצבה קיימים"), "מקבלי קצבה")
        self.assertEqual(o("פנסיונרים", "בסיסי"), "מקבלי קצבה")
        self.assertEqual(o("מתמחים באפיקי השקעה סחירים", 'אג"ח ממשלתי סחיר'), 'אג"ח ממשלות')
        self.assertEqual(o('אג"ח', "פאסיבי"), 'עוקב מדדי אג"ח')
        self.assertEqual(o("מדרגות", "עד 50"), "עד 50")
        self.assertEqual(o("מתמחים בניהול אקטיבי", 'אשראי ואג"ח'), 'אשראי ואג"ח')
        self.assertEqual(o("עוקבי מדדים", "עוקב מדד s&p 500"), "עוקב מדד S&P 500")
        self.assertEqual(o("הלכתי", None), "הלכה")
        self.assertIsNone(o(None, None))
        self.assertIsNone(o("מתמחים בניהול אקטיבי", None))                           # says nothing: the name rules decide

    def test_name_rules_capped_equity_is_a_bond_track(self):
        self.assertEqual(track_of(None, 'כלל תמר אג"ח עד 25% מניות'), 'אשראי ואג"ח')
        self.assertEqual(track_of("משולב מניות", "הראל אג\"ח עד 25% מניות"), 'אשראי ואג"ח')
        self.assertEqual(track_of(None, 'הפניקס אשראי אג"ח עם מניות (עד 25% מניות)'), 'אשראי ואג"ח')
        self.assertEqual(track_of(None, "אלטשולר שחם פיצויים אג\"ח עד 15% במניות"), 'אשראי ואג"ח')
        self.assertEqual(track_of(None, "מגדל-כללי 3 ( עד 65% מניות)"), "כללי")
        self.assertEqual(track_of(None, "הראל השתלמות מניות"), "מניות")
        self.assertEqual(track_of(None, "מור גמל מניות סחיר"), "מניות סחיר")
        self.assertEqual(track_of(None, 'אנליסט אג"ח ללא מניות'), "ללא מניות")


def _row(k, fam, prod, track, assets, m1, net_m1, **kw):
    f = {"k": k, "fam": fam, "prod": prod, "track": track, "name": k, "mgr": "m", "grp": "g", "id": int(k[1:]), "assets": assets, "m1": m1,
         "ytd": None, "y12": None, "a3": None, "a5": None, "net": {"m1": net_m1}, "tx": {"src": "name"}}
    f.update(kw)
    return f


class Contract(unittest.TestCase):
    """the contract on a synthetic, consistent set of files, then with one defect at a time"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "funds").mkdir()
        self.old = CF.DATA, CF.RAW
        CF.DATA, CF.RAW = self.tmp, self.tmp / "no-raw"
        P = [202607, 202608, 202609]
        live, hist = [], {}
        for i in range(5):
            k = f"g{100 + i}"
            y = [1.0 + i / 10, 0.5, 0.2 * i]
            hist[k] = {"p": P, "y": y, "a": [100.0] * 3, "fee": [0.6] * 3, "yn": [round(x - 0.05, 3) for x in y], "ct": [[202607, "גמל | כללי"]]}
            live.append(_row(k, "gemel", "גמל", "כללי", 100.0, y[-1], round(y[-1] - 0.05, 2)))
        ranked = FL.percentiles([(f["k"], f["m1"]) for f in live])
        rankedn = FL.percentiles([(f["k"], f["net"]["m1"]) for f in live])
        for f in live:
            f["pr"], f["prn"] = {"m1": ranked[f["k"]][0]}, {"m1": 5}
            f["pn"], f["pnn"] = {"m1": rankedn[f["k"]][0]}, {"m1": 5}
        hist["g900"] = {"p": [202601, 202602], "y": [0.3, 0.4], "a": [50.0, 40.0], "fee": [0.5, 0.5], "yn": [0.258, 0.358], "ct": [[202601, "גמל | כללי"]]}
        closed = [_row("g900", "gemel", "גמל", "כללי", 40.0, 0.4, 0.36, gone=True, end=202602)]
        cats = {"גמל | כללי": {"p": [202601, 202602] + P, "y": [], "n": []}}
        for p in cats["גמל | כללי"]["p"]:
            xs = [(h["y"][h["p"].index(p)], h["a"][h["p"].index(p)]) for h in hist.values() if p in h["p"]]
            cats["גמל | כללי"]["y"].append(round(sum(y * a for y, a in xs) / sum(a for _, a in xs), 3))
            cats["גמל | כללי"]["n"].append(len(xs))
        self.F = {"asof": 202609, "source": "s", "funds": live, "closed_n": 1,
                  "tx": {"live": 5, "joined": 0, "mapped": 0, "dis": 0}}
        self.C = {"asof": 202609, "source": "s", "n": 1, "funds": closed}
        self.cats, self.hist = cats, hist
        self.write()

    def tearDown(self):
        CF.DATA, CF.RAW = self.old
        shutil.rmtree(self.tmp)

    def write(self):
        (self.tmp / "funds.json").write_text(json.dumps(self.F, ensure_ascii=False))
        (self.tmp / "funds" / "closed.json").write_text(json.dumps(self.C, ensure_ascii=False))
        (self.tmp / "funds" / "cat.json").write_text(json.dumps(self.cats, ensure_ascii=False))
        for p in (self.tmp / "funds").glob("[gpi]*.json"):
            p.unlink()
        for k, h in self.hist.items():
            (self.tmp / "funds" / f"{k}.json").write_text(json.dumps(h, ensure_ascii=False))

    def run_(self):
        R, skipped, _ = CF.run(quiet=True)
        return R, skipped

    def test_consistent_files_pass_and_say_upstream_was_skipped(self):
        R, skipped = self.run_()
        self.assertEqual(R.fail, [])
        self.assertIn("upstream checks skipped", skipped)

    def test_a_missing_history_fails(self):
        del self.hist["g103"]
        self.write()
        self.assertTrue(any("history files" in m for m in self.run_()[0].fail))

    def test_net_above_gross_fails(self):
        self.F["funds"][0]["net"]["m1"] = self.F["funds"][0]["m1"] + 0.5
        self.write()
        self.assertTrue(any("above gross" in m for m in self.run_()[0].fail))

    def test_a_wrong_percentile_fails(self):
        self.F["funds"][0]["pr"]["m1"] = 99
        self.write()
        self.assertTrue(any("percentiles" in m for m in self.run_()[0].fail))

    def test_a_category_without_its_closed_member_fails(self):
        self.cats["גמל | כללי"]["n"][0] = 0          # 01/26: the closed track was a member
        self.write()
        self.assertTrue(any("category months" in m for m in self.run_()[0].fail))

    def test_a_closed_row_must_end_on_its_history(self):
        self.C["funds"][0]["end"] = 202601
        self.write()
        self.assertTrue(any("last history month" in m for m in self.run_()[0].fail))

    def test_an_out_of_bounds_month_fails(self):
        self.F["funds"][1]["m1"] = 40.0
        self.write()
        self.assertTrue(any("outside" in m for m in self.run_()[0].fail))

    def test_nan_is_refused(self):
        (self.tmp / "funds.json").write_text(json.dumps(self.F).replace('"assets": 100.0', '"assets": NaN', 1))
        self.assertTrue(any("unreadable" in m for m in self.run_()[0].fail))


class Published(unittest.TestCase):
    """the published files obey the contract (the upstream half runs only where pandas and data/raw exist)"""

    @unittest.skipUnless((CF.DATA / "funds" / "closed.json").exists(), "funds files not built")
    def test_contract(self):
        R, skipped, summary = CF.run(quiet=True)
        self.assertEqual(R.fail, [], summary)

    @unittest.skipUnless((CF.DATA / "funds" / "closed.json").exists(), "funds files not built")
    def test_methods_are_stated(self):
        F = json.loads((CF.DATA / "funds.json").read_text(encoding="utf-8"))
        for k in ("net_method", "real_method", "pr_method", "basis"):
            self.assertTrue(F.get(k), k)
        self.assertIn("ברוטו", F["basis"])


if __name__ == "__main__":
    unittest.main()
