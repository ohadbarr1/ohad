"""Autopilot tests on recorded MAYA responses (no network).

/usr/bin/python3 -m unittest discover -s pipeline/autopilot/tests -v

Fixture maya_2026q2/: the live list responses of Phoenix (767) and Menora (566) for 05.06.26-31.08.26 and the files of the eight filings
the poller wants from them (Q2'26 reports with their XBRL instances, four presentations, two liabilities schedules), recorded by
`poll.py --record` on 23.10.26; report PDFs and htm forms over 64 KB are kept as stubs with the same magic bytes. kpi_before.json is
kpi.json for the two companies without Q2'26; lines_min.json one printed figure (Phoenix Q2'26 attributable profit, its page 75).
"""
import csv
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures"
sys.path.insert(0, str(HERE.parent))
import poll  # noqa: E402
import run  # noqa: E402
import t0  # noqa: E402
from common import Blocked, Paths, Replay  # noqa: E402

REAL = HERE.parent.parent.parent  # insurance-dashboard
COLS = poll.COLS


def make_root(tmp):
    """A copy of the layout the autopilot touches: companies, a registry that ends before Q2'26, kpi.json without Q2'26."""
    r = Path(tmp)
    (r / "data" / "registry").mkdir(parents=True)
    (r / "web" / "public" / "data").mkdir(parents=True)
    shutil.copy(REAL / "data" / "registry" / "companies.json", r / "data" / "registry" / "companies.json")
    with open(r / "data" / "registry" / "documents.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerow({"report_id": 1748533, "company": "phoenix", "publish_date": "2026-06-08 09:00:00.000", "doc_type": "presentation",
                    "period": "2026Q1", "title": "מצגת", "file_type": "pdf1", "size_kb": 1, "pages": "", "url": "rpdf/x/P1748533-00.pdf",
                    "local_path": "", "sha256": ""})
        w.writerow({"report_id": 1748500, "company": "menora", "publish_date": "2026-06-10 09:00:00.000", "doc_type": "quarterly",
                    "period": "2026Q1", "title": "דוח רבעון 1", "file_type": "pdf1", "size_kb": 1, "pages": "", "url": "rpdf/x/P1748500-00.pdf",
                    "local_path": "", "sha256": ""})
    shutil.copy(FIX / "kpi_before.json", r / "web" / "public" / "data" / "kpi.json")
    shutil.copy(FIX / "lines_min.json", r / "web" / "public" / "data" / "lines.json")
    return Paths(r)


def files(root):
    return sorted(str(p.relative_to(root)) for p in Path(root).rglob("*") if p.is_file())


