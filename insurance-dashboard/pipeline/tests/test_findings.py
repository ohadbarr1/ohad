"""Module S2, the Finding Engine (pipeline/build_findings.py): each detector on a small synthetic world, the order and top rules, and the
published file: every finding obeys the answer rules and every figure re-derives from the file its `src` names."""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import answer_core as A  # noqa: E402
import build_findings as B  # noqa: E402

COS = ["a", "b", "c", "d", "e", "f", "g"]
NAMES = {"a": "אלפא", "b": "בטא", "c": "גמא", "d": "דלתא", "e": "אפסילון", "f": "זטא", "g": "אטא"}
QS = [f"Q{k}-{y}" for y in (2023, 2024, 2025, 2026) for k in (1, 2, 3, 4)][:14]          # Q1-2023 .. Q2-2026
MONTHS = [y * 100 + m for y in range(2021, 2027) for m in range(1, 13) if y * 100 + m <= 202606]
MKT = [1.0, 1.03, 1.01, 1.06, 1.10, 1.08, 1.13, 1.18, 1.15, 1.22, 1.27, 1.25, 1.31, 1.36]   # a common market path, quarter by quarter
FAMS = {"pen": "pension", "gem": "gemel"}


def noise(*k):
    """a small deterministic wobble in [-2, 2]"""
    return ((sum(x * p for x, p in zip(k, (7, 3, 11, 5))) % 5) - 2)


def world():
    base = {c: 4000.0 * (len(COS) - i) for i, c in enumerate(COS)}    # well separated sizes: ranks never cross
    lens_rows = []
    for gi, c in enumerate(COS):
        for s in ("pen", "gem"):
            for qi, q in enumerate(QS):
                avg = base[c] * MKT[qi] * (1.0 if s == "pen" else 0.5)
                fy = 0.30 + 0.0001 * noise(gi, qi, 1)
                fees = avg * fy / 4 / 100
                rep = {"c": c, "fees": fees, "sm": fees * 0.4, "ga": fees * 0.3, "op": fees * (0.3 + 0.01 * noise(gi, qi, 3))}
                lens_rows.append({"g": gi, "s": s, "q": q, "reg": {"e": int(q[-4:]) * 100 + int(q[1]) * 3, "m": [avg] * 4, "avg": avg, "aE": avg, "aO": avg,
                                  "tr": 1.0, "org": 1.0}, "aum_share": None, "flow_share": 1.0, "rep": rep, "fy_reg": fees * 4 / avg * 100, "ci": 70.0})
    lens = {"meta": {"asof": 202606, "last_rep": "Q2-2026"}, "groups": [{"id": c, "name": NAMES[c]} for c in COS], "quarters": QS,
            "months": MONTHS, "rows": lens_rows, "series": {}, "marks": {}, "breaks": []}
    market = {"periods": MONTHS, "groups": [NAMES[c] for c in COS],
              "products": [{"key": "pension_new", "label": "פנסיה", "family": "pension"}, {"key": "gemel", "label": "גמל", "family": "gemel"}],
              "rows": []}
    for pi, mth in enumerate(MONTHS):
        for gi, c in enumerate(COS):
            for prod, s in ((0, "pen"), (1, "gem")):
                a = base[c] * (1.0 if s == "pen" else 0.5) * (1 + 0.005 * pi)
                tr = a * 0.002 * (1 + 0.1 * noise(pi, gi, prod))
                dep = a * 0.004 * (1 + 0.1 * noise(gi, pi, prod, 2))
                market["rows"].append([pi, prod, gi, a, dep, a * 0.001, tr, a, 0.2 * a, a, 0.0, a, 1])
    return {"lens.json": lens, "market.json": market, "companies/index.json": [{"id": c, "name_he": NAMES[c]} for c in COS],
            "restatements.json": {"insurers": []}, "csm/solvency.json": {"companies": {}},
            "targets.json": {"built": "2026-10-25", "docs": {"1": ["a", "presentation", "2022FY", "2022-03-29", "rpdf/x/P1-00.pdf"]}, "rows": []},
            "kpi.json": {"companies": {}}, "facts/index.json": {"companies": []}}


