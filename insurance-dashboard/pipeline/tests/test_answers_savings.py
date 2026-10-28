"""The long-term-savings side of the Question Index (S1, Q-001 to Q-099): for a sample of questions, one figure is recomputed here
independently from the published files (lens.json, lts.json, funds/) and must equal the answer's figure, and the verdict branch (vk)
must agree with the figures. Standard library only.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import answer_core as A  # noqa: E402
import build_answers  # noqa: E402

DATA = ROOT.parent / "web" / "public" / "data"
MAIN8 = ["menora", "harel", "migdal", "phoenix", "clal", "meitav", "altshuler", "more"]
TOPICS = ("flows", "fees", "cost", "mix", "perf")


def jl(p):
    return json.loads((DATA / p).read_text(encoding="utf-8"))


class Savings(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        files = build_answers.build()
        cls.ans = {a["id"]: a for name, f in files.items() if name != "index.json" for a in f["rows"]}
        L = jl("lens.json")
        cls.L = L
        cls.ids = {i: g["id"] for i, g in enumerate(L["groups"])}
        cls.gix = {g["id"]: i for i, g in enumerate(L["groups"]) if g["id"]}
        cls.rows = {(r["g"], r["s"], r["q"]): r for r in L["rows"]}
        cls.q = L["meta"]["last_rep"]
        qs = L["quarters"]
        cls.q0 = qs[qs.index(cls.q) - 4]
        cls.qs4 = qs[qs.index(cls.q) - 3:qs.index(cls.q) + 1]

    def a(self, i):
        a = self.ans[i]
        self.assertEqual(a["st"], "ok", f"{i}: {a.get('why')}")
        return a

    def r(self, c, s, q=None):
        return self.rows.get((self.gix[c], s, q or self.q))

    def ltm(self, c, s):
        rs = [self.r(c, s, k) for k in self.qs4]
        return {k: math.fsum(x["rep"][k] for x in rs) for k in ("fees", "sm", "ga", "op")}, math.fsum(x["reg"]["avg"] for x in rs) / 4

    # ---------------------------------------------------------------------------------------------------- flows
    def test_q002_q003_who_takes_transfers(self):
        for qid, s in (("Q-002", "pen"), ("Q-003", "gem")):
            a = self.a(qid)
            xs = {self.ids[g]: r["reg"]["tr"] for (g, ss, qq), r in self.rows.items() if ss == s and qq == self.q and self.ids[g] and r["reg"]["tr"] is not None}
            top, bot = max(xs, key=xs.get), min(xs, key=xs.get)
            self.assertEqual(a["vk"], f"top:{top}|bot:{bot}")
            f = a["figs"]["top"]
            self.assertAlmostEqual(f["v"] * (1000 if f["u"] == "bn" else 1), xs[top], places=3)
            self.assertEqual(a["chg"]["st"], "holds")  # the leader's gap over the second is positive by construction

    def test_q005_ltm_transfers_from_the_monthly_series(self):
        a = self.a("Q-005")
        top = a["vk"].split("|")[0][4:]
        g = self.gix[top]
        v = math.fsum(math.fsum(self.L["series"][f"{g}|{s}"]["tr"][-12:]) for s in ("pen", "gem"))
        f = a["figs"]["top"]
        # the answer sums the pension + provident series (pg); the series are printed at one decimal, so pen + gem differs by rounding
        self.assertAlmostEqual(f["v"] * (1000 if f["u"] == "bn" else 1), v, delta=0.5)
        for c in self.gix:
            sp = [self.L["series"].get(f"{self.gix[c]}|{s}") for s in ("pen", "gem")]
            if all(sp) and all(x is not None for x in sp[0]["tr"][-12:] + sp[1]["tr"][-12:]):
                self.assertLessEqual(math.fsum(sp[0]["tr"][-12:]) + math.fsum(sp[1]["tr"][-12:]), v + 0.5, c)

    def test_q010_growth(self):
        a = self.a("Q-010")
        g = {}
        for (gi, s, q), r in self.rows.items():
            if s == "pg" and q == self.q and self.ids[gi] and r["reg"]["org"] is not None:
                g[self.ids[gi]] = (r["reg"]["org"] + r["reg"]["tr"]) / r["reg"]["aO"] * 100
        c = min(g, key=g.get)
        self.assertTrue(a["vk"].startswith(f"bot:{c}|"))
        self.assertAlmostEqual(a["figs"]["g"]["v"], g[c], delta=1e-3)  # lens.json prints growth at three decimals
        self.assertEqual(a["vk"].split("neg:")[1], str(sum(1 for v in g.values() if v < 0)))

    def test_q018_to_q025_share_verdicts(self):
        for i, c in enumerate(MAIN8):
            a = self.a(f"Q-{18 + i:03d}")
            d = self.r(c, "pg")["aum_share"] - self.r(c, "pg", self.q0)["aum_share"]
            self.assertAlmostEqual(a["figs"]["d"]["v"], round(d, 6), places=5)
            self.assertEqual(a["vk"], "yes" if d < 0 else "no", c)
            self.assertTrue(a["corr"].startswith("כן" if d < 0 else "לא"))

    def test_q012_gross_transfers_from_lts(self):
        a = self.a("Q-012")
        F = {(m, c, p): v for m, c, p, v, _ in jl("lts.json")["facts"]}
        x, y = F[("pen.tr_out", "all", self.q)], F[("pen.tr_out", "all", self.q0)]
        self.assertAlmostEqual(a["figs"]["a"]["v"], x, places=4)
        self.assertEqual(a["vk"], "yes" if x > y else "no")

    # ---------------------------------------------------------------------------------------------------- fees
    def test_q030_sector_fee_yield(self):
        a = self.a("Q-030")
        qs = self.L["quarters"][-8:]
        cs = [c for c in MAIN8 + ["analyst", "yelin"] if all((self.r(c, "pen", k) or {}).get("fy_reg") is not None for k in qs)]

        def fy(q):
            rs = [self.r(c, "pen", q) for c in cs]
            return math.fsum(r["rep"]["fees"] for r in rs) * 4 / math.fsum(r["reg"]["avg"] for r in rs) * 100

        d = (fy(self.q) - fy(self.q0)) * 100
        self.assertAlmostEqual(a["figs"]["a"]["v"], round(fy(self.q), 6), places=5)
        self.assertAlmostEqual(a["figs"]["d"]["v"], round(d, 6), places=4)
        self.assertEqual(a["vk"], "yes" if d < 0 else "no")

    def test_q038_to_q045_price_or_mix_adds_up(self):
        for i, c in enumerate(MAIN8):
            a = self.a(f"Q-{38 + i:03d}")
            f = a["figs"]
            d = (self.r(c, "pg")["fy_reg"] - self.r(c, "pg", self.q0)["fy_reg"]) * 100
            self.assertAlmostEqual(f["d"]["v"], round(d, 6), places=4)
            # rate + mix reproduces the change up to the rounding of the printed pg fee yield (4 decimals in lens.json)
            self.assertAlmostEqual(f["r"]["v"] + f["x"]["v"], d, delta=0.02)
            faster, drv = a["vk"].split("|")
            self.assertEqual(faster, "faster:" + ("y" if f["d"]["v"] < f["ds"]["v"] else "n"))
            self.assertEqual(drv, "drv:" + ("price" if abs(f["r"]["v"]) >= abs(f["x"]["v"]) else "mix"))

    def test_q067_ppb(self):
        a = self.a("Q-067")
        best, bv = None, None
        for c in MAIN8 + ["analyst"]:
            if c == "meitav" or not all(self.r(c, "pen", k) and self.r(c, "pen", k).get("rep") and self.r(c, "pen", k)["rep"]["op"] is not None for k in self.qs4):
                continue
            s, avg = self.ltm(c, "pen")
            v = s["op"] / (avg / 1000)
            if bv is None or v > bv:
                best, bv = c, v
        self.assertTrue(a["vk"].startswith(f"top:{best}|"))
        self.assertAlmostEqual(a["figs"]["top"]["v"], round(bv, 6), places=5)

    # ---------------------------------------------------------------------------------------------------- cost
    def test_q050_ltm_cost_income(self):
        a = self.a("Q-050")
        xs = {}
        for c in MAIN8 + ["analyst"]:
            if c == "meitav" or not all(self.r(c, "pen", k) and self.r(c, "pen", k).get("rep") and self.r(c, "pen", k)["rep"]["sm"] is not None for k in self.qs4):
                continue
            s, _ = self.ltm(c, "pen")
            xs[c] = (s["sm"] + s["ga"]) / s["fees"] * 100
        best = min(xs, key=xs.get)
        self.assertTrue(a["vk"].startswith(f"best:{best}|"))
        self.assertAlmostEqual(a["figs"]["best"]["v"], round(xs[best], 6), places=5)

    def test_q060_loss_branch(self):
        a = self.a("Q-060")
        loss = a["figs"]["op"]["v"]
        self.assertEqual(a["vk"] == "loss:none", loss >= 0)
        c = a["figs"]["op"]["c"]
        s = "pen" if a["vk"].split(":")[1].split(",")[0].endswith(".pen") else "gem"
        self.assertAlmostEqual(loss, round(self.ltm(c, s)[0]["op"], 6), places=5)

    def test_q052_to_q059_gap_value(self):
        for i, c in enumerate(MAIN8):
            a = self.a(f"Q-{52 + i:03d}")
            f = a["figs"]
            self.assertAlmostEqual(f["val"]["v"], round(f["gap"]["v"] / 100 * f["fees"]["v"], 6), delta=1e-3)
            if c == "meitav":
                self.assertEqual(a["vk"], "mark")
            else:
                self.assertEqual(a["vk"] == "best", f["gap"]["v"] <= 0)

    # ---------------------------------------------------------------------------------------------------- perf
    def test_q086_twelve_month_return_from_the_track_history(self):
        a = self.a("Q-086")
        f = a["figs"]["top"]
        p = f["prov"]
        h = jl(f"funds/{'p' if p['ds'] == 'pensia' else 'g'}{p['id']}.json")
        i = h["p"].index(p["period"])
        y = (math.prod(1 + x / 100 for x in h["y"][i - 11:i + 1]) - 1) * 100
        self.assertAlmostEqual(f["v"], y, delta=0.02)

    def test_q084_agreement_count(self):
        a = self.a("Q-084")
        k, n = a["vk"].split("|")[1].split("/")
        self.assertAlmostEqual(a["figs"]["sh"]["v"], round(int(k) / int(n) * 100, 6), places=4)
        self.assertEqual(a["vk"].startswith("agree:y"), int(k) / int(n) >= 2 / 3)

    # ---------------------------------------------------------------------------------------------------- every answer of the family
    def test_every_answer_obeys_the_rules(self):
        mine = [a for a in self.ans.values() if a["topic"] in TOPICS and int(a["id"][2:]) < 100]
        self.assertGreaterEqual(len(mine), 75)
        for a in mine:
            self.assertEqual(A.body_problems(a["id"], a), [], a["id"])
            self.assertEqual(a["st"], "ok", a["id"])
            self.assertTrue(a["links"], a["id"])
            self.assertTrue(a["ex"] and a["ex"]["foot"], a["id"])
            self.assertTrue(all(r in self.ans for r in a["rel"]), a["id"])
            text = A.render(a["email"], a["figs"]) + A.render(a["corr"], a["figs"])
            self.assertNotIn("{", text, a["id"])


if __name__ == "__main__":
    unittest.main()