class Poller(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fox-ap-")
        self.paths = make_root(self.tmp)
        self.quiet = lambda *a, **k: None

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def poll(self, apply):
        import datetime as dt
        return poll.poll(self.paths, Replay(FIX / "maya_2026q2"), only=["phoenix", "menora"], apply=apply, today=dt.date(2026, 8, 31), log=self.quiet)

    def test_dry_run_classifies_and_writes_nothing(self):
        before = files(self.tmp)
        res = self.poll(apply=False)
        self.assertEqual(files(self.tmp), before, "a dry run writes nothing")
        want = {(f["company"], f["rid"]): (f["type"], f["period"]) for f in res["filings"] if f["wanted"]}
        self.assertEqual(want[("phoenix", 1765739)], ("quarterly", "2026Q2"))
        self.assertEqual(want[("menora", 1765736)], ("quarterly", "2026Q2"))
        self.assertEqual(want[("phoenix", 1765735)], ("liabilities", "2026Q2"))
        self.assertEqual(want[("menora", 1765849)], ("presentation", "2026Q2"))
        self.assertEqual(len(want), 8)
        self.assertGreater(res["companies"]["phoenix"]["seen"], 50)  # every event family is listed; the rest are not wanted
        self.assertIsNone(res["blocked"])
        self.assertTrue(any(c["company"] == "infinity" for c in poll.poll(self.paths, Replay(FIX / "maya_2026q2"), apply=False, log=self.quiet)["skipped"]))

    def test_apply_fetches_into_the_source_layout_once(self):
        res = self.poll(apply=True)
        r = self.paths.root
        self.assertTrue((r / "data/sources/xbrl/phoenix_1765739.xbrl").exists())
        self.assertTrue((r / "data/sources/xbrl/menora_1765736.xbrl").exists())
        self.assertEqual((r / "data/sources/pdf/phoenix/2026Q2/1765739_quarterly.pdf").read_bytes()[:4], b"%PDF")
        self.assertTrue((r / "data/raw/maya_liabilities/htm/1765735.htm.gz").exists())
        self.assertTrue((r / "data/raw/maya_autopilot/2026-08-31/phoenix.json").exists())
        q = next(f for f in res["filings"] if f["rid"] == 1765739)
        self.assertEqual(q["period_from"], "xbrl")
        rows = poll.documents(self.paths)
        self.assertEqual(len(rows), 2 + 16)
        self.assertTrue(any(x["report_id"] == "1765739" and x["file_type"] == "xbrl" for x in rows))
        st = json.loads(self.paths.state.read_text(encoding="utf-8"))
        self.assertGreaterEqual(st["companies"]["phoenix"]["last_id"], 1765742)
        log = json.loads(self.paths.filings.read_text(encoding="utf-8"))
        self.assertEqual(len(log["filings"]), 8)
        again = self.poll(apply=True)
        self.assertEqual(sum(f["wanted"] for f in again["filings"]), 0, "the second poll finds nothing new")
        self.assertEqual(len(poll.documents(self.paths)), 18)

    def test_blocked_stops(self):
        class Refuse:
            def post_json(self, url, body):
                raise Blocked("403 from maya")

            def get_bytes(self, url):
                raise Blocked("403")
        res = poll.poll(self.paths, Refuse(), only=["phoenix", "menora"], apply=True, log=self.quiet)
        self.assertTrue(res["blocked"])
        self.assertFalse(self.paths.state.exists(), "a blocked poll writes no state")


class RunPlan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fox-ap-")
        self.paths = make_root(self.tmp)
        self.quiet = lambda *a, **k: None

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def go(self, apply, out=None):
        import datetime as dt
        return run.run(self.paths, Replay(FIX / "maya_2026q2"), apply=apply, only=["phoenix", "menora"], skip_gate=True, skip_build=True,
                       status_out=out, today=dt.date(2026, 8, 31), log=self.quiet)

    def test_dry_run_previews_without_touching_kpi(self):
        kpi_before = self.paths.kpi.read_bytes()
        out = Path(self.tmp) / "status-dry.json"
        st = self.go(apply=False, out=out)
        self.assertEqual(self.paths.kpi.read_bytes(), kpi_before)
        self.assertFalse(self.paths.status.exists())
        sk = next(s for s in st["steps"] if s["step"] == "skeleton")
        self.assertIn(["phoenix", "2026Q2", 1765739], sk["new"])
        self.assertFalse(sk["applied"])
        self.assertTrue(json.loads(out.read_text(encoding="utf-8"))["mode"] == "dry-run")

    def test_apply_lands_the_skeleton_and_verifies_against_the_printed_figure(self):
        st = self.go(apply=True)
        kpi = json.loads(self.paths.kpi.read_text(encoding="utf-8"))
        ph, me = kpi["companies"]["phoenix"], kpi["companies"]["menora"]
        i = ph["periods"].index("2026Q2")
        self.assertEqual(ph["values"]["profit"][i], 904143.0)  # NIS thousands, the tag (a quarter tagger)
        self.assertEqual(ph["status"][i], "verified")  # lines_min.json prints 904,143 on page 75 of the same report
        self.assertEqual(ph["t0"]["2026Q2"]["verified"]["pg"], 75)
        self.assertEqual(ph["values"]["liabilities"][i], 196486739.0)
        # 19 concepts; an insurer tags no operating profit (the form's line for fund houses), so 18 land
        self.assertEqual(sorted(k for k in ph["values"] if ph["values"][k][i] is None), ["op_profit"])
        j = me["periods"].index("2026Q2")
        # Menora tags year-to-date figures in Q2 (its last Q2s were differenced back): H1 1,253,380 less Q1 463,871
        self.assertEqual(me["t0"]["2026Q2"]["how"], "ytd")
        self.assertEqual(me["values"]["profit"][j], 1253380.0 - 463871.0)
        self.assertIsNone(me["values"]["eps"][j], "per-share figures are never differenced")
        self.assertEqual(me["status"][j], "unverified")
        self.assertIsNotNone(me["values"]["equity"][j])
        # older periods got the extra concepts from the registry? (no instances for them in this fixture: untouched)
        self.assertEqual(len(ph["periods"]), len(ph["values"]["liabilities"]))
        # status.json
        s = json.loads(self.paths.status.read_text(encoding="utf-8"))
        co = {c["id"]: c for c in s["companies"]}
        self.assertEqual(co["phoenix"]["latest"]["rid"], 1765739)
        self.assertTrue(co["phoenix"]["latest"]["new"])
        self.assertEqual([u["period"] for u in co["menora"]["unverified"] if u["t0"]], ["2026Q2"])
        d = {x["key"]: x for x in co["phoenix"]["deltas"]["items"]}
        self.assertEqual(d["profit"]["period"], "2026Q2")
        self.assertEqual(d["profit"]["prev_period"], "2025Q2")
        self.assertEqual(d["profit"]["src"][0]["rid"], 1765739)
        self.assertIn("הפניקס Q2'26", co["phoenix"]["deltas"]["push"]["title"])
        self.assertEqual(s["deploy"]["auto"], False)
        self.assertTrue(any(x["step"] == "extraction" and x["ran"] == 0 for x in s["steps"]))
        # idempotent: a second apply run adds nothing and keeps the verified period
        self.go(apply=True)
        kpi2 = json.loads(self.paths.kpi.read_text(encoding="utf-8"))
        self.assertEqual(kpi2["companies"]["phoenix"]["periods"].count("2026Q2"), 1)

    def test_never_overwrites_a_verified_period(self):
        kpi = json.loads(self.paths.kpi.read_text(encoding="utf-8"))
        reg = {"reports": {"1765739": {"c": "phoenix", "dt": "quarterly", "p": "2026Q1", "pub": "2026-05-30", "s": "2026-01-01", "e": "2026-03-31",
                                       "v": {"profit": 1.0, "equity": 1.0}, "m": {"profit": 3}}}}
        before = kpi["companies"]["phoenix"]["values"]["profit"][kpi["companies"]["phoenix"]["periods"].index("2026Q1")]
        t0.merge(kpi, reg, log=self.quiet)
        c = kpi["companies"]["phoenix"]
        self.assertEqual(c["values"]["profit"][c["periods"].index("2026Q1")], before)


if __name__ == "__main__":
    unittest.main()
