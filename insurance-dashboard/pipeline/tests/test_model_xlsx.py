"""Wave 5: the XLSX writer, the model workbooks, the consensus registry and the API doc (standard library only).

cd pipeline && /usr/bin/python3 -m unittest tests.test_model_xlsx -v
"""
import io
import sys
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_api_doc  # noqa: E402
import build_consensus  # noqa: E402
import build_model_xlsx as M  # noqa: E402
from xlsx_lib import Book, Cell, read_book  # noqa: E402


class XlsxLib(unittest.TestCase):
    def test_round_trip(self):
        b = Book("t")
        sh = b.sheet("P&L", widths=[10, 10], freeze=(1, 1))
        sh.row([Cell("Key", "head"), Cell("Q1'25", "head")])
        sh.row([Cell("a <&> \"b\""), Cell(1234.5, "m")])
        sh.row([Cell("f"), Cell(2469.0, "m_i", f="B2*2")])
        src = b.sheet("Sources")
        src.row([Cell("B2", "link", loc="'P&L'!B2"), Cell("pdf", "link", link="https://example.com/a.pdf#page=3"), Cell("again", "link", link="https://example.com/a.pdf#page=3")])
        data = b.bytes()
        self.assertEqual(data, b.bytes(), "deterministic")
        z = zipfile.ZipFile(io.BytesIO(data))
        for n in z.namelist():
            ET.fromstring(z.read(n))
        wb = read_book(data)
        names = [s[0] for s in wb["sheets"]]
        self.assertEqual(names, ["P&L", "Sources"])
        cells = wb["sheets"][0][1]
        self.assertEqual(cells["A2"][1], 'a <&> "b"')
        self.assertEqual(cells["B2"], ("n", 1234.5, None, cells["B2"][3]))
        self.assertEqual(cells["B3"][0], "f")
        self.assertEqual(cells["B3"][2], "B2*2")
        links = wb["sheets"][1][2]
        self.assertEqual(links["A1"], ("loc", "'P&L'!B2"))
        self.assertEqual(links["B1"][1], "https://example.com/a.pdf#page=3")
        rels = z.read("xl/worksheets/_rels/sheet2.xml.rels").decode()
        self.assertEqual(rels.count("<Relationship "), 1, "one relationship per URL")


class Periods(unittest.TestCase):
    def test_columns(self):
        self.assertEqual(M.PERIODS[0], "2023Q1")
        self.assertEqual(M.PERIODS[-1], "2026Q2")
        self.assertEqual(M.PERIODS[M.PERIODS.index("2024Q4") + 1], "2024FY")
        self.assertEqual(len(M.PERIODS), 17)
        self.assertEqual(M.qkey("2025-06-30"), "2025Q2")
        self.assertIsNone(M.qkey("2025-06-29"))
        self.assertEqual(M.plabel("2025FY"), "FY'25")


class Workbooks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ctx = M.Ctx()

    def _check(self, co):
        data, n = M.build(self.ctx, co)
        self.assertLess(len(data), M.MAX_BYTES)
        wb = read_book(data)
        names = [s[0] for s in wb["sheets"]]
        for s in M.SHEETS:
            self.assertIn(s, names)
        sheets = {s[0]: s for s in wb["sheets"]}
        covered = {v[1] for v in sheets["Sources"][2].values() if v[0] == "loc"}
        vals = 0
        for s in M.SHEETS[:-1]:
            for ref_, c in sheets[s][1].items():
                r, col = M.split_ref(ref_)
                if r >= 3 and col >= 5 and c[0] != "s":
                    vals += 1
                    self.assertIn(f"{M.qsheet(s)}!{ref_}", covered, f"{co} {s}!{ref_} unsourced")
        self.assertEqual(vals, n)
        return sheets

    def test_insurer(self):
        sheets = self._check("harel")
        self.assertGreater(len(sheets["IFRS 17"][1]), 100)
        kp = sheets["KPIs"][1]
        roe = [r for r, c in kp.items() if c[1] == "roe_calc"]
        self.assertTrue(roe, "ROE row")
        row = M.split_ref(roe[0])[0]
        self.assertTrue(any(c[0] == "f" and M.split_ref(r)[0] == row for r, c in kp.items()), "ROE is a live formula")

    def test_fund_house(self):
        sheets = self._check("altshuler")
        self.assertGreater(sum(1 for c in sheets["Savings"][1].values() if c[0] == "n"), 50)


class Consensus(unittest.TestCase):
    def test_registry_rules(self):
        probs, n = build_consensus.problems()
        self.assertEqual(probs, [])
        self.assertGreater(n, 0)

    def test_public_file_has_no_excerpts(self):
        self.assertNotIn('"check"', build_consensus.build())


class ApiDoc(unittest.TestCase):
    def test_every_family_documented(self):
        fams = build_api_doc.families()
        pats = {f["pattern"] for f in fams}
        for p in ("kpi.json", "facts/*.json", "consensus.json", "xlsx/*.xlsx", "targets.json"):
            self.assertIn(p, pats)
        doc = Path(build_api_doc.OUT_MD).read_text(encoding="utf-8")
        for p in pats:
            self.assertIn(f"`{p}`", doc, f"docs/API.md misses {p}: run pipeline/build_api_doc.py")


if __name__ == "__main__":
    unittest.main()
