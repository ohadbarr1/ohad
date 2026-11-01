"""S10 Watch & Wake: the day's snapshot of what every answer and finding SAYS, appended to the ledger data/ledger/answers/<YYYY-MM-DD>.json.

The ledger is append-only (gate `watch_ledger`): a snapshot is written once per build day and never rewritten. A second run on the same
day leaves the file as it is (idempotent: the first build of the day is the day's record). pipeline/build_watch.py diffs consecutive
snapshots into web/public/data/watch.json.

A snapshot holds, per question (answers/<topic>.json) and per finding (findings.json):
  q / det, topic, cos      what it is and whom it concerns (so a question that disappears can still be named and matched)
  st                       ok | nodata
  h                        the answer's signature (answer_core.vkey: verdict key + rendered corridor), null when nodata
  vk                       the verdict key: which branch the verdict took ("nodata" when the question cannot be answered)
  corr                     the corridor sentence as text (tokens rendered); for nodata, the reason
  cs, cf                   the corridor with its token and its one figure without provenance ({l, v, u, t, b, asof}): a morning brief can
                           quote the earlier figure as a figure, labelled "as published on <date>", never as a bare number in prose
  chg_st                   holds | tripped | null: the falsifier's state at that build
  asof                     the answer's own as-of label
  top                      (findings) whether the finding led the build

python3 pipeline/snapshot_answers.py                       today's snapshot from web/public/data (skip if the day exists)
python3 pipeline/snapshot_answers.py --date 2026-10-28 --from-git 42903a80
                                                           a past day rebuilt from the files as committed at a revision (honest history:
                                                           the published state of that day; `src` records the revision)
python3 pipeline/snapshot_answers.py --print               the snapshot to stdout, nothing written

Standard library only. Deterministic: keys sorted, figures rounded as published.
"""
import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import answer_core as A  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "ledger" / "answers"
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
FIG_KEYS = ("l", "v", "u", "t", "b", "asof")


def _git_json(rev, rel):
    p = subprocess.run(["git", "show", f"{rev}:./{rel}"], cwd=ROOT, capture_output=True)
    if p.returncode:
        return None
    return json.loads(p.stdout.decode("utf-8"))


def reader(rev=None):
    """path under web/public/data -> parsed JSON (or None): the working tree, or the files at a git revision"""
    if rev:
        return lambda rel: _git_json(rev, f"web/public/data/{rel}")

    def disk(rel):
        p = A.DATA / rel
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    return disk


def _cf(body):
    toks = A.TOKEN.findall(body.get("corr") or "")
    return {k: {x: body["figs"][k].get(x) for x in FIG_KEYS} for k in toks if k in body.get("figs", {})}


def entry(body):
    """the part of an answer body a snapshot keeps (same for a finding)"""
    if body.get("st") != "ok":
        return {"st": "nodata", "h": None, "vk": "nodata", "corr": body.get("why") or "", "cs": None, "cf": None, "chg_st": None,
                "asof": body.get("asof")}
    return {"st": "ok", "h": body.get("h") or A.vkey(body), "vk": body["vk"], "corr": A.render(body["corr"], body["figs"]),
            "cs": body["corr"], "cf": _cf(body), "chg_st": (body.get("chg") or {}).get("st"), "asof": body.get("asof")}


def snapshot(date, read, src="build"):
    idx = read("answers/index.json")
    if not idx:
        raise SystemExit("snapshot: answers/index.json missing")
    answers = {}
    for t in sorted({r["topic"] for r in idx["rows"]}):
        f = read(f"answers/{t}.json") or {"rows": []}
        for a in f["rows"]:
            e = entry(a)
            e.update({"q": a["q"], "topic": a["topic"], "cos": list(a.get("cos") or [])})
            answers[a["id"]] = e
    missing = [r["id"] for r in idx["rows"] if r["id"] not in answers]
    if missing:
        raise SystemExit(f"snapshot: {len(missing)} index rows without a body ({missing[0]})")
    findings = {}
    F = read("findings.json")
    for r in (F or {}).get("rows", []):
        e = entry(r)
        e.update({"det": r.get("det"), "cos": [r["c"]] if r.get("c") else [], "top": bool(r.get("top"))})
        findings[r["id"]] = e
    return {"v": 1, "date": date, "src": src, "answers": answers, "findings": findings}


def dump(s):
    """one entry per line (a day-to-day diff of the ledger reads line by line), keys sorted"""
    j = lambda o: json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))  # noqa: E731
    head = {k: v for k, v in s.items() if k not in ("answers", "findings")}
    groups = []
    for g in ("answers", "findings"):
        rows = ",\n".join(f"{j(k)}:{j(e)}" for k, e in sorted(s[g].items()))
        groups.append(f'"{g}":{{' + (f"\n{rows}\n" if rows else "") + "}")
    return "{" + j(head)[1:-1] + ",\n" + ",\n".join(groups) + "\n}\n"


def write(s, ledger=LEDGER):
    """writes the day's snapshot unless the day exists (append-only). Returns 'written' | 'kept' | 'kept-differs'"""
    ledger.mkdir(parents=True, exist_ok=True)
    p = ledger / f"{s['date']}.json"
    if p.exists():
        old = json.loads(p.read_text(encoding="utf-8"))
        same = {k: old.get(k) for k in ("answers", "findings")} == {k: s.get(k) for k in ("answers", "findings")}
        return "kept" if same else "kept-differs"
    p.write_text(dump(s), encoding="utf-8")
    return "written"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD (default: today)")
    ap.add_argument("--from-git", dest="rev", help="read the published files as committed at this revision")
    ap.add_argument("--print", action="store_true")
    a = ap.parse_args(argv)
    date = a.date or dt.date.today().isoformat()
    if not DATE.fullmatch(date):
        raise SystemExit(f"snapshot: date {date}")
    if a.rev:
        full = subprocess.run(["git", "rev-parse", "--short=8", a.rev], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        if not full:
            raise SystemExit(f"snapshot: no revision {a.rev}")
        src = f"git:{full}"
    else:
        src = "build"
    s = snapshot(date, reader(a.rev), src)
    if a.print:
        sys.stdout.write(dump(s))
        return 0
    st = write(s)
    msg = {"written": "written", "kept": "exists, unchanged (kept)",
           "kept-differs": "exists; today's answers differ from the day's first snapshot, which is kept (the change shows on the next day)"}[st]
    print(f"snapshot {date}: {len(s['answers'])} answers, {len(s['findings'])} findings; {msg}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
