"""The live site, as .github/workflows/fox-data.yml's deploy job sees it. Standard library only; read-only HTTP GETs to the site itself.

python3 pipeline/autopilot/live.py prev   --channels channels.json      # the version the live channel serves (the rollback point)
python3 pipeline/autopilot/live.py verify --month 202610 [--tries 12]   # live data = this checkout's data, and its as-of = the month

`prev` reads `firebase hosting:channel:list --json` output and prints the live channel's version id (sites/<site>/versions/<id> -> <id>);
exit 1 when it cannot be found (the workflow then refuses to deploy: no rollback point, no deploy).
`verify` fetches /data/lens.json (meta.asof), /data/funds.json (asof) and /data/market_home.json (meta.asof) from the live site with a
cache-busting query and checks each equals --month; then /data/qa.json's `built` must equal this checkout's web/public/data/qa.json (the
deployed files are this commit's, not an older copy). Retries while the CDN turns over; exit 1 when it never matches.
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

SITE = "https://fox-research-il.web.app"
DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
UA = "fox-research-il-deploy-check/1.0 (+https://fox-research-il.web.app)"
CHECKS = [("lens.json", ("meta", "asof")), ("funds.json", ("asof",)), ("market_home.json", ("meta", "asof"))]


def live_version(channels):
    """The version id of the live channel in `firebase hosting:channel:list --json` output (any nesting), or None."""
    found = []

    def walk(x):
        if isinstance(x, dict):
            name = str(x.get("name") or "")
            if name.endswith("/channels/live"):
                v = ((x.get("release") or {}).get("version") or {}).get("name") or ""
                if v:
                    found.append(v.rsplit("/", 1)[-1])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(channels)
    return found[0] if found else None


def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"}), timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _dig(d, path):
    for k in path:
        d = (d or {}).get(k)
    return d


def check(month, base=SITE, data=DATA, get=_get, bust=""):
    """[] when the live site serves this checkout's data for `month`, else the problems."""
    probs = []
    for f, path in CHECKS:
        try:
            v = _dig(get(f"{base}/data/{f}?v={bust}"), path)
        except Exception as e:  # noqa: BLE001
            probs.append(f"{f}: {type(e).__name__}: {str(e)[:80]}")
            continue
        if str(v) != str(month):
            probs.append(f"{f}: as-of {v}, expected {month}")
    try:
        mine = json.loads((Path(data) / "qa.json").read_text(encoding="utf-8")).get("built")
        live = get(f"{base}/data/qa.json?v={bust}").get("built")
        if mine != live:
            probs.append(f"qa.json: live built {live}, this commit {mine}")
    except Exception as e:  # noqa: BLE001
        probs.append(f"qa.json: {type(e).__name__}: {str(e)[:80]}")
    return probs


def main(argv=None, get=_get, sleep=time.sleep):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prev")
    p.add_argument("--channels", required=True)
    v = sub.add_parser("verify")
    v.add_argument("--month", required=True)
    v.add_argument("--base", default=SITE)
    v.add_argument("--tries", type=int, default=12)
    v.add_argument("--wait", type=float, default=15.0)
    a = ap.parse_args(argv)
    if a.cmd == "prev":
        raw = Path(a.channels).read_text(encoding="utf-8")
        vid = live_version(json.loads(raw[raw.find("{"):]))  # firebase may print a line before the JSON
        if not vid:
            print("no live channel version found in " + a.channels, file=sys.stderr)
            return 1
        print(vid)
        return 0
    probs = []
    for i in range(max(1, a.tries)):
        probs = check(a.month, a.base, get=get, bust=f"{int(time.time())}-{i}")
        if not probs:
            print(f"live: {a.base} serves {a.month} and this commit's qa.json")
            return 0
        print(f"try {i + 1}/{a.tries}: " + "; ".join(probs), file=sys.stderr)
        if i < a.tries - 1:
            sleep(a.wait)
    return 1


if __name__ == "__main__":
    sys.exit(main())