def shares(w):
    """aum_share = the group's average assets / the segment's total (the regulator's share)"""
    L = w["lens.json"]
    tot = {}
    for r in L["rows"]:
        tot[(r["s"], r["q"])] = tot.get((r["s"], r["q"]), 0.0) + r["reg"]["avg"]
    for r in L["rows"]:
        r["aum_share"] = r["reg"]["avg"] / tot[(r["s"], r["q"])] * 100
    return w


def install(w):
    A._cache.clear()
    A._cache.update(copy.deepcopy(w))
    B._REG = None
    B._LENS = None


def lrow(w, c, s, q):
    gi = COS.index(c)
    return next(r for r in w["lens.json"]["rows"] if r["g"] == gi and r["s"] == s and r["q"] == q)


def refee(r, fees):
    r["rep"].update({"fees": fees, "sm": fees * 0.4, "ga": fees * 0.3, "op": fees * 0.3})
    r["fy_reg"] = fees * 4 / r["reg"]["avg"] * 100


class Detectors(unittest.TestCase):
    def tearDown(self):
        A._cache.clear()
        B._REG = None
        B._LENS = None

    def assert_rules(self, rows):
        for r in rows:
            self.assertEqual(A.body_problems(r["id"], r), [], r["id"])
            for k, f in r["figs"].items():
                self.assertAlmostEqual(B.derive(f["src"]), f["v"], places=5)

    def test_quiet_world_has_no_findings(self):
        install(shares(world()))
        sk = []
        for fn in (B.det_div, B.det_brk, B.det_peer, B.det_rank):
            self.assertEqual([r["id"] for r in fn(sk)], [], fn.__name__)

    def test_div_assets_up_fees_flat(self):
        w = shares(world())
        r1, r0 = lrow(w, "a", "pen", "Q2-2026"), lrow(w, "a", "pen", "Q2-2025")
        refee(r1, r0["rep"]["fees"])            # fee income flat YoY while assets grew with the market
        install(w)
        rows = B.det_div([])
        ids = [r["id"] for r in rows]
        self.assertIn("F-div-a-pen-fees-vs-assets", ids)
        f = rows[ids.index("F-div-a-pen-fees-vs-assets")]
        self.assertTrue(f["vk"].startswith("fa:down:mix"))      # the declared fee did not move: mix, not price
        self.assertGreaterEqual(f["sur"]["v"], B.P("div_z"))
        self.assert_rules(rows)

    def test_div_perimeter_mismatch_is_suppressed(self):
        w = shares(world())
        r1, r0 = lrow(w, "a", "pen", "Q2-2026"), lrow(w, "a", "pen", "Q2-2025")
        refee(r1, r0["rep"]["fees"])
        r1["cover"] = 112.0
        install(w)
        sk = []
        self.assertNotIn("F-div-a-pen-fees-vs-assets", [r["id"] for r in B.det_div(sk)])
        self.assertIn("F-div-a-pen-fa", [s["id"] for s in sk])

    def test_brk_transfer_spike(self):
        w = shares(world())
        last = len(MONTHS) - 1
        for r in w["market.json"]["rows"]:
            if r[0] == last and r[2] == 0 and r[1] == 0:
                r[6] = r[3] * 0.05            # 5% of assets moved in one month
        install(w)
        rows = B.det_brk([])
        self.assertEqual([r["id"] for r in rows], ["F-brk-a-pen-transfers"])
        self.assertGreaterEqual(rows[0]["sur"]["v"], B.P("brk_z"))
        self.assert_rules(rows)

    def test_brk_market_wide_is_suppressed(self):
        w = shares(world())
        last = len(MONTHS) - 1
        for r in w["market.json"]["rows"]:
            if r[0] == last and r[1] == 0:
                r[6] = r[3] * 0.05            # every manager at once: a market event
        install(w)
        sk = []
        self.assertEqual(B.det_brk(sk), [])
        self.assertTrue(any(s["id"] == "F-brk-a-pen-tr" for s in sk))

    def test_peer_opposite_move_and_sole_loss(self):
        w = shares(world())
        for c in COS:
            r1, r0 = lrow(w, c, "pen", "Q2-2026"), lrow(w, c, "pen", "Q2-2025")
            refee(r1, r0["rep"]["fees"] * r1["reg"]["avg"] / r0["reg"]["avg"] * (0.95 if c == "a" else 1.05))
        r = lrow(w, "b", "gem", "Q2-2026")
        r["rep"]["op"] = -r["rep"]["fees"] * 0.6        # the only segment loss
        install(w)
        rows = B.det_peer([])
        ids = [r["id"] for r in rows]
        self.assertIn("F-peer-a-pen-fy", ids)
        self.assertIn("F-peer-b-gem-op-loss", ids)
        self.assert_rules(rows)

    def test_rank_shift(self):
        w = world()
        lrow(w, "g", "gem", "Q1-2025")["reg"]["avg"] *= 3.0     # one clear swap in the history (g over f, then back): the moves' spread
        lrow(w, "b", "gem", "Q2-2026")["reg"]["avg"] *= 0.3     # b falls from 2nd to 6th in provident share
        shares(w)
        install(w)
        rows = B.det_rank([])
        ids = [r["id"] for r in rows]
        self.assertIn("F-rank-b-gem-share", ids)
        f = rows[ids.index("F-rank-b-gem-share")]
        self.assertEqual(f["figs"]["rk1"]["v"], 6.0)
        self.assertEqual(f["figs"]["rk0"]["v"], 2.0)
        self.assert_rules(rows)

    def test_sd_target_overshoot(self):
        w = shares(world())
        w["kpi.json"]["companies"]["a"] = {"periods": [f"{y}FY" for y in range(2018, 2026)],
                                           "values": {"oci": [500e3, 600e3, 700e3, 800e3, 900e3, 1000e3, 1100e3, 3000e3],
                                                      "profit": [None] * 8, "equity": [None] * 8}}
        w["targets.json"]["rows"] = [{"c": "a", "m": "target_comprehensive_income", "l": "יעד רווח כולל", "e": "הקבוצה", "seg": "group", "t": "strategy",
                                      "u": "m", "h": 2025, "b": "na", "d": "2025-12-31", "v": None, "lo": 1000, "hi": 1200, "doc": 1, "pg": 5,
                                      "q": "רווח כולל 1.0-1.2 מיליארד", "n": 1, "hist": None, "src": "pres", "st0": ["2022-03-29", 1, 5],
                                      "st1": ["2022-03-29", 1, 5], "rev": 0, "st": "met",
                                      "act": {"k": "ci", "v": 3000, "y": 2025, "f": "כפי שהודפס בדוח הכספי",
                                              "in": [["רווח כולל לבעלי המניות", 3000, "https://example.invalid/r.pdf", 10, "FY'25", None]]}}]
        install(w)
        rows = B.det_sd([], "2026-10-25")
        self.assertEqual([r["id"] for r in rows], ["F-sd-a-comprehensive-income-group-2025"])
        f = rows[0]
        self.assertEqual(f["figs"]["gap"]["v"], 1800.0)
        self.assertEqual(f["figs"]["thi"]["b"], "target")
        self.assertEqual(f["mix"], ["actual", "target"])        # target and actual are never blended without a label
        self.assertEqual(f["open_m"], 55)
        self.assert_rules(rows)

    def test_sd_without_own_history_is_skipped(self):
        w = shares(world())
        w["targets.json"]["rows"] = [{"c": "a", "m": "target_core_profit", "l": "יעד רווח ליבה", "e": "הקבוצה", "seg": "group", "t": "strategy",
                                      "u": "m", "h": 2025, "b": "na", "v": 100, "lo": None, "hi": None, "doc": 1, "pg": 5, "q": "", "hist": None,
                                      "st0": None, "st1": None, "st": "met", "act": {"k": "core", "v": 300, "y": 2025, "f": "רווח ליבה, לפי הגדרת החברה", "in": []}}]
        install(w)
        sk = []
        self.assertEqual(B.det_sd(sk, "2026-10-25"), [])
        self.assertEqual(len(sk), 1)


