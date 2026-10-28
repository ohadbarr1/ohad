"""The Question Index (module S1): the standing questions of the industry, each with a live-computed, sourced answer at three altitudes
(the Answer Ladder, S6: corridor / email / exhibit). Deterministic: every answer is recomputed from the published files at every build.

Questions live in pipeline/questions/*.py (one module per family), registered with answer_core.question. A question's id ("Q-###") is
permanent once published; a question that cannot be answered right now says why (`nodata`), it is never dropped or guessed.

python3 pipeline/build_answers.py            write web/public/data/answers/index.json and answers/<topic>.json
python3 pipeline/build_answers.py --check    rebuild in memory, compare with the files on disk and run the rules of answer_core.body_problems
                                             (gate `answers`)
"""
import argparse
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


def register():
    if A.QUESTIONS:
        return
    for m in sorted(pkgutil.iter_modules(questions.__path__), key=lambda m: m.name):
        if not m.name.startswith("_"):
            importlib.import_module(f"questions.{m.name}")


def build():
    register()
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
                     "asof": a.get("asof"), "chg": a["chg"]["st"] if a.get("chg") else None, "h": a.get("h")})
    index = {"v": 1, "chairs": A.CHAIRS, "topics": {k: v for k, v in A.TOPICS.items() if k in by_topic}, "bases": A.BASES,
             "n": len(rows), "ok": sum(r["st"] == "ok" for r in rows), "rows": rows}
    files = {"index.json": index}
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
            p = OUT / name
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
        (OUT / name).write_text(dump(f), encoding="utf-8")
    nd = [r for r in idx["rows"] if r["st"] != "ok"]
    print(f"answers: {idx['n']} questions, {idx['ok']} answered" + (f"; no data: {', '.join(r['id'] for r in nd)}" if nd else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
