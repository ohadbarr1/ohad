"""Shared plumbing for the autopilot: paths under one root (so tests run on a temporary copy), and the network transports.

Network rules (Phase 3): public MAYA endpoints only (the same ones pipeline/fetch_maya.py uses), a User-Agent that names fox, at most
two requests a second (default one a second), raw list responses cached under data/raw/maya_autopilot/ in --apply mode, and a 403 or
429 is never retried around: the transport raises Blocked and the poll stops and says so.
"""
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent
sys.path.insert(0, str(PIPE))
import fetch_maya as fm  # noqa: E402  (standard library only since duckdb is imported lazily there)

API, FILES = fm.API, fm.FILES


class Paths:
    """Every file the autopilot reads or writes, relative to the insurance-dashboard folder (or a test copy of its layout)."""

    def __init__(self, root=None):
        self.root = Path(root) if root else fm.ROOT
        r = self.root
        self.registry = r / "data" / "registry"
        self.companies = self.registry / "companies.json"
        self.documents = self.registry / "documents.csv"
        self.state = self.registry / "autopilot_state.json"
        self.filings = self.registry / "autopilot_filings.json"
        self.xbrl_facts = self.registry / "xbrl_facts.json"
        self.pdf = r / "data" / "sources" / "pdf"
        self.xbrl = r / "data" / "sources" / "xbrl"
        self.raw = r / "data" / "raw" / "maya_autopilot"
        self.data = r / "web" / "public" / "data"
        self.kpi = self.data / "kpi.json"
        self.status = self.data / "autopilot" / "status.json"
        self.config = HERE / "config.json"
        self.warehouse = r / "data" / "warehouse.duckdb"


class Blocked(RuntimeError):
    """The source refused automated access (403/429). Per the network rules: stop, report, do not evade."""


class Live:
    """urllib against MAYA, polite: FOX_UA, one request per `interval` seconds (never under 0.5 s), two retries on network errors only."""

    def __init__(self, interval=1.0, log=print):
        self.interval, self.last, self.log, self.calls = max(0.5, interval), 0.0, log, 0

    def _wait(self):
        gap = time.monotonic() - self.last
        if gap < self.interval:
            time.sleep(self.interval - gap)
        self.last = time.monotonic()

    def _open(self, req):
        for i in range(3):
            self._wait()
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code in (403, 429):
                    raise Blocked(f"{e.code} from {req.full_url[:80]}") from e
                if i == 2 or e.code < 500:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if i == 2:
                    raise
            time.sleep(5 * (i + 1))

    def post_json(self, url, body):
        headers = {**fm.HEADERS, "User-Agent": fm.FOX_UA}
        return json.loads(self._open(urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)))

    def get_bytes(self, url):
        return self._open(urllib.request.Request(url, headers={"User-Agent": fm.FOX_UA, "referer": "https://maya.tase.co.il/"}))


def _key_post(body):
    fam = ",".join(map(str, body.get("eventsFamilyIds") or [])) or "all"
    return f"reports/{body['companyId']}/{fam}/{body.get('offset', 0)}"


def _key_get(url):
    return "file/" + url.rsplit("/", 1)[-1]


class Replay:
    """Recorded responses, no network: a folder with index.json {key: file}. A request with no recording is an empty list (a list
    call) or a KeyError (a file). List keys ignore the dates, so a recording replays on any day."""

    def __init__(self, folder):
        self.dir = Path(folder)
        self.index = json.loads((self.dir / "index.json").read_text(encoding="utf-8"))
        self.calls = 0

    def post_json(self, url, body):
        self.calls += 1
        f = self.index.get(_key_post(body))
        return json.loads((self.dir / f).read_text(encoding="utf-8")) if f else []

    def get_bytes(self, url):
        self.calls += 1
        return (self.dir / self.index[_key_get(url)]).read_bytes()


class Recorder(Live):
    """Live, and every response written to a folder in the Replay layout (how the test fixtures were made)."""

    def __init__(self, folder, max_file_kb=64, **kw):
        super().__init__(**kw)
        self.dir = Path(folder)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.max = max_file_kb * 1024
        p = self.dir / "index.json"
        self.index = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    def _save(self, key, name, data):
        (self.dir / name).write_bytes(data)
        self.index[key] = name
        (self.dir / "index.json").write_text(json.dumps(self.index, indent=1, sort_keys=True), encoding="utf-8")

    def post_json(self, url, body):
        out = super().post_json(url, body)
        key = _key_post(body)
        self._save(key, key.replace("/", "_") + ".json", json.dumps(out, ensure_ascii=False, indent=1).encode())
        return out

    def get_bytes(self, url):
        raw = super().get_bytes(url)
        # big files (report PDFs) are not kept: a stub with the same magic stands in, so a replay exercises the same path
        data = raw if len(raw) <= self.max else raw[:8] + b"\n% fox fixture stub of " + str(len(raw)).encode() + b" bytes\n%%EOF\n"
        self._save(_key_get(url), "file_" + hashlib.sha1(url.encode()).hexdigest()[:12] + Path(url).suffix, data)
        return raw


def read_json(path, default=None):
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def write_json(path, obj, compact=True):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(obj, ensure_ascii=False, indent=1)
    p.write_text(txt + ("" if compact else "\n"), encoding="utf-8")