def facts_world(stop=True, rename=False, table_gone=False, shared=0):
    """one company, a P&L with a total and two detail lines printed for 9 quarters; the latest report (Q2'26) drops one detail line"""
    ends = [f"{y}-{m}" for y in range(2024, 2027) for m in ("03-31", "06-30", "09-30", "12-31")][:10]   # Q1'24 .. Q2'26
    per = [["Q", e] for e in ends]
    seasons = [B.season(e) for e in ends]
    vint = {"rid": list(range(100, 110)), "per": seasons, "pub": [f"{e[:4]}-{int(e[5:7]) + 2:02d}-28" for e in ends], "u": list(range(10))}
    lines = [("pl.total", "סך הכנסות"), ("pl.det1", "מניהול קופות גמל"), ("pl.det2", "מניהול קרנות נאמנות")]
    if rename:
        lines.append(("pl.det1b", "מניהול גמל"))
    L = {k: [] for k in ("id", "mi", "sh", "ent", "std", "dim", "label", "u", "o", "n")}
    R = {k: [] for k in ("p", "t", "v", "pg", "f")}
    for li, (lid, lab) in enumerate(lines):
        n = 0
        for pi, e in enumerate(ends):
            last = pi == len(ends) - 1
            val = {"pl.total": 300.0, "pl.det1": 200.0, "pl.det2": 100.0, "pl.det1b": 200.0}[lid] * 1000 * (1 + 0.01 * pi)
            if lid == "pl.det1b" and not last:
                continue
            if lid == "pl.det1" and last and (stop or table_gone):
                continue
            if lid in ("pl.total", "pl.det2") and last and table_gone:
                continue
            for k, x in (("p", pi), ("t", pi), ("v", val), ("pg", 7), ("f", 16 | 32)):
                R[k].append(x)
            n += 1
            if lid == "pl.det1b" and last:   # the renamed line also prints last year's comparative in the latest report
                yago = ends.index(f"{int(e[:4]) - 1}{e[4:]}")
                v0 = 200.0 * 1000 * (1 + 0.01 * yago)
                for k, x in (("p", yago), ("t", pi), ("v", v0), ("pg", 7), ("f", 128)):
                    R[k].append(x)
                n += 1
        for k, x in (("id", lid), ("mi", li), ("sh", 0), ("ent", "F"), ("std", "4"), ("dim", ""), ("label", lab), ("u", "k"), ("o", 1), ("n", n)):
            L[k].append(x)
    F = {"periods": per, "vint": vint, "urls": [f"https://example.invalid/{i}.pdf" for i in range(10)], "sheets": ["X.רווח_והפסד"], "lines": L, "rows": R}
    w = shares(world())
    w["facts/index.json"] = {"companies": [{"id": "a"}] + [{"id": f"z{i}"} for i in range(shared)]}
    w["facts/a.json"] = F
    for i in range(shared):
        w[f"facts/z{i}.json"] = F
    return w


