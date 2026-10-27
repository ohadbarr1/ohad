"""A8 · the regulatory impact simulator: the arithmetic mirrors drivers.ts, a rule's own price maps to an exact A1 fee shock, the default-fund
redistribution is zero-sum, the register cites public documents, and the built file verifies. Standard library only."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_regulation as br  # noqa: E402


def product(A=10_000.0, fy=0.30, vc=None):
    edges = [] if vc is None else [{"e": "aum.opex", "x": 1, "v": vc, "quality": "high"}]
    return {"s": "pen", "avg": {"v": A}, "fy": {"v": fy}, "edges": edges}


class Arithmetic(unittest.TestCase):
    def test_fee_shock_is_the_identity_edge(self):
        # 1 bp on assets = − assets × 0.01% (A1 edge fee.op), costs unchanged
        dA, dRev, dVar, dOp = br.prod_delta(product(A=20_000.0), 0.0, 1.0)
        self.assertEqual(dA, 0.0)
        self.assertAlmostEqual(dOp, -2.0, places=9)

    def test_flow_at_the_product_yield_with_variable_cost(self):
        dA, dRev, dVar, dOp = br.prod_delta(product(A=10_000.0, fy=0.30, vc=2.0), 10.0, 0.0)
        self.assertAlmostEqual(dA, 1_000.0)
        self.assertAlmostEqual(dRev, 3.0)          # 1,000 × 0.30%
        self.assertAlmostEqual(dVar, 2.0)          # NIS 2m per NIS 1bn
        self.assertAlmostEqual(dOp, 1.0)

    def test_rule_price_maps_to_an_exact_fee_shock(self):
        A, fy, price = 10_000.0, 0.30, 0.22
        dA = 500.0
        fee = br.fee_equiv(A, dA, fy, price)
        _, dRev, _, _ = br.prod_delta(product(A=A, fy=fy), dA / A * 100, fee)
        self.assertAlmostEqual(dRev, dA * price / 100, places=9)


class Built(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out, cls.I = br.build()

    def test_verifies(self):
        self.assertEqual(br.verify(self.out, self.I), [])

    def test_register_cites_public_documents(self):
        for e in self.out["initiatives"]:
            self.assertTrue(e["sources"], e["id"])
            for s in e["sources"]:
                self.assertRegex(s["url"], br.ALLOWED.pattern, e["id"])
                self.assertRegex(s["retrieved"], r"^\d{4}-\d\d-\d\d$")

    def test_default_redistribution_is_zero_sum_and_split_as_printed(self):
        e = next(x for x in self.out["initiatives"] if x["model"]["kind"] == "default")
        split = next(q for q in e["model"]["params"] if q["k"] == "alloc")["split"]
        self.assertEqual(sum(split.values()), 100)
        for b in br.BANDS:
            self.assertAlmostEqual(sum(p["net_flow"][b] for x in e["impacts"] for p in x["products"]), 0.0, delta=0.05)
        winners = {x["c"] for x in e["impacts"] if x["aum"]["central"] > 0}
        self.assertEqual(winners, set(split))

    def test_in_force_adds_nothing_to_the_pipeline(self):
        for e in self.out["initiatives"]:
            if e["status"] == "in_force":
                self.assertEqual(e["w"], 0)

    def test_exposure_ranked_and_weighted(self):
        ex = self.out["exposure"]
        self.assertEqual([x["d"]["central"] for x in ex], sorted(x["d"]["central"] for x in ex))
        self.assertNotIn("more_gemel", {x["c"] for x in ex})

    def test_file_on_disk_matches(self):
        on_disk = json.loads(br.OUT.read_text(encoding="utf8"))
        self.assertEqual(on_disk, json.loads(br.dumps(self.out)))


if __name__ == "__main__":
    unittest.main()
