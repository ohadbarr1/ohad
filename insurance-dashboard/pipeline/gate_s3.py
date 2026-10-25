"""Lane S3 gate checks (called from pipeline/gate.py):
  stress       the stress lab reproduces every disclosed sensitivity at its disclosed shock size (web/tests/stress.unit.ts, run in node)
  credibility  targets.json: every scored target (met / partial / missed) carries its statement page and an actual with a page for every
               input; every passed target that is not scored says why; the hit rates add up from the rows
"""
import collections
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = WEB / "public" / "data"
NODE = shutil.which("node") or next((str(p) for p in sorted(Path.home().glob(".nvm/versions/node/v2*/bin/node"))), None)


def stress(add):
    if not NODE:
        return add("stress", False, 0, 1, "node not found: stress-lab reproduction not checked", level="warn")
    p = subprocess.run([NODE, "scripts/stress-test.mjs"], cwd=WEB, capture_output=True, text=True)
    out = [l for l in p.stdout.strip().splitlines() if l.strip()]
    head = next((l for l in out if "reproduced" in l), "")
    tail = next((l for l in out if " passed, " in l), (p.stderr.strip() or "no output")[-160:])
    fails = [l.strip() for l in out if l.strip().startswith("FAIL")]
    n = int(head.split()[1]) + int(head.split()[6]) if head else 0
    add("stress", p.returncode == 0, n, len(fails) or (0 if p.returncode == 0 else 1),
        (head.split("·")[0].replace("stress: ", "") + "; " + tail.replace("stress: ", "") + (f"; e.g. {fails[0][5:]}" if fails else ""))[:200])


def credibility(add):
    t = json.loads((DATA / "targets.json").read_text(encoding="utf-8"))
    bad, n = [], 0
    for r in t["rows"]:
        key = f"{r['c']} {r['m']} {r.get('h')}"
        st = r.get("st")
        if st in ("met", "partial", "missed"):
            n += 1
            d = t["docs"].get(str(r.get("doc")))
            if not d or not d[4] or not r.get("pg"):
                bad.append(f"{key}: target without document or page")
            a = r.get("act") or {}
            if not a.get("in") or a.get("prog") or a.get("ref"):
                bad.append(f"{key}: scored without an actual for the target year")
            for x in a.get("in", []):
                if not x[2] or not x[3]:
                    bad.append(f"{key}: actual input '{x[0]}' without file or page")
            if a.get("y") != r.get("h"):
                bad.append(f"{key}: actual year {a.get('y')} is not the horizon")
        elif st == "nc" and not r.get("why"):
            bad.append(f"{key}: not comparable without a reason")
    cred = t.get("cred") or {}
    c = collections.Counter(r.get("st") for r in t["rows"])
    a = cred.get("all") or {}
    if (a.get("met"), a.get("partial"), a.get("missed"), a.get("nc")) != (c["met"], c["partial"], c["missed"], c["nc"]):
        bad.append("cred.all does not add up from the rows")
    add("credibility", not bad, n, len(bad), f"{n} scored targets (met {c['met']}, partial {c['partial']}, missed {c['missed']}), {c['nc']} not comparable with a reason; "
        f"target page + actual page on every scored row" + (f"; e.g. {bad[0]}" if bad else ""))


def run(add):
    stress(add)
    credibility(add)