class Disclosure(unittest.TestCase):
    def tearDown(self):
        A._cache.clear()
        B._REG = None
        B._LENS = None

    def test_a_stopped_line_is_a_finding_with_its_run(self):
        install(facts_world())
        rows, base = B.det_disc([], "2026Q2")
        self.assertEqual(len(rows), 1)
        f = rows[0]
        self.assertTrue(f["id"].startswith("F-disc-a-pl-"))
        self.assertEqual(f["run"], 9)
        self.assertEqual(f["vk"], "dropped")
        self.assertAlmostEqual(f["figs"]["l0"]["v"], 200.0 * 1.08)        # the last printed quarter, NIS m
        self.assertEqual(A.body_problems(f["id"], f), [])

    def test_no_filing_no_finding(self):
        w = facts_world()
        v = w["facts/a.json"]["vint"]
        v["per"][-1] = "2026Q1x"         # the company has not filed Q2'26: a missing filing is not a disclosure change
        install(w)
        self.assertEqual(B.det_disc([], "2026Q2")[0], [])

    def test_rename_is_suppressed(self):
        install(facts_world(rename=True))
        sk = []
        self.assertEqual(B.det_disc(sk, "2026Q2")[0], [])
        self.assertTrue(any("שורה אחרת" in s["why"] for s in sk))

    def test_unread_table_is_suppressed(self):
        install(facts_world(table_gone=True))
        sk = []
        self.assertEqual(B.det_disc(sk, "2026Q2")[0], [])
        self.assertTrue(any(s["id"] == "disc:a:tables" for s in sk))

    def test_shared_stop_is_an_artefact(self):
        install(facts_world(shared=3))
        sk = []
        self.assertEqual(B.det_disc(sk, "2026Q2")[0], [])
        self.assertTrue(any("ארטיפקט" in s["why"] for s in sk))


