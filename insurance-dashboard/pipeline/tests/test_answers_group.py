"""S1 · the group / insurance / capital families of the Question Index (Q-100..Q-199): for a sample of questions one figure is recomputed
independently from its source file (plain json, none of the question code), and the verdict branch (`vk`) is checked against the figures.
Reads the published answers (web/public/data/answers); run build_answers.py first. Standard library only."""
import json
import sys
import unittest
from math import fsum
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "web" / "public" / "data"
sys.path.insert(0, str(ROOT / "pipeline"))
import answer_core as A  # noqa: E402

INS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"]


def J(p):
    return json.loads((DATA / p).read_text(encoding="utf-8"))


ANS = {}
for _t in ("capital", "targets", "comp", "regx", "val"):
    for _a in J(f"answers/{_t}.json")["rows"]:
        ANS[_a["id"]] = _a


def fv(qid, k):
    return ANS[qid]["figs"][k]["v"]


def cap(c):
    return next(x for x in J("capital/options.json")["companies"] if x["id"] == c)


class Shape(unittest.TestCase):
    def test_every_answer_of_the_range_follows_the_ladder(self):
        mine = [a for a in ANS.values() if 100 <= int(a["id"][2:]) <= 199]
        self.assertGreaterEqual(len(mine), 70)
        for a in mine:
            self.assertEqual(A.body_problems(a["id"], a), [], a["id"])
            bases = sorted({f["b"] for f in a["figs"].values()})
            if len(bases) > 1:
                self.assertEqual(a["mix"], bases, a["id"])
                self.assertIn("משלבים", a["email"], a["id"])        # the email says it mixes bases
            for f in a["figs"].values():
                self.assertTrue(f["prov"] and f["prov"].get("k"), a["id"])

    def test_no_pointer_left_unresolved(self):
        def walk(p):
            self.assertNotEqual(p.get("k"), "ref")
            for x in p.get("inputs", []) or []:
                if x.get("p"):
                    walk(x["p"])
        for a in ANS.values():
            for f in a["figs"].values():
                walk(f["prov"])


class Capital(unittest.TestCase):
    def test_q100_closest_to_board_target(self):
        rows = {r["c"]: r["sig"]["solv"]["segs"]["all"] for r in J("fragility.json")["rows"]
                if r["c"] in INS and (r["sig"].get("solv") or {}).get("segs", {}).get("all", {}).get("x")}
        c = min((c for c in rows if rows[c]["x"].get("h") is not None), key=lambda c: rows[c]["x"]["h"])
        h = rows[c]["x"]["h"]
        self.assertEqual(ANS["Q-100"]["figs"]["h1"]["c"], c)
        self.assertAlmostEqual(fv("Q-100", "h1"), h, places=6)
        band = "below" if h < 0 else "thin" if h < 10 else "ok"
        self.assertEqual(ANS["Q-100"]["vk"], f"min:{c}|{band}")

    def test_q101_below_target_branch(self):
        ks = [(c, k) for c in INS for x in [cap(c)] if x.get("status") == "ok" for k in x["constraints"]]
        c, k = min(ks, key=lambda t: t[1]["pp"])
        self.assertAlmostEqual(fv("Q-101", "gap"), k["pp"], places=5)
        below = sorted({c for c, k in ks if k["pp"] < 0})
        self.assertEqual(ANS["Q-101"]["vk"], "below:" + ",".join(below) if below else "none")

    def test_q102_total_distributable(self):
        xs = [cap(c)["distributable"]["v"] for c in INS if cap(c).get("status") == "ok"]
        self.assertAlmostEqual(fv("Q-102", "tot"), fsum(v for v in xs if v > 0), places=4)
        self.assertAlmostEqual(fv("Q-102", "top"), max(xs), places=4)

    def test_q108_years_of_dividend(self):
        c = ANS["Q-108"]["figs"]["lo"]["c"]
        x = cap(c)
        self.assertAlmostEqual(fv("Q-108", "lo"), x["distributable"]["v"] / x["dividend"]["ltm"]["v"], places=5)

    def test_q111_next_year_debt_over_profit(self):
        c = ANS["Q-111"]["figs"]["hi"]["c"]
        w = next(x for x in J("debt/index.json")["companies"] if x["id"] == c)["walls"][0]
        y1 = fsum(p["b"]["y1"][0] + p["b"]["y1"][1] for p in w["parts"]) / 1000
        self.assertAlmostEqual(fv("Q-111", "hi"), y1 / w["cov"]["profit_ltm"]["v"], places=5)

    def test_q121_equity_growth(self):
        c = ANS["Q-121"]["figs"]["hi"]["c"]
        e = J("csm/capital.json")["companies"][c]["equity_attributable"]
        self.assertAlmostEqual(fv("Q-121", "hi"), e["2026Q2"]["v"] / e["2025Q2"]["v"] * 100 - 100, places=5)

    def test_q124_morbidity_against_gross_csm(self):
        c = ANS["Q-124"]["figs"]["hi"]["c"]
        r = next(r for r in J("csm/sens.json")["rows"] if r["c"] == c and r["risk"] == "morbidity" and r["dir"] == 1 and r["eff"] == "csm" and r["b"] == "gross")
        seg = next(x for x in J("fragility.json")["rows"] if x["c"] == c)["sig"]["csm"]["segs"]["all"]
        bal = fsum(float(i["v"].replace(",", "")) for i in seg["prov"]["inputs"] if i["label"].startswith("CSM"))
        self.assertAlmostEqual(fv("Q-124", "hi"), -r["v"] / bal * 100, places=5)


