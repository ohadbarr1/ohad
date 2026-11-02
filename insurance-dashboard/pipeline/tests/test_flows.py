"""Wave 3 flows (pipeline/build_flows.py): the group x product cells, the intra-group migration, the default-fund effect, closing
transfers, ranks, the 3M / 12M sums, the flow signal and the fee log, on a synthetic set of published files; and the rules on the
published files. Standard library only."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPE))
import build_flows as BF  # noqa: E402

PM = "פנסיה מקיפה | כללי"
GM = "גמל | כללי"
MONTHS = [202601, 202602, 202603, 202604]


def hist(a, dep, wd, tr, fee=None, ct=PM, y=None, p=MONTHS):
    nd = [None if None in (d, w, t) else round(d - w + t, 1) for d, w, t in zip(dep, wd, tr)]
    return {"p": p, "y": y or [0.0] * len(p), "a": a, "fee": fee or [0.5] * len(p), "dep": dep, "wd": wd, "tr": tr, "nd": nd, "ct": [[p[0], ct]]}


def row(k, grp, prod="פנסיה מקיפה", track="כללי", mgr=None, assets=100.0):
    return {"k": k, "grp": grp, "prod": prod, "track": track, "mgr": mgr or grp, "assets": assets, "name": k}


class Fixture(unittest.TestCase):
    """group A: two pension tracks moving 50 between them (+ 10 net in), one default track (B), a closing gemel track (A)"""

    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        d = cls.dir
        (d / "funds").mkdir()
        live = [row("p1", "A"), row("p2", "A"), row("p3", "B"), row("g1", "A", "גמל"), row("p4", "C")]
        closed = [dict(row("g2", "A", "גמל"), gone=True, end=202603)]
        H = {
            "p1": hist([100, 100, 100, 100], [5, 5, 5, 5], [1, 1, 1, 1], [-50, -50, -50, -50], fee=[0.5, 0.5, 0.56, 0.56]),
            "p2": hist([100, 100, 100, 100], [5, 5, 5, 5], [1, 1, 1, 1], [60, 60, 60, 60]),
            "p3": hist([100, 100, 100, 100], [9, 9, 9, 9], [0, 0, 0, 0], [7, -3, 7, 7]),
            "p4": hist([100, 100, 100, 100], [1, 1, 1, 1], [0, 0, 0, 0], [-2, -2, -2, -2]),
            "g1": hist([0, 0, 50, 500], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], ct=GM),
            "g2": hist([400, 400, 0], [0, 0, 0], [0, 0, 0], [0, 0, -400], ct=GM, p=MONTHS[:3]),
        }
        for k, h in H.items():
            (d / "funds" / f"{k}.json").write_text(json.dumps(h, ensure_ascii=False), encoding="utf-8")
        (d / "funds.json").write_text(json.dumps({"asof": 202604, "funds": live}, ensure_ascii=False), encoding="utf-8")
        (d / "funds" / "closed.json").write_text(json.dumps({"funds": closed}, ensure_ascii=False), encoding="utf-8")
        (d / "funds" / "default.json").write_text(json.dumps({"tenders": [{"id": "T", "label": "הליך", "from": "2026-02-01", "to": "2028-10-31",
                                                                          "winners": [{"grp": "B", "ks": ["p3"], "map": "inferred"}]}]}, ensure_ascii=False), encoding="utf-8")
        (d / "market.json").write_text(json.dumps({"meta": {"fetched": "2026-05-20"}}), encoding="utf-8")
        cls.files = BF.build(d)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir)

    def cell(self, pid, g, p, f):
        doc = self.files[f"flows/{pid}.json"]
        S = doc["tot"] if g == "tot" else doc["groups"][g]
        return S[f][doc["months"].index(p)]

    def test_group_sums_and_identities(self):
        self.assertEqual(self.cell("pm", "A", 202601, "tr"), 10.0)
        self.assertEqual(self.cell("pm", "A", 202601, "dep"), 10.0)
        self.assertEqual(self.cell("pm", "A", 202601, "org"), 8.0)
        self.assertEqual(self.cell("pm", "A", 202601, "net"), 18.0)
        self.assertEqual(self.cell("pm", "tot", 202601, "a"), 400.0)

    def test_migration_is_the_cancelled_part(self):
        self.assertEqual(self.cell("pm", "A", 202601, "mig"), 50.0)  # -50 and +60 within A: 50 cancels
        self.assertEqual(self.cell("pm", "C", 202601, "mig"), 0.0)

    def test_default_effect_only_in_tender_months_and_only_inflows(self):
        self.assertEqual(self.cell("pm", "B", 202601, "dd"), 0.0)   # before the tender
        self.assertEqual(self.cell("pm", "B", 202601, "comp"), 7.0)
        self.assertEqual(self.cell("pm", "B", 202602, "dd"), 9.0)
        self.assertEqual(self.cell("pm", "B", 202602, "dt"), 0.0)   # a net outflow of a default fund stays competitive
        self.assertEqual(self.cell("pm", "B", 202602, "comp"), -3.0)
        self.assertEqual(self.cell("pm", "B", 202603, "dt"), 7.0)
        self.assertEqual(self.cell("pm", "B", 202603, "comp"), 0.0)

    def test_closing_transfer(self):
        self.assertEqual(self.cell("gm", "A", 202603, "cl"), -400.0)
        self.assertEqual(self.cell("gm", "A", 202603, "comp"), 0.0)
        self.assertEqual(self.cell("gm", "A", 202603, "res"), 50.0)  # g1's assets rose 50 with no flow

    def test_ranks(self):
        self.assertEqual(self.cell("pm", "A", 202601, "rk"), 1)
        self.assertEqual(self.cell("pm", "B", 202601, "rk"), 2)
        self.assertEqual(self.cell("pm", "C", 202601, "rk"), 3)

    def test_windows(self):
        L = self.files["flows.json"]["latest"]["pm"]
        self.assertEqual(L["A"]["tr3"], 30.0)
        self.assertEqual(L["B"]["comp3"], -3.0)  # months 02-04: -3 (an outflow), 0 and 0 (inflows to the default fund)
        self.assertNotIn("tr12", L["A"])         # four months only

    def test_signal_and_fees(self):
        sig = self.files["flows/sig.json"]
        self.assertEqual(sig["t"]["p1"], [-138.0, None])  # 3 x (5 - 1 - 50)
        self.assertEqual(sig["cats"][PM][:2], [4, 2])     # p2 and p3 positive, p1 and p4 negative
        rows = {r["k"]: r for r in self.files["flows/fees.json"]["rows"]}
        self.assertEqual(rows["p1"]["log"], [[202603, 0.5, 0.56]])
        self.assertEqual(rows["p2"]["log"], [])

    def test_rules_and_methods(self):
        self.assertEqual(BF.rules(self.files), [])
        bad = json.loads(json.dumps(self.files))
        del bad["flows.json"]["method"]["mig"]
        self.assertIn("method string missing: mig", BF.rules(bad))
        bad["flows/pm.json"]["groups"]["A"]["tr"][0] = 99.0
        self.assertTrue(any("tr 99.0 vs tracks" in b for b in BF.rules(bad)))

    def test_coverage(self):
        cov = self.files["flows.json"]["coverage"]
        self.assertIn("נטו בלבד", cov["tr_split"])
        self.assertEqual(self.files["flows.json"]["received"], "2026-05-20")
        self.assertEqual(self.files["flows.json"]["tenders"][0]["from"], 202602)


class Published(unittest.TestCase):
    def test_published_files_hold_the_rules(self):
        if not (BF.D / "flows.json").exists():
            self.skipTest("no flows.json")
        self.assertEqual(BF.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main()
