"""The attribution math (pipeline/attribution.py): the contributions sum exactly to the change, the order of the factors does not matter,
products split exactly, and the published bridges keep those properties (python3 -m unittest discover -s pipeline/tests)."""
import json
import random
import sys
import unittest
from math import fsum
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import attribution as A  # noqa: E402

DATA = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "data" / "attribution"


def state(rng, splits=True):
    parts = {p: (rng.uniform(0.5, 2.0), rng.uniform(10, 300)) for p in ("pen", "gem", "ins")}
    other = rng.uniform(-50, 200)
    fees = fsum(y * a for y, a in parts.values()) + other
    comps = {"isr": rng.uniform(-200, 900), "inv": rng.uniform(-400, 1200), "fees": fees, "cost": -rng.uniform(100, 700)}
    comps["other"] = rng.uniform(-100, 300)
    pbt = fsum(comps.values())
    npv = pbt * rng.uniform(0.6, 0.75)
    return {"comps": comps, "splits": {"fees": (parts, other)} if splits else {}, "pbt": pbt, "np": npv, "np_attr": npv - rng.uniform(0, 30),
            "q": 400 / rng.uniform(8000, 14000)}


class Shapley(unittest.TestCase):
    def test_two_factor_product_is_midpoint(self):
        f = lambda x: x["a"] * x["b"]
        phi = A.shapley(["a", "b"], {"a": 2.0, "b": 10.0}, {"a": 3.0, "b": 14.0}, f)
        self.assertAlmostEqual(phi["a"], 1.0 * (10 + 14) / 2)
        self.assertAlmostEqual(phi["b"], 4.0 * (2 + 3) / 2)

    def test_efficiency_and_order(self):
        rng = random.Random(7)
        f = lambda x: (x["C"] * x["k"] - x["M"]) * x["q"]
        for _ in range(50):
            x0 = {"C": rng.uniform(-100, 1000), "k": rng.uniform(0.5, 0.8), "M": rng.uniform(0, 30), "q": rng.uniform(0.01, 0.05)}
            x1 = {"C": rng.uniform(-100, 1000), "k": rng.uniform(0.5, 0.8), "M": rng.uniform(0, 30), "q": rng.uniform(0.01, 0.05)}
            a = A.shapley(["C", "k", "M", "q"], x0, x1, f)
            b = A.shapley(["q", "M", "k", "C"], x0, x1, f)
            self.assertAlmostEqual(fsum(a.values()), f(x1) - f(x0), places=9)
            for k in a:
                self.assertAlmostEqual(a[k], b[k], places=9)

    def test_product_split_exact(self):
        rng = random.Random(3)
        for _ in range(50):
            p0 = {p: (rng.uniform(0.5, 2), rng.uniform(1, 100)) for p in ("pen", "gem")}
            p1 = {p: (rng.uniform(0.5, 2), rng.uniform(1, 100)) for p in ("pen", "gem")}
            o0, o1 = rng.uniform(0, 50), rng.uniform(0, 50)
            c0 = fsum(y * a for y, a in p0.values()) + o0
            c1 = fsum(y * a for y, a in p1.values()) + o1
            self.assertAlmostEqual(fsum(A.product_split(p0, p1, o0, o1).values()), c1 - c0, places=9)

    def test_bridge_exact_both_modes(self):
        rng = random.Random(11)
        for _ in range(50):
            s0, s1 = state(rng), state(rng)
            for rate in (True, False):
                for wq in (True, False):
                    v0, v1, out, res = A.bridge(s0, s1, rate=rate, with_q=wq)
                    self.assertAlmostEqual(fsum(out.values()) + res, v1 - v0, places=9)
                    self.assertLess(abs(res), 1e-9)
                    want = (s1["np_attr"] * (s1["q"] if wq else 1)) - (s0["np_attr"] * (s0["q"] if wq else 1))
                    self.assertAlmostEqual(v1 - v0, want, places=7)

    def test_unchanged_factor_contributes_nothing(self):
        rng = random.Random(5)
        s0 = state(rng, splits=False)
        s1 = json.loads(json.dumps(s0))
        s1["comps"]["isr"] += 100
        s1["pbt"] += 100
        s1["np"] = s1["pbt"] * s0["np"] / s0["pbt"]
        s1["np_attr"] = s1["np"] - (s0["np"] - s0["np_attr"])
        _, _, out, _ = A.bridge(s0, s1, rate=True, with_q=True)
        for k in ("inv", "fees", "cost", "other", "tax", "minority", "equity"):
            self.assertAlmostEqual(out[k], 0.0, places=9)


@unittest.skipUnless((DATA / "phoenix.json").exists(), "attribution files not built")
class Published(unittest.TestCase):
    def test_bridges_sum(self):
        for p in sorted(DATA.glob("*.json")):
            d = json.loads(p.read_text(encoding="utf-8"))
            for b in d.get("bridges", []):
                for m in ("roe", "np"):
                    if m in b:
                        br = b[m]
                        self.assertAlmostEqual(fsum(x["v"] for x in br["drivers"]) + br["residual"], br["total"], delta=0.0005 * (len(br["drivers"]) + 2),
                                               msg=f"{p.name} {b['id']} {m}")
                        self.assertTrue(all(x["in"] for x in br["drivers"]))


if __name__ == "__main__":
    unittest.main()
