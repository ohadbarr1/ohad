"""Wave 11 under (pipeline/build_under.py): the 5Y net, the category median and percentile, the tie band, the cost of the gap, the 12M
flow with the intra-group migration taken out, and the headline rule, on a synthetic set of published files; and the rules, the parity
with the track card and the group identity on the published files. Standard library only."""
import json
import math
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPE))
import build_under as BU  # noqa: E402
import build_flows as BF  # noqa: E402
import funds_lib as FL  # noqa: E402

ASOF = 201601
P = [FL.madd(ASOF, -i) for i in range(59, -1, -1)]  # 201102..201601: one 5Y window
GM = "גמל | כללי"
GE = "גמל | מניות"


def hist(yn, a=1000.0, dep=10.0, wd=2.0, tr=0.0, ct=GM):
    n = len(P)
    return {"p": P, "y": [yn] * n, "yn": [yn] * n, "a": [a] * n, "fee": [0.5] * n, "dep": [dep] * n, "wd": [wd] * n, "tr": [tr] * n,
            "nd": [round(dep - wd + tr, 1)] * n, "ct": [[P[0], ct]]}


def row(k, grp, name=None, track="כללי"):
    return {"k": k, "grp": grp, "mgr": grp, "prod": "גמל", "track": track, "name": name or k, "assets": 1000.0}


class Fixture(unittest.TestCase):
    """one category of six ranked tracks (+ an IRA track, not ranked). g1 (worst) gets +30 a month in transfers while its sister g1b
    (another category of group A) sends −40: at most 30 of g1's transfers are internal, so its external flow is org only (+8 a month).
    g2 (second worst) gets +20 from its sister g2b and deposits nothing net: published +20 a month, all of it migration"""

    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp())
        d = cls.dir
        (d / "funds").mkdir()
        live = [row("g1", "A"), row("g1b", "A", track="מניות"), row("g2", "B"), row("g2b", "B", track="מניות"), row("g3", "C"),
                row("g4", "D"), row("g5", "E"), row("g6", "F"), row("g7", "G", name="מסלול בניהול אישי IRA")]
        H = {"g1": hist(0.30, tr=30.0), "g1b": hist(0.9, tr=-40.0, ct=GE), "g2": hist(0.35, dep=5.0, wd=5.0, tr=20.0),
             "g2b": hist(0.9, dep=5.0, wd=5.0, tr=-20.0, ct=GE), "g3": hist(0.50), "g4": hist(0.55), "g5": hist(0.60), "g6": hist(0.65),
             "g7": hist(0.10)}
        for f in live:  # the card's 5Y net (funds.json net.a5): the latest month ranks on it
            f["net"] = {"a5": round(((1 + H[f["k"]]["yn"][0] / 100) ** 12 - 1) * 100, 2)}
        (d / "funds.json").write_text(json.dumps({"asof": ASOF, "funds": live}, ensure_ascii=False), encoding="utf-8")
        (d / "funds" / "closed.json").write_text(json.dumps({"funds": []}), encoding="utf-8")
        for k, h in H.items():
            (d / "funds" / f"{k}.json").write_text(json.dumps(h, ensure_ascii=False), encoding="utf-8")
        cls.files = BU.build(d)
        U = cls.files["under.json"]
        cls.U = U
        cls.rows = {r[0]: dict(zip(U["cols"], r)) for r in U["rows"]}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_5y_net_and_median(self):
        r = self.rows["g1"]
        self.assertAlmostEqual(r["r5"], round((1.003 ** 12 - 1) * 100, 2))
        self.assertNotIn("g7", self.rows)       # IRA: not ranked
        self.assertNotIn("g1b", self.rows)      # its category has one track: not ranked
        r5 = sorted(self.rows[k]["r5"] for k in ("g1", "g2", "g3", "g4", "g5", "g6"))
        self.assertAlmostEqual(r["med"], round((r5[2] + r5[3]) / 2, 3))
        self.assertEqual(r["n"], 6)

    def test_percentile_and_gap(self):
        self.assertEqual(self.rows["g1"]["pct"], 0)
        self.assertEqual(self.rows["g2"]["pct"], 20)
        self.assertEqual(self.rows["g3"]["pct"], 40)
        for k in ("g4", "g5", "g6"):
            self.assertEqual(self.rows[k]["gap"], 0.0)     # above the median
        g1 = self.rows["g1"]
        self.assertAlmostEqual(g1["gap"], round(g1["med"] - g1["r5"], 3))
        self.assertAlmostEqual(g1["cost"], round(g1["a"] * g1["gap"] / 100, 1))

    def test_tie_band(self):
        self.assertEqual(BU.gap_of(7.0, 6.91), 0.0)      # 9bp: inside the band
        self.assertEqual(BU.gap_of(7.0, 6.90), 0.1)      # 10bp: outside
        self.assertEqual(BU.gap_of(7.0, 7.5), 0.0)       # above the median

    def test_flow_without_migration(self):
        g1, g2 = self.rows["g1"], self.rows["g2"]
        self.assertEqual(g1["nd12"], 12 * 38.0)
        self.assertEqual(g1["org12"], 12 * 8.0)
        self.assertEqual(g1["ext12"], 0.0)                # all 30 of the transfers could be the sister's 40
        self.assertEqual(g1["c12"], 96.0)
        self.assertEqual(g2["nd12"], 240.0)
        self.assertEqual(g2["c12"], 0.0)                  # published +240, all of it migration

    def test_headline_rule(self):
        self.assertEqual(self.rows["g1"]["head"], 1)
        self.assertEqual(self.rows["g2"]["head"], 0)      # bottom quartile, published inflow, but none without migration
        self.assertEqual(self.rows["g3"]["head"], 0)      # not bottom quartile
        g1 = self.rows["g1"]
        self.assertAlmostEqual(g1["icost"], round(96.0 * g1["gap"] / 100, 1))
        S = self.U["series"]
        self.assertEqual(S["n"], [1])
        self.assertAlmostEqual(S["cost"][0], g1["cost"])
        self.assertEqual(S["n_bq"], [2])
        self.assertEqual(BU.rules(self.files, self.dir), [])
        m = self.files[f"under/m/{ASOF}.json"]
        self.assertEqual([r[0] for r in m["rows"]], ["g1"])

    def test_group_identity(self):
        """the group's tracks' external flows add up to its net transfers (the cancellation only moves money inside the group)"""
        rows = {r["k"]: r for r in json.loads((self.dir / "funds.json").read_text(encoding="utf-8"))["funds"]}
        T = {k: BU.Track(k, rows[k], json.loads((self.dir / "funds" / f"{k}.json").read_text(encoding="utf-8"))) for k in rows}
        units = BU.flow_units(T)
        for grp in ("A", "B"):
            ks = [k for k in T if rows[k]["grp"] == grp]
            c12 = math.fsum(BU.track_flow(T[k], ASOF, "gm", units)[3] for k in ks)
            nd12 = math.fsum(BU.track_flow(T[k], ASOF, "gm", units)[0] for k in ks)
            self.assertAlmostEqual(c12, nd12, places=6)


