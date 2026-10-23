"""Discovery: read each manager's asset-list page(s) and record which quarterly files are published.

  python3 pipeline/asset_lists/probe.py                 # every manager with pages in sources.json
  python3 pipeline/asset_lists/probe.py altshuler meitav

Writes pipeline/asset_lists/coverage.json: per manager its status, robots.txt status, page URLs, and every CMA-named file found
({product, quarter, url, page}). Managers without pages keep the status and note recorded in sources.json (blocked / js_only /
not_found). Politeness and blocking rules live in net.py: a captcha / 403 / 429 stops that host for the run and marks it blocked.
"""
from __future__ import annotations
import html, json, re, sys, urllib.parse
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from asset_lists import net  # noqa: E402
from asset_lists.common import COVERAGE, load_sources, parse_name  # noqa: E402

HREF = re.compile(r"""href\s*=\s*["']([^"']+\.xlsx?)["']""", re.I)
WIX = re.compile(r'"document":"wix:document://v1/(?:ugd/)?([0-9a-f_]+\.xlsx?)/([^"]+)"')


def links_html(page: str, txt: str):
    for h in HREF.findall(txt):
        yield urllib.parse.urljoin(page, html.unescape(h))


def links_wix(txt: str, base: str):
    t = txt.replace("\\/", "/")
    for fid, name in WIX.findall(t):
        yield base + fid + "#" + name     # the fragment keeps the CMA file name for parse_name


def probe(mid: str, m: dict) -> dict:
    rec = {"name": m["name"], "status": m["status"], "note": m.get("note", ""), "pages": [], "files": []}
    seen = set()
    for p in m.get("pages", []):
        ok, rstat = net.robots_ok(p["url"])
        pr = {"url": p["url"], "robots": rstat}
        if not ok:
            pr["error"] = "robots.txt disallows"
            rec["pages"].append(pr)
            continue
        try:
            txt, _, final = net.get(p["url"])
        except net.Blocked as e:
            pr["error"] = f"blocked: {e}"
            rec["status"] = "blocked"
            rec["pages"].append(pr)
            break
        except Exception as e:  # noqa: BLE001
            pr["error"] = f"{type(e).__name__}: {e}"
            rec["pages"].append(pr)
            continue
        urls = links_wix(txt, p["file_base"]) if p["kind"] == "wix" else links_html(final, txt)
        n = 0
        for u in urls:
            pn = parse_name(urllib.parse.unquote(u))
            if not pn or pn[0] != m["company_id"]:
                continue
            key = (pn[1], pn[2])
            if key in seen:
                continue
            seen.add(key)
            n += 1
            rec["files"].append({"product": pn[1], "quarter": pn[2], "url": u, "page": p["url"], "via": "page"})
        pr["files"] = n
        rec["pages"].append(pr)
    rec["files"].sort(key=lambda f: (f["product"], f["quarter"]))
    rec["quarters"] = sorted({f["quarter"] for f in rec["files"]})
    return rec


def main(argv):
    src = load_sources()
    cov = json.loads(COVERAGE.read_text(encoding="utf-8")) if COVERAGE.exists() else {"managers": {}}
    want = argv or list(src["managers"])
    for mid in want:
        m = src["managers"][mid]
        if not m.get("pages"):
            cov["managers"][mid] = {"name": m["name"], "status": m["status"], "note": m.get("note", ""), "pages": [], "files": [], "quarters": []}
            continue
        rec = probe(mid, m)
        cov["managers"][mid] = rec
        by = {}
        for f in rec["files"]:
            by.setdefault(f["product"], []).append(f["quarter"])
        print(f"{mid:10} {rec['status']:9} " + "  ".join(f"{p}:{len(q)} ({q[0]}..{q[-1]})" for p, q in sorted(by.items())), flush=True)
    cov["probed"] = date.today().strftime("%d.%m.%y")
    cov["user_agent"] = net.UA
    COVERAGE.write_text(json.dumps(cov, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