class Targets(unittest.TestCase):
    def test_q131_targets_already_beaten(self):
        n = 0
        for r in J("targets.json")["rows"]:
            a = r.get("act")
            if r["st"] != "open" or r["t"] != "strategy" or not a or r["u"] not in ("pct", "m") or "IFRS 4" in (r.get("nt") or ""):
                continue
            g = r["lo"] if r.get("lo") is not None else r["v"] if r.get("v") is not None else r.get("hi")
            if g is not None and a["v"] >= g:
                n += 1
        self.assertEqual(fv("Q-131", "n"), n)
        self.assertEqual(ANS["Q-131"]["vk"], f"n:{n}")

    def test_q130_hit_rate(self):
        R = J("targets.json")["rows"]
        sc = [r for r in R if r["st"] in ("met", "partial", "missed")]
        self.assertAlmostEqual(fv("Q-130", "hit"), sum(r["st"] != "missed" for r in sc) / len(sc) * 100, places=5)

    def test_q141_profit_restated(self):
        d = J("restatements.json")
        f = ANS["Q-141"]["figs"]
        rows = [dict(zip(d["cols"], r)) for r in d["rows"]]
        r = next(r for r in rows if r["co"] == f["pc"]["c"] and r["st"] == "pl" and abs(r["v1"] / 1000 - f["v1"]["v"]) < 1e-6 and abs(r["v0"] / 1000 - f["v0"]["v"]) < 1e-6)
        self.assertAlmostEqual(f["pc"]["v"], (r["v1"] / r["v0"] - 1) * 100, places=5)


class Comp(unittest.TestCase):
    def test_q154_pairs_that_pay_and_fit(self):
        P = J("consolidation/matrix.json")["pairs"]
        good = [p for p in P if p["rank"] is not None and not p["nc"] and p["ok"] and p["npv"] > 0]
        self.assertEqual(fv("Q-154", "n"), len(good))

    def test_q150_top_roe(self):
        ids = [x["id"] for x in J("expectations/index.json")["companies"] if x["status"] == "ok"]
        roe = {c: J(f"expectations/{c}.json")["base"]["roe_ltm"]["v"] for c in ids}
        top = max(roe, key=roe.get)
        self.assertEqual(ANS["Q-150"]["figs"]["top"]["c"], top)
        self.assertAlmostEqual(fv("Q-150", "top"), roe[top], places=5)


class Reg(unittest.TestCase):
    def test_q166_most_exposed_in_shekels(self):
        E = J("regulation/impact.json")["exposure"]
        top = min(E, key=lambda x: x["net"]["central"])
        self.assertEqual(ANS["Q-166"]["vk"], f"top:{top['c']}")
        self.assertAlmostEqual(fv("Q-166", "top"), top["net"]["central"], places=4)

    def test_q169_investment_account_loser(self):
        i = next(x for x in J("regulation/impact.json")["initiatives"] if x["id"] == "investment-account-2026")
        lo = min(i["impacts"], key=lambda y: y["net"]["central"])
        self.assertAlmostEqual(fv("Q-169", "lo"), lo["net"]["central"], places=4)
        self.assertTrue(ANS["Q-169"]["vk"].startswith(f"lose:{lo['c']}"))


class Val(unittest.TestCase):
    def test_q182_required_roe_against_target(self):
        e = J("expectations/phoenix.json")
        t = e["targets"]["roe"]
        tv = t["lo"] if t.get("lo") is not None else t["v"]
        gap = e["roe"]["req"]["v"] - tv
        self.assertAlmostEqual(fv("Q-182", "gap"), gap, places=5)
        self.assertEqual(ANS["Q-182"]["vk"], "above-target" if gap > 0 else "covered")
        self.assertEqual(ANS["Q-182"]["mix"], ["actual", "estimate", "target"])

    def test_q184_pb_against_justified(self):
        c = ANS["Q-184"]["figs"]["hi"]["c"]
        b = J(f"expectations/{c}.json")["base"]
        j = (b["roe_ltm"]["v"] - b["g"]["v"]) / (b["ke"]["v"] - b["g"]["v"])
        self.assertAlmostEqual(fv("Q-184", "hi"), b["pb"]["v"] / j, places=5)

    def test_q189_csm_over_equity(self):
        c = ANS["Q-189"]["figs"]["hi"]["c"]
        b = J(f"expectations/{c}.json")["base"]
        self.assertAlmostEqual(fv("Q-189", "hi"), b["csm"]["csm"]["v"] / b["equity"]["v"] * 100, places=5)


if __name__ == "__main__":
    unittest.main()
