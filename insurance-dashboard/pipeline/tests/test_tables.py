"""P4 fox inside Excel: the long tables, the change log and the Power Query kit (standard library only).

/usr/bin/python3 -m unittest pipeline.tests.test_tables -v
"""
import base64
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_tables as B  # noqa: E402
import pq_kit  # noqa: E402

DATA = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "data"


def R(co, metric, period, v, dim="group"):
    r = [co, co.upper(), dim, dim, metric, metric, period, B.plab(period), B.pend(period), float(v), "₪m", "printed", "", "maya:1", 3,
         "https://x/a.pdf#page=3", "doc", "2026-08-20", "", "v1"]
    return r


class Periods(unittest.TestCase):
    def test_labels_and_ends(self):
        self.assertEqual(B.plab("2026Q2"), "Q2'26")
        self.assertEqual(B.plab("2025FY"), "FY'25")
        self.assertEqual(B.plab("2026H1"), "H1'26")
        self.assertEqual(B.plab("LTM2026Q2"), "LTM Q2'26")
        self.assertEqual(B.plab("2026-09"), "09/26")
        self.assertEqual(B.pend("2026Q3"), "2026-09-30")
        self.assertEqual(B.pend("2025FY"), "2025-12-31")
        self.assertEqual(B.pend("2026H1"), "2026-06-30")
        self.assertEqual(B.pend("2024-02"), "2024-02-29")
        self.assertEqual(B.pend("2026-12"), "2026-12-31")
        ps = ["2025FY", "2025Q4", "2026Q1", "2025Q3", "2026H1", "2026Q2", "LTM2026Q2"]
        self.assertEqual(sorted(ps, key=B.psort), ["2025Q3", "2025Q4", "2025FY", "2026Q1", "2026Q2", "2026H1", "LTM2026Q2"])
        self.assertEqual(B.pnc_period("q126", "2026Q2"), "2026Q1")
        self.assertEqual(B.pnc_period("h125", "2026Q2"), "2025H1")
        self.assertEqual(B.pnc_period("fy25", "2026Q2"), "2025FY")
        self.assertEqual(B.pnc_period("ltm", "2026Q2"), "LTM2026Q2")


class Files(unittest.TestCase):
    def test_csv_bom_and_numbers(self):
        b = B.csv_bytes([R("harel", "profit", "2026Q2", 1068.0), R("harel", "eps", "2026Q2", 4.25)])
        self.assertTrue(b.startswith(b"\xef\xbb\xbf"), "BOM: Excel reads the Hebrew")
        lines = b.decode("utf-8-sig").split("\r\n")
        self.assertEqual(lines[0].split(","), B.COLS)
        self.assertIn(",1068,₪m,", lines[1])
        self.assertIn(",4.25,", lines[2])
        self.assertEqual(b, B.csv_bytes([R("harel", "profit", "2026Q2", 1068.0), R("harel", "eps", "2026Q2", 4.25)]), "deterministic")

    def test_diff_log(self):
        old = [R("harel", "profit", "2026Q1", 550), R("harel", "profit", "2025Q4", 900), R("migdal", "profit", "2026Q1", 1)]
        new = [R("harel", "profit", "2026Q1", 551), R("harel", "profit", "2025Q4", 900), R("harel", "profit", "2026Q2", 1068)]
        e = B.log_entry("kpi", old, new)
        self.assertEqual((e["added"], e["changed"], e["removed"]), (1, 1, 1))
        kinds = {r[0]: r for r in e["rows"]}
        self.assertEqual(kinds["changed"][9:11], [550.0, 551.0])
        self.assertEqual(kinds["added"][10], 1068.0)
        self.assertEqual(kinds["removed"][1], "migdal")
        self.assertIsNone(B.log_entry("kpi", new, [list(r) for r in new]), "no change, no entry")

    def test_render_log_only_on_change(self):
        with tempfile.TemporaryDirectory() as d:
            out0, B.OUT = B.OUT, Path(d)
            env0 = os.environ.get("FOX_TODAY")
            try:
                T = {t: [] for t, *_ in B.TABLES}
                T["kpi"] = [R("harel", "profit", "2026Q1", 550)]

                def write(files):
                    for rel, b in files.items():
                        (B.OUT / rel).parent.mkdir(parents=True, exist_ok=True)
                        (B.OUT / rel).write_bytes(b)

                os.environ["FOX_TODAY"] = "2026-11-05"
                f1 = B.render(T, None, None, first_build=True)
                write(f1)
                log = json.loads(f1["changes.json"])
                self.assertEqual([b["kind"] for b in log["builds"]], ["initial"])
                os.environ["FOX_TODAY"] = "2026-11-06"
                f2 = B.render(T, log, json.loads(f1["manifest.json"]), first_build=False)
                self.assertEqual(f2["changes.json"], f1["changes.json"], "same values: the log does not grow")
                self.assertEqual(f2["kpi.csv"], f1["kpi.csv"])
                T["kpi"] = [R("harel", "profit", "2026Q1", 551), R("harel", "profit", "2026Q2", 1068)]
                f3 = B.render(T, log, json.loads(f1["manifest.json"]), first_build=False)
                log3 = json.loads(f3["changes.json"])
                self.assertEqual(log3["builds"][0]["date"], "2026-11-06")
                self.assertEqual(log3["builds"][0]["tables"]["kpi"]["changed"], 1)
                self.assertEqual(log3["builds"][0]["tables"]["kpi"]["added"], 1)
                man = json.loads(f3["manifest.json"])
                k = next(x for x in man["tables"] if x["id"] == "kpi")
                self.assertEqual((k["rows"], k["changed"]), (2, "2026-11-06"))
                self.assertEqual(k["csv_sha256"], B.sha(f3["kpi.csv"]))
                self.assertIn(b"2026-11-06,kpi,changed,harel", f3["changes.csv"])
                for t in B.CSV_ONLY:  # the two large regulator tables: CSV only
                    self.assertIn(f"{t}.csv", f3)
                    self.assertNotIn(f"{t}.json", f3)
                    self.assertIsNone(next(x for x in man["tables"] if x["id"] == t)["json"])
                self.assertIn("kpi.json", f3)
            finally:
                B.OUT = out0
                if env0 is None:
                    os.environ.pop("FOX_TODAY", None)
                else:
                    os.environ["FOX_TODAY"] = env0