class Order(unittest.TestCase):
    def test_order_and_top_rule(self):
        def r(id_, det, c, m, s):
            return {"id": id_, "det": det, "c": c, "mat": {"v": m}, "sur": {"v": s}}
        rows = [r("F-div-a-x", "div", "a", 10, 2), r("F-div-b-x", "div", "b", 30, 1), r("F-div-c-x", "div", "c", 5, 9),
                r("F-brk-a-x", "brk", "a", 100, 1), r("F-sd-d-x", "sd", "d", 1, 1), r("F-rank-e-x", "rank", "e", 1, 2)]
        B.order(rows)
        self.assertEqual([x["id"] for x in rows], ["F-brk-a-x", "F-div-c-x", "F-div-b-x", "F-div-a-x", "F-rank-e-x", "F-sd-d-x"])
        # top: at most 2 per detector, 1 per company, 5 in all
        self.assertEqual([x["id"] for x in rows if x["top"]], ["F-brk-a-x", "F-div-c-x", "F-div-b-x", "F-rank-e-x", "F-sd-d-x"])


class Published(unittest.TestCase):
    """the file on disk: every finding obeys the rules and every figure re-derives from the source file it cites"""

    @classmethod
    def setUpClass(cls):
        A._cache.clear()
        B._REG = None
        B._LENS = None
        p = A.DATA / "findings.json"
        cls.o = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def test_rules(self):
        if self.o is None:
            self.skipTest("findings.json not built")
        self.assertEqual(B.problems(self.o), [])

    def test_every_figure_rederives_from_its_source(self):
        if self.o is None:
            self.skipTest("findings.json not built")
        n = 0
        for r in self.o["rows"]:
            for k, f in r["figs"].items():
                v = B.derive(f["src"])
                self.assertIsNotNone(v, f"{r['id']}/{k}")
                self.assertAlmostEqual(round(v, 6), f["v"], places=5, msg=f"{r['id']}/{k}")
                self.assertIn(f["prov"]["k"], A.PROV_KINDS)
                n += 1
        self.assertGreater(n, 0)

    def test_the_contract(self):
        if self.o is None:
            self.skipTest("findings.json not built")
        self.assertTrue(set(self.o["dets"]) == set(B.DETS))
        for r in self.o["rows"]:
            self.assertRegex(r["id"], r"^F-(div|brk|peer|sd|disc|rank)-")
            self.assertEqual((r["mat"]["u"], r["sur"]["u"]), ("m", "sd"))
            self.assertIsInstance(r["top"], bool)
        self.assertLessEqual(sum(r["top"] for r in self.o["rows"]), B.P("top_n"))
        self.assertEqual(A.banned(self.o), [])


if __name__ == "__main__":
    unittest.main()
