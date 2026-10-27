"""Authoring CLI of the position book (module A6). The owner authors; nothing here is called by the pipeline. Standard library only.

  python3 pipeline/position.py new <id> --claim "…" --company clal --horizon 2028-12-31 --confidence medium --direction constructive \
          --mechanism "…" --evidence "/savings?g=כלל&s=pg|note" --falsifier "lens:clal:pg:ci.ltm > 90 @ Q4'28|note" \
          --trigger "lens:clal:pg:ci.ltm pp=2" [--review print|YYYY-MM-DD]       (or: new <id> --from file.json)
          writes data/positions/<id>.json as a DRAFT, after validating it (falsifier present, refs resolve, horizon in the future)
  python3 pipeline/position.py publish <id>                  freezes the baselines and appends r1 to data/ledger/positions/<id>/
  python3 pipeline/position.py revise <id> --note "why"      the edited working file becomes r<n+1> (supersedes r<n>); r<n> is untouched
  python3 pipeline/position.py close <id> --outcome confirmed|falsified|expired|withdrawn --note "…"   appends o<n> (a dated note)
  python3 pipeline/position.py validate [<id> …]             every working file (or the named ones), as `publish` would
  python3 pipeline/position.py list                          working files and ledger state

--date YYYY-MM-DD sets "today" (default: the system date). After any change: python3 pipeline/build_positions.py (or pipeline/dag.py).
A ledger file is created with mode "x": an existing entry is never overwritten.
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_positions as bp  # noqa: E402

FIELDS = ("id", "claim", "horizon", "confidence", "direction", "company", "evidence", "mechanism", "mechanism_edge", "falsifiers", "triggers", "review")


class Book:
    def __init__(self, work=bp.WORK, ledger=bp.LEDGER, ctx=None, today=None):
        self.work, self.ledger = Path(work), Path(ledger)
        self.ctx = ctx or bp.Ctx()
        self.today = today or dt.date.today().isoformat()

    # ---------------------------------------------------------------- files
    def path(self, pid):
        return self.work / f"{pid}.json"

    def read(self, pid):
        p = self.path(pid)
        if not p.exists():
            raise SystemExit(f"{pid}: no working file {p}")
        return bp.load(p)

    def write(self, p):
        self.work.mkdir(parents=True, exist_ok=True)
        ordered = {k: p[k] for k in ("status",) + FIELDS if k in p}
        self.path(p["id"]).write_text(json.dumps(ordered, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    def entries(self, pid):
        return bp.read_ledger(self.ledger).get(pid, {"revs": [], "outs": []})

    def append(self, pid, name, entry):
        d = self.ledger / pid
        d.mkdir(parents=True, exist_ok=True)
        with open(d / name, "x", encoding="utf-8") as f:  # never overwrite a ledger entry
            f.write(json.dumps(entry, ensure_ascii=False, indent=1) + "\n")
        return d / name

    @staticmethod
    def frozen(p):
        return {k: p[k] for k in FIELDS if k in p}

    def check(self, p, publish=True):
        bad = bp.validate(self.frozen(p), self.ctx, today=self.today, publish=publish)
        if bad:
            raise SystemExit(f"{p.get('id')}: {len(bad)} problems\n  " + "\n  ".join(bad))

    # ---------------------------------------------------------------- commands
    def new(self, p):
        if self.path(p["id"]).exists() or self.entries(p["id"])["revs"]:
            raise SystemExit(f"{p['id']}: exists (edit data/positions/{p['id']}.json, or `revise` a published one)")
        p = {"status": "draft", **p}
        p.setdefault("review", "print")
        p.setdefault("mechanism_edge", None)
        p.setdefault("triggers", [])
        self.check(p)
        self.write(p)
        return self.path(p["id"])

    def publish(self, pid):
        p = self.read(pid)
        if self.entries(pid)["revs"]:
            raise SystemExit(f"{pid}: already published; use `revise`")
        if bp.ABSTAIN_PHOENIX and "phoenix" in bp.companies(p):
            raise SystemExit(f"{pid}: refused: {bp.ABSTAIN_TEXT} (ABSTAIN_PHOENIX is on)")
        self.check(p)
        pos = bp.freeze(self.frozen(json.loads(json.dumps(p))), self.ctx)
        e = {"kind": "revision", "id": pid, "rev": 1, "date": self.today, "supersedes": None, "note": "", "hash": bp.sha(pos), "position": pos}
        f = self.append(pid, "r1.json", e)
        self.write({**pos, "status": "published"})
        return f

    def revise(self, pid, note):
        x = self.entries(pid)
        if not x["revs"]:
            raise SystemExit(f"{pid}: not published; edit the draft, then `publish`")
        if x["outs"]:
            raise SystemExit(f"{pid}: closed ({x['outs'][-1]['outcome']}); a closed position is not revised: open a new one")
        if not (note or "").strip():
            raise SystemExit("revise: --note says why")
        last = x["revs"][-1]
        p = self.read(pid)
        if bp.ABSTAIN_PHOENIX and "phoenix" in bp.companies(p):
            raise SystemExit(f"{pid}: refused: {bp.ABSTAIN_TEXT} (ABSTAIN_PHOENIX is on)")
        self.check(p)
        pos = bp.freeze(self.frozen(json.loads(json.dumps(p))), self.ctx, prev=last["position"])
        if bp.sha(pos) == last["hash"]:
            raise SystemExit(f"{pid}: the working file equals r{last['rev']}; nothing to revise")
        n = last["rev"] + 1
        e = {"kind": "revision", "id": pid, "rev": n, "date": self.today, "supersedes": f"r{last['rev']}", "note": note.strip(), "hash": bp.sha(pos), "position": pos}
        f = self.append(pid, f"r{n}.json", e)
        self.write({**pos, "status": "published"})
        return f

    def close(self, pid, outcome, note):
        x = self.entries(pid)
        if not x["revs"]:
            raise SystemExit(f"{pid}: not published")
        if x["outs"]:
            raise SystemExit(f"{pid}: already closed ({x['outs'][-1]['outcome']}, {x['outs'][-1]['date']})")
        if outcome not in bp.OUTCOMES:
            raise SystemExit(f"--outcome: {' | '.join(bp.OUTCOMES)}")
        if not (note or "").strip():
            raise SystemExit("close: --note is the dated reason")
        last = x["revs"][-1]
        if self.today < last["date"]:
            raise SystemExit(f"close: dated before r{last['rev']} ({last['date']})")
        if outcome == "expired" and self.today <= last["position"]["horizon"]:
            raise SystemExit(f"close: the horizon ({last['position']['horizon']}) has not passed")
        e = {"kind": "outcome", "id": pid, "seq": 1, "date": self.today, "rev": last["rev"], "outcome": outcome, "note": note.strip()}
        return self.append(pid, "o1.json", e)


# -------------------------------------------------------------------------------------------------------------- argument parsing
FALS = re.compile(r"^(?P<m>.+?)\s*(?P<op><=|>=|<|>)\s*(?P<v>-?\d+(?:\.\d+)?)\s*@\s*(?P<per>each|Q[1-4]'\d\d|FY'\d\d)\s*(?:\|(?P<note>.*))?$")
TRIG = re.compile(r"^(?P<m>.+?)\s+(?P<k>pp|pct)=(?P<v>\d+(?:\.\d+)?)$")


def parse_falsifier(s):
    m = FALS.match(s.strip())
    if not m:
        raise SystemExit(f"--falsifier {s!r}: \"<metric> <op> <value> @ <Q4'27|FY'27|each>[|note]\"")
    return {"metric": m["m"].strip(), "op": m["op"], "value": float(m["v"]) if "." in m["v"] else int(m["v"]), "period": m["per"], "note": (m["note"] or "").strip()}


def parse_trigger(s):
    m = TRIG.match(s.strip())
    if not m:
        raise SystemExit(f"--trigger {s!r}: \"<metric> pp=<n>\" or \"<metric> pct=<n>\"")
    return {"metric": m["m"].strip(), f"threshold_{m['k']}": float(m["v"])}


def parse_evidence(s):
    ref, _, note = s.partition("|")
    return {"ref": ref.strip(), "note": note.strip()}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--date", help="today, YYYY-MM-DD")
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("id")
    n.add_argument("--from", dest="src")
    n.add_argument("--claim")
    n.add_argument("--company", help="an id, ids comma-separated, or industry")
    n.add_argument("--horizon")
    n.add_argument("--confidence", choices=bp.CONF)
    n.add_argument("--direction", choices=bp.DIRS)
    n.add_argument("--mechanism")
    n.add_argument("--evidence", action="append", default=[])
    n.add_argument("--falsifier", action="append", default=[])
    n.add_argument("--trigger", action="append", default=[])
    n.add_argument("--review", default="print")
    sub.add_parser("publish").add_argument("id")
    r = sub.add_parser("revise")
    r.add_argument("id")
    r.add_argument("--note", required=True)
    c = sub.add_parser("close")
    c.add_argument("id")
    c.add_argument("--outcome", required=True, choices=bp.OUTCOMES)
    c.add_argument("--note", required=True)
    sub.add_parser("validate").add_argument("ids", nargs="*")
    sub.add_parser("list")
    a = ap.parse_args(argv)
    if a.date and not bp.ISO.match(a.date):
        raise SystemExit("--date YYYY-MM-DD")
    b = Book(today=a.date)
    if a.cmd == "new":
        if a.src:
            p = bp.load(a.src)
            p["id"] = a.id
            p.pop("status", None)
        else:
            co = a.company or ""
            p = {"id": a.id, "claim": a.claim, "horizon": a.horizon, "confidence": a.confidence, "direction": a.direction,
                 "company": co if co == "industry" or "," not in co else co.split(","), "evidence": [parse_evidence(x) for x in a.evidence],
                 "mechanism": a.mechanism, "falsifiers": [parse_falsifier(x) for x in a.falsifier], "triggers": [parse_trigger(x) for x in a.trigger],
                 "review": a.review}
        print("draft written:", b.new(p))
    elif a.cmd == "publish":
        print("published:", b.publish(a.id))
    elif a.cmd == "revise":
        print("revised:", b.revise(a.id, a.note))
    elif a.cmd == "close":
        print("closed:", b.close(a.id, a.outcome, a.note))
    elif a.cmd == "validate":
        ids = a.ids or sorted(f.stem for f in b.work.glob("*.json"))
        bad = 0
        for pid in ids:
            p = b.read(pid)
            probs = bp.validate(b.frozen(p), b.ctx, today=b.today, publish=p.get("status") == "draft")
            bad += bool(probs)
            print(f"{'OK  ' if not probs else 'FAIL'} {pid} ({p.get('status')})" + ("".join(f"\n       {x}" for x in probs)))
        return 1 if bad else 0
    elif a.cmd == "list":
        L = bp.read_ledger(b.ledger)
        for f in sorted(b.work.glob("*.json")):
            p = bp.load(f)
            x = L.get(p["id"], {"revs": [], "outs": []})
            st = x["outs"][-1]["outcome"] if x["outs"] else f"r{x['revs'][-1]['rev']} {x['revs'][-1]['date']}" if x["revs"] else "draft"
            print(f"{p['id']:40} {st:22} {p.get('confidence', ''):7} {p.get('horizon', '')}  {p.get('claim', '')[:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