class Kit(unittest.TestCase):
    def test_m_script(self):
        m = pq_kit.m_script("kpi", "נתוני מפתח", "KPIs", B.BASE, B.COLS, ["value", "source_page", "period_end", "as_of"])
        self.assertIn('Web.Contents("https://fox-research-il.web.app/data/tables/v1/kpi.csv")', m)
        self.assertIn("Encoding = 65001", m)
        self.assertIn('{"value", type number}', m)
        self.assertTrue(m.rstrip().endswith("Typed"))

    def test_workbook_opens_and_holds_every_query(self):
        tabs = [{"id": t, "rows": 1, "first_label": "Q1'26", "last_label": "Q2'26", "changed": "2026-11-05"} for t, *_ in B.TABLES]
        b = pq_kit.workbook(B.BASE, B.TABLES, B.COLUMNS, B.CH_COLS, tabs, "2026-11-05")
        self.assertEqual(b, pq_kit.workbook(B.BASE, B.TABLES, B.COLUMNS, B.CH_COLS, tabs, "2026-11-05"), "deterministic")
        names = [t for t, *_ in B.TABLES] + ["changes"]
        self.assertEqual(pq_kit.verify(b, names), [])
        z = zipfile.ZipFile(io.BytesIO(b))
        dm = pq_kit.read_mashup(base64.b64decode(ET.fromstring(z.read("customXml/item1.xml").decode("utf-16")).text))
        self.assertEqual(dm["version"], 0)
        self.assertEqual(sorted(dm["names"]), ["Config/Package.xml", "Formulas/Section1.m", "[Content_Types].xml"])
        self.assertTrue(dm["section"].startswith("section Section1;"))
        for t in names:
            self.assertIn(f'{B.BASE}{t}.csv', dm["section"])
        conns = ET.fromstring(z.read("xl/connections.xml"))
        self.assertEqual(len(conns), len(names))
        self.assertIn("Microsoft.Mashup.OleDb.1", z.read("xl/connections.xml").decode())
        self.assertEqual(pq_kit.verify(b[:-40], names)[0][:15], "does not open: ")


@unittest.skipUnless((DATA / "kpi.json").exists() and (DATA / "funds.json").exists(), "needs the published data")
class RealData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.T = B.build_all()

    def test_csv_only_round_trip(self):
        """a CSV-only table read back from its CSV (the previous build) gives the same keys and values"""
        with tempfile.TemporaryDirectory() as d:
            out0, B.OUT = B.OUT, Path(d)
            try:
                rows = self.T["savings_m"][:500]
                (B.OUT / "savings_m.csv").write_bytes(B.csv_bytes(rows))
                back = B.read_prev("savings_m")["rows"]
                self.assertIsNone(B.log_entry("savings_m", back, rows))
            finally:
                B.OUT = out0

    def test_unique_and_sourced(self):
        self.assertEqual(B.problems(self.T), [])
        for t, *_ in B.TABLES:
            self.assertGreater(len(self.T[t]), 100, t)

    def test_kpi_equals_kpi_json(self):
        K = json.loads((DATA / "kpi.json").read_text(encoding="utf-8"))["companies"]["harel"]
        i = K["periods"].index("2025FY")
        rows = {(r[4], r[6]): r for r in self.T["kpi"] if r[0] == "harel" and r[2] == "xbrl"}
        self.assertAlmostEqual(rows[("profit", "2025FY")][9], K["values"]["profit"][i] / 1000, places=6)
        self.assertEqual(rows[("profit", "2025FY")][13], f"maya:{K['rid'][i]}")

    def test_no_share_prices(self):
        for t, rows in self.T.items():
            self.assertFalse(any(("price" in r[4] and "premium" not in r[4]) or r[4] in ("market_cap", "close") for r in rows), t)


if __name__ == "__main__":
    unittest.main()
