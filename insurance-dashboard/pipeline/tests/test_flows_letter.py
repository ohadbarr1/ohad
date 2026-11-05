"""P3: the monthly flows letter (pipeline/build_flows_letter.py) on a fixture month and on the published files. Standard library only.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import copy
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_flows_letter as L  # noqa: E402

METHOD = {k: f"method {k}" for k in L.METHOD_KEYS}
P = [202607, 202608, 202609]


def series(**kw):
    return {k: list(v) for k, v in kw.items()}


def fixture(d: Path):
    """two products, three groups and the bucket; pm has a default-fund tender month and a closing"""
    (d / "flows").mkdir(parents=True)
    idx = {"v": 1, "asof": 202609, "received": "2026-11-01", "src": "fixture", "bucket": "אחרות", "method": METHOD,
           "coverage": {"tr_split": "x", "group": "y", "default": "z"},
           "prods": [{"id": "pm", "label": "פנסיה מקיפה", "flows": True}, {"id": "hs", "label": "השתלמות", "flows": True},
                     {"id": "po", "label": "פוליסות", "flows": False}],
           "tenders": [{"label": "ההליך", "from": 202411, "to": 202710, "winners": [{"grp": "ב"}, {"grp": "ב"}]}]}
    pm = {"months": P, "groups": {
        "א": series(a=[100, 110, 120], tr=[5, 6, 50], comp=[5, 6, 50], dt=[0, 0, 0], cl=[0, 0, 0], mig=[1, 1, 3], org=[2, 2, 2], net=[7, 8, 52], dep=[3, 3, 3], wd=[1, 1, 1], rk=[1, 1, 1]),
        "ב": series(a=[100, 100, 100], tr=[1, 1, 20], comp=[1, 1, -10], dt=[0, 0, 30], cl=[0, 0, 0], mig=[0, 0, 0], org=[1, 1, 1], net=[2, 2, 21], dep=[2, 2, 2], wd=[1, 1, 1], rk=[2, 2, 2]),
        "ג": series(a=[50, 50, 40], tr=[-6, -7, -45], comp=[-6, -7, -35], dt=[0, 0, 0], cl=[0, 0, -10], mig=[0, 0, 2], org=[0, 0, 0], net=[-6, -7, -45], dep=[1, 1, 1], wd=[1, 1, 1], rk=[3, 3, 3]),
        "אחרות": series(a=[10, 10, 10], tr=[0, 0, 0], comp=[0, 0, 0], dt=[0, 0, 0], cl=[0, 0, 0], mig=[0, 0, 0], org=[0, 0, 0], net=[0, 0, 0], dep=[0, 0, 0], wd=[0, 0, 0], rk=[None, None, None])},
          "tot": series(a=[260, 270, 270], tr=[0, 0, 25], comp=[0, 0, 5], dt=[0, 0, 30], cl=[0, 0, -10], mig=[1, 1, 5], org=[3, 3, 3], net=[3, 3, 28], dep=[6, 6, 6], wd=[3, 3, 3])}
    hs = {"months": P, "groups": {
        "א": series(a=[30, 30, 30], tr=[1, 1, -4], comp=[1, 1, -4], cl=[0, 0, 0], mig=[0, 0, 0], org=[0, 0, 0], net=[1, 1, -4], dep=[0, 0, 0], wd=[0, 0, 0], rk=[1, 1, 2]),
        "ד": series(a=[None, 5, 9], tr=[None, 4, 4], comp=[None, 4, 4], cl=[None, 0, 0], mig=[None, 0, 0], org=[None, 0, 0], net=[None, 4, 4], dep=[None, 0, 0], wd=[None, 0, 0], rk=[None, 2, 1])},
          "tot": series(a=[30, 35, 39], tr=[1, 5, 0], comp=[1, 5, 0], cl=[0, 0, 0], mig=[0, 0, 0], org=[0, 0, 0], net=[1, 5, 0], dep=[0, 0, 0], wd=[0, 0, 0])}
    (d / "flows.json").write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    (d / "flows" / "pm.json").write_text(json.dumps(pm, ensure_ascii=False), encoding="utf-8")
    (d / "flows" / "hs.json").write_text(json.dumps(hs, ensure_ascii=False), encoding="utf-8")
    return pm


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.pm = fixture(self.d)

    def tearDown(self):
        self.tmp.cleanup()

    def test_body(self):
        B = L.body(self.d)
        self.assertEqual(B["p"], 202609)
        self.assertEqual([x["id"] for x in B["prods"]], ["pm", "hs"])   # a product without flows is not in the letter
        pm = B["prods"][0]
        self.assertEqual(pm["top"]["grp"], "א")
        self.assertEqual(pm["low"]["grp"], "ג")
        self.assertNotIn("אחרות", [r["grp"] for r in pm["groups"] if r["rk"] is not None])   # the bucket is never ranked
        # across products: א = 50 − 4, ג = −35, ד new to hs (since 08/26)
        acr = {r["grp"]: r for r in B["across"]}
        self.assertEqual(acr["א"]["comp"], 46.0)
        self.assertEqual(B["winner"]["grp"], "א")
        self.assertEqual(B["loser"]["grp"], "ג")
        self.assertNotIn("אחרות", acr)
        self.assertEqual(next(r for r in B["prods"][1]["groups"] if r["grp"] == "ד")["since"], 202608)
        # the decomposition: tr = comp + dt + cl per product and across
        for x in B["prods"]:
            t = x["tot"]
            self.assertAlmostEqual(t["tr"], t["comp"] + t["dt"] + t["cl"], places=6)
        T = B["total"]
        self.assertAlmostEqual(T["tr"], math.fsum([25, 0]))
        self.assertAlmostEqual(T["tr"], T["comp"] + T["dt"] + T["cl"], places=6)
        self.assertEqual(B["tenders"][0]["winners"], ["ב"])
        self.assertIsNone(B["under"])                                  # no under.json of the month: no section
        self.assertTrue(B["headline"][0].startswith("09/26"))
        self.assertIn("\u2066+₪46\u2069 מיליון", B["headline"][0])
        self.assertEqual([x["k"] for x in B["defs"]["fox"]], ["tr", "comp", "dt", "cl", "mig", "org", "net"])
        self.assertTrue(all("Funder" not in c for c in B["defs"]["compare"]))   # fox's own checks; no characterisation of anyone else

    def test_versions(self):
        f1, L1 = L.build(self.d, today="2026-11-05")
        L.write(self.d, f1)
        self.assertEqual((L1["ver"], len(L1["versions"])), (1, 1))
        # same inputs: nothing new, byte for byte
        f2, L2 = L.build(self.d, today="2026-11-06")
        self.assertEqual(L.write(self.d, f2), [])
        self.assertEqual(L2["built"], "2026-11-05")
        # the regulator revises the month: version 2, version 1 frozen, the moved figures listed
        pm = copy.deepcopy(self.pm)
        pm["groups"]["א"]["comp"][2] = 60
        pm["groups"]["א"]["tr"][2] = 60
        pm["tot"]["comp"][2] = 15
        pm["tot"]["tr"][2] = 35
        (self.d / "flows" / "pm.json").write_text(json.dumps(pm, ensure_ascii=False), encoding="utf-8")
        f3, L3 = L.build(self.d, today="2026-11-07")
        L.write(self.d, f3)
        self.assertEqual((L3["ver"], L3["built"]), (2, "2026-11-07"))
        snap = json.loads((self.d / L.LETTERS / "202609.v1.json").read_text(encoding="utf-8"))
        self.assertEqual(snap["hash"], L1["hash"])
        ch = {c["k"]: c for c in L3["versions"][-1]["changes"]}
        self.assertEqual((ch["pm.א.comp"]["a"], ch["pm.א.comp"]["b"]), (50, 60))
        self.assertEqual(L3["permalink"], f"{L.SITE}/flows/letter/202609?v=2")
        self.assertEqual(L.verify(self.d), [])
        ix = json.loads((self.d / L.LETTERS / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(ix["letters"][0]["ver"], 2)
        self.assertEqual(ix["events"][0]["id"], "letter:202609")
        self.assertEqual(ix["events"][0]["d"], "2026-11-01")
        # a snapshot never changes: tampering is caught
        snap["body"]["headline"][0] = "x"
        (self.d / L.LETTERS / "202609.v1.json").write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
        self.assertTrue(any("v1" in b for b in L.verify(self.d)))


class Published(unittest.TestCase):
    """the letter of the latest regulator month is on disk, current, and ties to flows.json"""
    def test_current(self):
        idx = json.loads((L.D / "flows.json").read_text(encoding="utf-8"))
        p = L.D / L.LETTERS / f"{idx['asof']}.json"
        self.assertTrue(p.exists(), "run pipeline/build_flows_letter.py")
        x = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(x["hash"], L.sha(L.body(L.D)), "the letter is stale: run pipeline/build_flows_letter.py")
        self.assertEqual(L.verify(L.D), [])
        pm = json.loads((L.D / "flows" / "pm.json").read_text(encoding="utf-8"))
        j = pm["months"].index(idx["asof"])
        top = next(r for r in x["body"]["prods"] if r["id"] == "pm")["top"]
        self.assertEqual(top["comp"], pm["groups"][top["grp"]]["comp"][j])


if __name__ == "__main__":
    unittest.main()
