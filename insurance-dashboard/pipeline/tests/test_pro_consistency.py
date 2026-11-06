"""The Pro-layer consistency check (pipeline/check_pro_consistency.py): passes on the published data, and fails on each defect the analyst
red team found on 06.11.26, re-created in a copy of the files (standard library only).

/usr/bin/python3 -m unittest pipeline.tests.test_pro_consistency -v
"""
import csv
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check_pro_consistency as C  # noqa: E402

DATA = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "data"
FILES = ["tables/v1/kpi.csv", "tables/v1/savings_q.csv", "tables/v1/solvency.csv", "csm/capital.json", "csm/solvency.json", "series", "lens.json",
         "nowcast.json", "expectations", "kpi.json", "lines.json", "capital"]


def kinds(bad):
    return {k for k, _ in bad}


class Published(unittest.TestCase):
    def test_passes(self):
        n, bad, exc, _ = C.run(DATA, quiet=True)
        self.assertGreater(n, 500)
        self.assertEqual(bad, [], bad[:5])


class OldDefects(unittest.TestCase):
    """each defect as the 05.11.26 build shipped it, on a copy of today's files"""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.D = Path(cls.tmp.name)
        for f in FILES:
            src, dst = DATA / f, cls.D / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            (shutil.copytree if src.is_dir() else shutil.copy)(src, dst)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def fresh(self):
        d = Path(tempfile.mkdtemp(dir=self.tmp.name))
        for f in FILES:
            src, dst = self.D / f, d / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            (shutil.copytree if src.is_dir() else shutil.copy)(src, dst)
        return d

    def edit_csv(self, path, fn, keep=lambda r: True):
        with open(path, encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        cols = list(rows[0])
        out = io.StringIO()
        w = csv.DictWriter(out, cols)
        w.writeheader()
        for r in rows:
            if keep(r):
                w.writerow(fn(r))
        path.write_text("﻿" + out.getvalue(), encoding="utf-8")

    def test_negative_dividend_and_its_q4(self):
        d = self.fresh()

        def neg(r):  # Phoenix FY'25 printed in parentheses, Q4 derived from it: −1,514.9 and −2,709.9
            if r["entity_id"] == "phoenix" and r["dim_id"] == "group|na" and r["metric_id"] == "dividend_declared":
                if r["period"] == "2025FY":
                    r["value"] = "-1514.931"
                if r["period"] == "2025Q4":
                    r["value"] = "-2709.863"
            return r
        self.edit_csv(d / "tables/v1/kpi.csv", neg)
        _, bad, _, _ = C.run(d, quiet=True)
        msgs = " ".join(m for k, m in bad if k == "dividends")
        self.assertIn("phoenix group|na dividend_declared 2025FY", msgs)
        self.assertIn("csm/capital.json", msgs)

    def test_pg_actual_missing_from_the_table(self):
        d = self.fresh()
        self.edit_csv(d / "tables/v1/savings_q.csv", lambda r: r, keep=lambda r: not r["dim_id"].startswith("managing_company|"))
        _, bad, _, _ = C.run(d, quiet=True)
        self.assertIn("pg", kinds(bad))

    def test_pg_same_label_two_numbers(self):
        d = self.fresh()

        def lab(r):
            if r["metric_id"] == "profit":
                r["metric_label"] = "רווח"
            return r
        self.edit_csv(d / "tables/v1/savings_q.csv", lab)
        _, bad, _, _ = C.run(d, quiet=True)
        self.assertTrue(any(k == "pg" and "profit" in m for k, m in bad))

    def test_roe_index_without_ltm(self):
        d = self.fresh()
        f = d / "expectations/index.json"
        idx = json.loads(f.read_text(encoding="utf-8"))
        for c in idx["companies"]:
            for p in c.get("parts", []):
                p.pop("ltm", None)
                p.pop("ltm_q", None)
        f.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
        _, bad, _, _ = C.run(d, quiet=True)
        self.assertIn("roe", kinds(bad))

    def test_roe_two_bases(self):
        d = self.fresh()  # attributable profit over total equity (Meitav 53.6% against 59.3% on /pro)
        f = d / "expectations/meitav.json"
        co = json.loads(f.read_text(encoding="utf-8"))
        co["base"]["roe_ltm"]["v"] = 53.578615
        f.write_text(json.dumps(co, ensure_ascii=False), encoding="utf-8")
        _, bad, _, _ = C.run(d, quiet=True)
        self.assertTrue(any(k == "roe" and m.startswith("meitav") for k, m in bad))

    def test_later_target_applied_to_earlier_figures(self):
        d = self.fresh()
        f = d / "capital/options.json"
        O = json.loads(f.read_text(encoding="utf-8"))
        ph = next(c for c in O["companies"] if c["id"] == "phoenix")
        k = next(k for k in ph["constraints"] if k["id"] == "board_wo")
        k["t"] = 125.0
        k.pop("later", None)
        ph["dividend"]["printed_over"]["d"] = "2025-06-30"
        f.write_text(json.dumps(O, ensure_ascii=False), encoding="utf-8")
        _, bad, _, _ = C.run(d, quiet=True)
        msgs = " ".join(m for k_, m in bad if k_ == "solvency")
        self.assertIn("phoenix board_wo: target 125%", msgs)
        self.assertIn("printed surplus over the target quoted is of 2025-06-30", msgs)


if __name__ == "__main__":
    unittest.main()
