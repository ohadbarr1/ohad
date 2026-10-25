"""Weekly link check of every source URL the site cites (lane G; r2-ws5 gap 5). Standard library. Not run by deploy.sh or the DAG.

    python3 pipeline/check_links.py            check, write data/registry/links.json (pipeline/gate.py turns it into the `links` warning)
    python3 pipeline/check_links.py --dry-run  list what would be checked, request nothing

What is checked: every http(s) URL in the published data (web/public/data/**/*.json, the reader text excluded), de-duplicated.
  - company and regulator sites: every URL, a HEAD request (GET of one byte where HEAD is refused), 8 s timeout, redirects followed;
    dead = an error status, a timeout, or a redirect that lands on an error page (as fnx.co.il now does: error.fnx.co.il);
  - mayafiles.tase.co.il (MAYA's permanent file archive, behind a bot shield): a rotating sample of SAMPLE files per run, not all of them;
  - maya.tase.co.il/api/...: never requested (MAYA's robots.txt disallows /api/); listed as "not checked".
Polite: one request at a time per host, at least PAUSE seconds apart, an identifying User-Agent. A run takes a few minutes.

links.json: {"checked": ISO time, "n": urls checked, "dead": [{"url", "status", "final", "files"}], "refused": [{"url", "status", "files"}] (401/403/429:
a bot shield, not counted as dead), "skipped": {...}, "hosts": {host: n}}. One run is a snapshot: company sites answer intermittently.
"""
import datetime as dt
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = ROOT / "data" / "registry" / "links.json"
UA = "fox-research/1.0 (+https://fox-research-il.web.app/data; weekly source link check)"
URL = re.compile(r"https?://[^\s\"'<>\\]+")
SAMPLE = 25
PAUSE = 1.0
TIMEOUT = 8
ERRORISH = re.compile(r"(^|[./-])error([./-]|$)|/404|notfound|not-found", re.I)


def collect():
    refs = defaultdict(set)
    for p in DATA.rglob("*.json"):
        rel = p.relative_to(DATA).as_posix()
        if rel.startswith("search/"):
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        for u in URL.findall(text):
            refs[u.rstrip(".,;)")].add(rel.split("/")[0] if "/" in rel else rel)
    return refs


def iri(url):
    """A URL with Hebrew (or any non-ASCII) path or query, percent-encoded as a browser sends it."""
    p = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((p.scheme, p.netloc.encode("idna").decode(), urllib.parse.quote(p.path, safe="/%:@!$&'()*+,;=-._~"),
                                    urllib.parse.quote(p.query, safe="=&%:/?+,;@!$'()*-._~"), ""))


def probe(url):
    """(status, final url) of one URL: HEAD; where HEAD fails in any way (many servers refuse or mis-answer it), a one-byte GET."""
    out = None
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(iri(url), method=method, headers={"User-Agent": UA, **({"Range": "bytes=0-0"} if method == "GET" else {})})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                out = (r.status, r.geturl())
                doc = re.search(r"\.(pdf|xlsx?|csv|zip)$", urllib.parse.urlsplit(url).path, re.I)
                moved = urllib.parse.urlsplit(r.geturl()).hostname != urllib.parse.urlsplit(iri(url)).hostname
                if method == "HEAD" and (moved or (doc and "html" in (r.headers.get("Content-Type") or ""))):
                    time.sleep(PAUSE)  # a cross-host redirect or a page instead of a file: some servers answer HEAD differently, confirm by GET
                    continue
        except urllib.error.HTTPError as e:
            out = (e.code, e.geturl() if hasattr(e, "geturl") else url)
        except Exception as e:  # noqa: BLE001  timeout, DNS, TLS: the link does not answer
            out = (f"error: {type(e).__name__}", None)
        if isinstance(out[0], int) and out[0] < 400:
            return out
        if method == "HEAD":
            time.sleep(PAUSE)
    return out


def main():
    dry = "--dry-run" in sys.argv
    refs = collect()
    host = lambda u: re.sub(r"^https?://([^/:]+).*$", r"\1", u).lower()
    todo, skipped = [], defaultdict(int)
    maya_files = sorted(u for u in refs if host(u) == "mayafiles.tase.co.il")
    week = dt.date.today().isocalendar()[1]
    sample = set(maya_files[(week * SAMPLE) % max(1, len(maya_files)):][:SAMPLE]) if maya_files else set()
    for u in sorted(refs):
        h = host(u)
        if h == "maya.tase.co.il" and "/api/" in u:
            skipped["maya api (robots.txt)"] += 1
        elif h == "mayafiles.tase.co.il" and u not in sample:
            skipped["mayafiles (sampled)"] += 1
        else:
            todo.append(u)
    by_host = defaultdict(list)
    for u in todo:
        by_host[host(u)].append(u)
    print(f"{len(refs)} distinct URLs; checking {len(todo)} on {len(by_host)} hosts; skipped {dict(skipped)}")
    if dry:
        for h, us in sorted(by_host.items()):
            print(f"  {h}: {len(us)}")
        return 0
    dead, refused, last = [], [], {}
    # round-robin over hosts, one request per host at a time, PAUSE apart
    queues = {h: list(us) for h, us in by_host.items()}
    while queues:
        for h in list(queues):
            wait = PAUSE - (time.time() - last.get(h, 0))
            if wait > 0 and len(queues) == 1:
                time.sleep(wait)
            elif wait > 0:
                continue
            u = queues[h].pop(0)
            last[h] = time.time()
            st, final = probe(u)
            if st in (401, 403, 429):  # a bot shield refusing an automated request: not evidence that the link is dead
                refused.append({"url": u, "status": st, "files": sorted(refs[u])})
            elif not isinstance(st, int) or st >= 400 or (final and host(final) != h and ERRORISH.search(final)):
                dead.append({"url": u, "status": st, "final": final, "files": sorted(refs[u])})
            if not queues[h]:
                del queues[h]
        time.sleep(0.05)
    out = {"checked": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "n": len(todo), "dead": dead, "refused": refused, "skipped": dict(skipped),
           "hosts": {h: len(us) for h, us in sorted(by_host.items())}, "ua": UA}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(todo)} checked, {len(dead)} dead, {len(refused)} refused by a bot shield -> {OUT.relative_to(ROOT)}")
    for d in dead[:20]:
        print(f"  DEAD {d['status']} {d['url']} -> {d['final']} ({', '.join(d['files'])})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
