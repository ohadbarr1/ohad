"""fetch_regulator.py --incremental (the cache fox-data.yml restores with actions/cache): no network, a fake CKAN.
A resource whose last_modified is unchanged is read from the cache; the parquet is byte-for-byte the one a full fetch writes."""
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
HAVE = all(importlib.util.find_spec(m) for m in ("pandas", "pyarrow"))

PKG = {
    "gemelnet": [{"id": "g-old", "name": "1999-2022", "format": "CSV", "datastore_active": True, "last_modified": "2024-07-10T10:50:01"},
                 {"id": "g-now", "name": "2024-היום", "format": "CSV", "datastore_active": True, "last_modified": "2026-11-01T05:00:17"},
                 {"id": "g-xlsx", "name": "פורמט", "format": "XLSX", "datastore_active": True, "last_modified": "2018-08-08T09:34:28"}],
    "pensia-net": [{"id": "p-now", "name": "2024-היום", "format": "CSV", "datastore_active": True, "last_modified": "2026-11-01T05:00:33"}],
    "insurance": [{"id": "i-now", "name": "2024-היום", "format": "CSV", "datastore_active": True, "last_modified": "2026-11-01T05:00:37"}],
}
RECS = {
    "g-old": [{"_id": 1, "FUND_ID": 101, "REPORT_PERIOD": 202212, "MONTHLY_YIELD": "0.5", "FUND_NAME": "א"},
              {"_id": 2, "FUND_ID": 102, "REPORT_PERIOD": 202212, "MONTHLY_YIELD": None, "FUND_NAME": "ב"}],
    "g-now": [{"_id": 1, "FUND_ID": 101, "REPORT_PERIOD": 202609, "MONTHLY_YIELD": "1.25", "FUND_NAME": "א"}],
    "p-now": [{"_id": 1, "FUND_ID": 201, "REPORT_PERIOD": 202609, "MONTHLY_YIELD": "-0.1", "FUND_NAME": "ג"}],
    "i-now": [{"_id": 1, "FUND_ID": 301, "REPORT_PERIOD": 202609, "MONTHLY_YIELD": "0.0", "FUND_NAME": "ד"}],
}


@unittest.skipUnless(HAVE, "pandas + pyarrow (pipeline/requirements.txt) not installed")
class Incremental(unittest.TestCase):
    def setUp(self):
        import fetch_regulator as fr
        self.fr = fr
        self.tmp = Path(tempfile.mkdtemp(prefix="fox-fr-"))
        self.calls = []

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get(self, url, retries=4):
        self.calls.append(url)
        if "package_show" in url:
            return {"result": {"resources": PKG[url.split("id=")[1]]}}
        rid = url.split("resource_id=")[1].split("&")[0]
        return {"result": {"records": json.loads(json.dumps(RECS[rid])), "total": len(RECS[rid])}}

    def fetch(self, raw, *argv, env=None):
        with mock.patch.object(self.fr, "RAW", raw), mock.patch.object(self.fr, "get", self.get), \
                mock.patch.object(self.fr, "CACHE", env):
            self.fr.main(list(argv))
        return [u for u in self.calls if "datastore_search" in u]

    def test_cache_reuses_unchanged_resources_and_the_parquet_is_identical(self):
        full = self.fetch(self.tmp / "full")
        self.assertEqual(len(full), 4)
        self.calls.clear()
        first = self.fetch(self.tmp / "inc", "--incremental")
        self.assertEqual(len(first), 4, "an empty cache downloads everything")
        self.assertTrue((self.tmp / "inc" / "_cache" / "g-old.json.gz").exists())
        self.calls.clear()
        second = self.fetch(self.tmp / "inc", "--incremental")
        self.assertEqual(second, [], "nothing changed upstream: every resource from the cache")
        for k in ("gemel", "pensia", "insurance"):
            self.assertEqual((self.tmp / "full" / f"{k}.parquet").read_bytes(), (self.tmp / "inc" / f"{k}.parquet").read_bytes(), k)
        # the current resource is re-stamped: only it is downloaded again
        PKG["gemelnet"][1]["last_modified"] = "2026-11-02T05:00:17"
        try:
            self.calls.clear()
            third = self.fetch(self.tmp / "inc", env=str(self.tmp / "inc" / "_cache"))  # FOX_REGRAW_CACHE, as the DAG passes it
            self.assertEqual(len(third), 1)
            self.assertIn("g-now", third[0])
        finally:
            PKG["gemelnet"][1]["last_modified"] = "2026-11-01T05:00:17"
        meta = json.loads((self.tmp / "inc" / "_meta.json").read_text(encoding="utf-8"))
        self.assertEqual([r["id"] for r in meta["resources"]["gemel"]], ["g-old", "g-now"])


if __name__ == "__main__":
    unittest.main()
