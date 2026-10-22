"""Management targets already extracted from the filings: web/public/data/targets.json

Input : web/public/data/ifrs_<period>.json (facts whose metric starts with target_, build_ifrs.py) + ifrs.json (report files)
        web/public/data/search/docs.json (the document registry: report id -> type, period, date)
Nothing is extracted here and nothing is inferred: a target is listed only as a report printed it, with its page. The same target
(company, metric, entity, date, value) printed by several reports is one row: the latest print, with the count of prints.
A target whose value changed between reports keeps every value, oldest first (`hist`).
The presentations extraction wave (management targets from the 369 investor decks) is not approved; its targets slot in here later.

python3 pipeline/build_targets.py
"""
import collections
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
REPORTS = ["2025Q1", "2025Q2", "2025Q3", "2025FY", "2026Q1", "2026Q2"]


def dict_of(path, name):
    src = (ROOT / path).read_text(encoding="utf-8")
    block = src.split(name, 1)[1].split("};", 1)[0]
    return {m.group(1) or m.group(2): m.group(3) for m in re.finditer(r"(?:'([^']+)'|([A-Za-z0-9_+:.\-]+)):\s*'([^']*)'", block)}


METRIC_HE = {**dict_of("web/src/pages/CompanyIfrs.tsx", "const HE:"), **dict_of("web/src/lib/labels.ts", "export const METRIC_HE")}
ENTITY = [  # the reporting entity of a target, in Hebrew (the extraction names it in either language)
    (r"shomera", "שומרה ביטוח"), (r"credit_cards|^max$", "מקס (כרטיסי אשראי)"), (r"wesure", "ווישור"),
    (r"insur|^insurer", "חברת הביטוח"), (r"^group$", "הקבוצה"), (r"^life$", "חיים וחיסכון"),
]


def entity(s, g):
    m = re.match(r"insurer:(.+)", s)
    if m and re.search(r"[א-ת]", m.group(1)):
        return m.group(1)
    for pat, he in ENTITY:
        if re.search(pat, s, re.I) or re.search(pat, g, re.I):
            return he
    return ""


def topic(m):
    if re.search(r"payout|dividend_payout|buyback", m):
        return "payout"
    if re.search(r"solvency|threshold|capital|cet1|excess", m):
        return "capital"
    return "strategy"


def unit(m):
    return "pct" if re.search(r"ratio|payout|roe|threshold|cet1|_pct", m) and not re.search(r"excess|surplus", m) else "m"


def main():
    files = {(x["company"], x["period"]): x for x in json.loads((DATA / "ifrs.json").read_text(encoding="utf-8"))["files"]}
    reg = json.loads((DATA / "search" / "docs.json").read_text(encoding="utf-8"))
    docs = {r[0]: r for r in reg["docs"]}
    by = collections.defaultdict(list)
    for p in REPORTS:
        f = DATA / f"ifrs_{p}.json"
        if not f.exists():
            continue
        for x in json.loads(f.read_text(encoding="utf-8")):
            if not x["m"].startswith("target"):
                continue
            url = x.get("u") or (files.get((x["c"], p)) or {}).get("url")
            rid = int(re.search(r"P(\d{6,8})-", url).group(1)) if url and re.search(r"P(\d{6,8})-", url) else None
            ent = entity(x["s"], x["g"])
            by[(x["c"], x["m"], ent, x["d"])].append((REPORTS.index(p), p, x["v"], rid, x["pg"], x["l"] if re.search(r"[א-ת]", x["l"]) else ""))
    rows = []
    for (co, m, ent, d), prints in by.items():
        prints.sort()
        last = prints[-1]
        hist, prev = [], None
        for _, p, v, rid, pg, _q in prints:
            if v != prev:
                hist.append([p, v, rid, pg])
                prev = v
        rows.append({"c": co, "m": m, "l": METRIC_HE.get(m, ""), "e": ent, "t": topic(m), "u": unit(m), "d": d, "v": last[2], "r": last[1],
                     "doc": last[3], "pg": last[4], "q": last[5], "n": len(prints), "hist": hist if len(hist) > 1 else None,
                     "src": "pres" if last[3] in docs and docs[last[3]][2] == "presentation" else "report"})
    missing = [r["m"] for r in rows if not r["l"]]
    if missing:
        raise SystemExit(f"targets without a Hebrew label (add to web/src/lib/labels.ts METRIC_HE): {sorted(set(missing))}")
    rows.sort(key=lambda r: (r["c"], r["t"], r["m"], r["e"], r["d"]))
    used = sorted({r["doc"] for r in rows if r["doc"]} | {h[2] for r in rows for h in (r["hist"] or []) if h[2]})
    out = {"v": 1, "built": dt.date.today().isoformat(), "source": "דוחות כספיים ודוחות דירקטוריון של החברות, MAYA: יעדים כפי שהודפסו",
           "pending": "יעדים ממצגות המשקיעים: גל חילוץ שטרם אושר", "files": reg["files"], "docs": {str(i): [docs[i][1], docs[i][2], docs[i][3], docs[i][4], docs[i][8]] for i in used if i in docs},
           "rows": rows}
    (DATA / "targets.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"targets.json: {len(rows)} targets from {sum(r['n'] for r in rows)} prints, {sum(1 for r in rows if r['hist'])} changed, "
          f"{collections.Counter(r['t'] for r in rows)}, {(DATA / 'targets.json').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