DATA = PIPE.parent / "web" / "public" / "data"


@unittest.skipUnless((DATA / "under.json").exists() and (DATA / "flows.json").exists(), "published files missing")
class Published(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = BU.build()

    def test_rebuild_equal(self):
        for p, doc in self.files.items():
            self.assertEqual((DATA / p).read_bytes(), BU.dumps(doc).encode("utf-8"), p)

    def test_rules_and_parity(self):
        self.assertEqual(BU.rules(self.files), [])
        self.assertEqual(BU.parity(self.files), [])

    def test_group_identity_against_flows(self):
        """month by month, Σ over a group's tracks of (deposits − withdrawals + external transfers) = the group's net in flows/<pid>.json:
        the cancellation only moves money inside the group (pension and study funds, the last 12 months)"""
        F, rows, H, G = BU.load()
        asof = F["asof"]
        T = {k: BU.Track(k, rows[k], H[k]) for k in H}
        units = BU.flow_units(T)
        n = 0
        for pid in ("pm", "hs"):
            doc = G[pid]
            for q in [FL.madd(asof, -i) for i in range(12)]:
                jx = doc["months"].index(q)
                acc = {}
                for k, t in T.items():
                    i = t.ix.get(q)
                    c = t.cat(q)
                    if i is None or not c or BF.PROD_OF.get(c.split(" | ")[0]) != pid:
                        continue
                    dep, wd, tr = t.g("dep", i), t.g("wd", i), t.g("tr", i)
                    if None in (dep, wd, tr):
                        continue
                    Pp, Nn = units[(pid, BU.unit_of(t.row), q)]
                    M = min(Pp, Nn)
                    e = tr * (1 - M / Pp) if tr > 0 else tr * (1 - M / Nn) if tr < 0 else 0.0
                    a = acc.setdefault(t.row["grp"], [0.0, 0])
                    a[0] += dep - wd + e
                    a[1] += 1
                for grp, (x, cnt) in acc.items():
                    net = doc["groups"][grp]["net"][jx]
                    self.assertAlmostEqual(x, net, delta=0.5 + 0.05 * cnt, msg=f"{pid} {grp} {q}")
                    n += 1
        self.assertGreater(n, 100)

    def test_series_since_2016(self):
        U = self.files["under.json"]
        self.assertEqual(U["months"][0], 201601)
        self.assertEqual(len(U["months"]), len(U["series"]["cost"]))
        self.assertTrue(all(x >= 0 for x in U["series"]["cost"]))


if __name__ == "__main__":
    unittest.main()
