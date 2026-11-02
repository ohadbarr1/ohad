"""The Question Index (module S1): the standing questions of the industry, each with a live-computed, sourced answer at three altitudes
(the Answer Ladder, S6: corridor / email / exhibit). Deterministic: every answer is recomputed from the published files at every build.

Questions live in pipeline/questions/*.py (one module per family), registered with answer_core.question. A question's id ("Q-###") is
permanent once published; a question that cannot be answered right now says why (`nodata`), it is never dropped or guessed.

python3 pipeline/build_answers.py            write web/public/data/answers/index.json and answers/<topic>.json
python3 pipeline/build_answers.py --check    rebuild in memory, compare with the files on disk and run the rules of answer_core.body_problems
                                             (gate `answers`)

Version history (W6 trust): web/public/data/answers_history.json keeps, per question, every earlier version the site published: {"h": its hash (answer_core.vkey),
"corr": its corridor text, "asof", "at": the build day the change was seen}. A build compares each answer's hash with the index on disk and
appends the superseded version; the index row then carries `prev` (the latest superseded version), which /questions/<id> shows as
"השתנה מ-… ב-…". Append-only: a version is never edited or removed. --check rebuilds against the same disk index, so an unchanged answer
leaves the history as it is.
"""
import argparse
import datetime as dt
import importlib
import json
import pkgutil
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import answer_core as A  # noqa: E402
import questions  # noqa: E402

OUT = A.DATA / "answers"
HIST = A.DATA / "answers_history.json"  # outside answers/: every file there is a topic file of answers (the tests and the loaders read them all)


def register():
    if A.QUESTIONS:
        return
    for m in sorted(pkgutil.iter_modules(questions.__path__), key=lambda m: m.name):
        if not m.name.startswith("_"):
            importlib.import_module(f"questions.{m.name}")


HISTORY = "../answers_history.json"  # its key in the files dict: written to HIST, not into answers/


def path_of(name):
    return HIST if name == HISTORY else OUT / name


def previous():
    """the index and the history as published on disk (what the reader saw before this build); empty when there is none"""
    try:
        idx = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        idx = None
    try:
        hist = json.loads(HIST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        hist = {"v": 1, "rows": {}}
    return idx, hist


def with_history(rows, idx, hist, today):
    """append each superseded version to the history and mark the rows whose current version differs from the last published one"""
    prev = {r["id"]: r for r in (idx or {}).get("rows", []) if r.get("h")}
    H = hist.setdefault("rows", {})
    for r in rows:
        p = prev.get(r["id"])
        if r["st"] == "ok" and p and p["h"] != r["h"] and p.get("corr"):
            L = H.setdefault(r["id"], [])
            if not L or L[-1]["h"] != p["h"]:
                L.append({"h": p["h"], "corr": p["corr"], "asof": p.get("asof"), "at": today})
        L = H.get(r["id"])
        if L and r["st"] == "ok" and L[-1]["h"] != r["h"]:
            r["prev"] = {"h": L[-1]["h"], "corr": L[-1]["corr"], "at": L[-1]["at"]}
    hist["v"] = 1
    return hist


def build(today=None):
    register()
    today = today or dt.date.today().isoformat()
    rows, by_topic = [], {}
    for q in sorted(A.QUESTIONS, key=lambda q: q["id"]):
        body = q["fn"](A)
        a = {k: q[k] for k in ("id", "q", "chairs", "topic", "cos")}
        a.update(body)
        if a["st"] == "ok":
            a["h"] = A.vkey(a)
        by_topic.setdefault(q["topic"], []).append(a)
        rows.append({"id": a["id"], "q": a["q"], "chairs": a["chairs"], "topic": a["topic"], "cos": a["cos"], "st": a["st"],
                     "corr": A.render(a["corr"], a["figs"]) if a["st"] == "ok" else None, "why": a.get("why"),
                     # the corridor sentence with its one figure, so the index renders sourced numbers without loading the topic files
                     "cs": a["corr"] if a["st"] == "ok" else None,
                     "cf": {k: a["figs"][k] for k in A.TOKEN.findall(a["corr"]) if k in a["figs"]} if a["st"] == "ok" else None,
                     "asof": a.get("asof"), "chg": a["chg"]["st"] if a.get("chg") else None, "h": a.get("h")})
    idx0, hist = previous()
    hist = with_history(rows, idx0, hist, today)
    index = {"v": 1, "chairs": A.CHAIRS, "topics": {k: v for k, v in A.TOPICS.items() if k in by_topic}, "bases": A.BASES,
             "n": len(rows), "ok": sum(r["st"] == "ok" for r in rows), "rows": rows}
    files = {"index.json": index, HISTORY: hist}
    for t, xs in by_topic.items():
        files[f"{t}.json"] = {"v": 1, "topic": t, "label": A.TOPICS[t], "rows": xs}
    return files


def problems(files):
    out = []
    idx = files.get("index.json")
    if not idx:
        return ["answers/index.json missing"]
    seen = set()
    for r in idx["rows"]:
        if not re.fullmatch(r"Q-\d{3}", r["id"]):
            out.append(f"{r['id']}: id format")
        if r["id"] in seen:
            out.append(f"{r['id']}: duplicate id")
        seen.add(r["id"])
        if r["topic"] not in A.TOPICS:
            out.append(f"{r['id']}: topic {r['topic']}")
        bad = [c for c in r["chairs"] if c not in A.CHAIRS]
        if bad or not r["chairs"]:
            out.append(f"{r['id']}: chairs {bad or 'none'}")
        if A.FIRST_PERSON.search(r["q"]):
            out.append(f"{r['id']}: first-person question")
    for name, f in files.items():
        if name == "index.json":
            continue
        if name == HISTORY:
            for qid, L in f["rows"].items():
                if not re.fullmatch(r"Q-\d{3}", qid) or not isinstance(L, list) or not L:
                    out.append(f"history/{qid}: shape")
                for e in L:
                    if not (isinstance(e.get("h"), str) and isinstance(e.get("corr"), str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", e.get("at") or "")):
                        out.append(f"history/{qid}: entry {e}")
            continue
        for a in f["rows"]:
            out += A.body_problems(a["id"], a)
    out += A.banned(files)
    return out


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    files = build()
    bad = problems(files)
    idx = files["index.json"]
    if a.check:
        for name, f in files.items():
            p = path_of(name)
            if not p.exists():
                bad.append(f"answers/{name} missing")
            elif p.read_text(encoding="utf-8") != dump(f):
                bad.append(f"answers/{name} differs from a rebuild")
        extra = {p.name for p in OUT.glob("*.json")} - set(files) if OUT.exists() else set()
        bad += [f"answers/{x}: stale file" for x in sorted(extra)]
        print(f"answers: {idx['n']} questions, {idx['ok']} answered, {len(bad)} problems" + (f"; {bad[0]}" if bad else ""))
        for b in bad[:30]:
            print("FAIL", b)
        return 1 if bad else 0
    if bad:
        for b in bad[:30]:
            print("FAIL", b)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    for p in OUT.glob("*.json"):
        if p.name not in files:
            p.unlink()
    for name, f in files.items():
        path_of(name).write_text(dump(f), encoding="utf-8")
    nd = [r for r in idx["rows"] if r["st"] != "ok"]
    print(f"answers: {idx['n']} questions, {idx['ok']} answered" + (f"; no data: {', '.join(r['id'] for r in nd)}" if nd else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
