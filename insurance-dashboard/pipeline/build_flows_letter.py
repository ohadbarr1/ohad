"""P3 (fox 3.0 phase 1): the monthly flows letter. On each regulator month, one citable, versioned letter built from the files the site
already publishes: who won and lost on transfers, by product; the decomposition of net transfers (default-fund tender, track closings,
competitive) with the intra-group migration that netting already removed; the "below the median and still taking money" highlights; and
the definitions, stated as fox's own. Standard library; nothing is estimated here that the inputs do not already carry.

python3 pipeline/build_flows_letter.py            build the letter of the latest regulator month (flows.json asof) and the index
python3 pipeline/build_flows_letter.py --check    rebuild in memory: the latest letter and the index equal the files, every superseded
                                                  version's snapshot still hashes to what the letter records (gate: run it)

  -> web/public/data/flows/letters/<yyyymm>.json        the letter (current version)
  -> web/public/data/flows/letters/<yyyymm>.v<n>.json   version n, frozen when version n+1 was cut (never rewritten)
  -> web/public/data/flows/letters/index.json           every letter (month, version, built, hash, headline) and the feed events

Versions. The body (everything except the version fields) is hashed. A rebuild with the same inputs writes nothing new. A rebuild whose
body differs (data.gov.il revises the resources of the current month) cuts version n+1: version n is copied to <yyyymm>.v<n>.json, and
the new letter records the figures that changed ("מה השתנה מגרסה קודמת"). A letter is rebuilt while its month is the latest regulator
month; once the next month lands it is final (the regulator's revision of an older month is shown on /flows, not re-lettered).

Inputs: flows.json (asof, received, method, coverage, tenders), flows/<prod>.json (the month's cell of every group x product),
under.json (the month's list, when its asof is the same month). Units: NIS millions; months yyyymm.
"""
import datetime as dt
import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "web" / "public" / "data"
V = 1
LETTERS = "flows/letters"
SITE = "https://fox-research-il.web.app"
FIELDS = ("a", "tr", "comp", "dt", "cl", "mig", "org", "net", "dep", "wd", "rk")
DECOMP = ("tr", "comp", "dt", "cl", "mig")
METHOD_KEYS = ("cell", "a", "dep", "wd", "tr", "org", "net", "mig", "dt", "cl", "comp", "rk")
HEAD_PRODS = ("pm", "hs", "gm", "gl")   # the products named in the headline text (the rest are in the tables)
TOP_UNDER = 5
SRC_NAME = "רשות שוק ההון: גמל-נט, פנסיה-נט (data.gov.il)"
FIG_HE = {"tr": "ניוד נטו", "comp": "ניוד תחרותי", "dt": "לקרנות ברירת מחדל", "cl": "סגירת מסלולים", "mig": "נדידה פנימית", "n": "מסלולים", "a": "נכסים",
          "cost": "עלות הפער בשנה", "fl": "נכנס ב-12 החודשים"}
HE_MONTH = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]


def ym(p):
    return f"{p % 100:02d}/{str(p // 100)[2:]}"


def dmy(iso):
    return f"{iso[8:10]}.{iso[5:7]}.{iso[2:4]}" if iso else "–"


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def who(x):
    return x["grp"] + (f" (במוצר מ-{ym(x['since'])})" if x.get("since") else "")


def r1(x):
    return None if x is None else round(x + 0.0, 1) + 0.0


def mil(x, sign=True):
    """₪ text as the site writes it: millions, or billions from 1,000 (sign − U+2212)"""
    s = ("+" if x > 0 else "−" if x < 0 else "") if sign else ""
    a = abs(x)
    n = f"{a / 1000:,.1f}" if a >= 1000 else f"{a:,.0f}"
    return f"\u2066{s}₪{n}\u2069 {'מיליארד' if a >= 1000 else 'מיליון'}"   # the sign, ₪ and figure kept in order inside Hebrew text (LRI … PDI)


def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def sha(o):
    return hashlib.sha256(dumps(o).encode("utf-8")).hexdigest()


def load(d, p):
    return json.loads((d / p).read_text(encoding="utf-8"))


# ------------------------------------------------------------------------------------------------------------------------------ the body
def cell(S, f, j):
    xs = S.get(f)
    return None if not xs or j >= len(xs) else xs[j]


def body(d, p=None):
    """the letter of month p (default: flows.json asof) from the published files under d; every figure carries where it comes from"""
    idx = load(d, "flows.json")
    p = p or idx["asof"]
    bucket = idx["bucket"]
    prods, gsum = [], {}
    for m in idx["prods"]:
        if not m["flows"]:
            continue
        doc = load(d, f"flows/{m['id']}.json")
        if p not in doc["months"]:
            continue
        j = doc["months"].index(p)
        groups = []
        for g, S in doc["groups"].items():
            if cell(S, "a", j) is None:
                continue
            row = {"grp": g, **{f: cell(S, f, j) for f in FIELDS}}
            first = j                       # a group new to the product: the start of its current run of months with assets
            while first > 0 and cell(S, "a", first - 1):
                first -= 1
            if doc["months"][first] > madd(p, -12):
                row["since"] = doc["months"][first]
            row["dt"] = row["dt"] if row["dt"] is not None else (0.0 if row["tr"] is not None else None)
            if g == bucket:
                row["rk"] = None
            groups.append(row)
            if g != bucket and row["comp"] is not None:
                t = gsum.setdefault(g, {f: [] for f in DECOMP + ("org", "net")})
                for f in DECOMP + ("org", "net"):
                    if row[f] is not None:
                        t[f].append((m["id"], row[f]))
        groups.sort(key=lambda r: (r["rk"] is None, r["rk"] or 0, -(r["a"] or 0), r["grp"]))
        tot = {f: cell(doc["tot"], f, j) for f in FIELDS if f != "rk"}
        tot["dt"] = tot["dt"] if tot["dt"] is not None else (0.0 if tot["tr"] is not None else None)
        ranked = [r for r in groups if r["rk"] is not None and r["comp"] is not None]
        top, low = (ranked[0], ranked[-1]) if ranked else (None, None)
        prods.append({"id": m["id"], "label": m["label"], "tot": tot, "groups": groups,
                      "top": {k: top[k] for k in ("grp", "comp", "tr", "since") if k in top} if top else None,
                      "low": {k: low[k] for k in ("grp", "comp", "tr", "since") if k in low} if low and low is not top and low["comp"] < 0 else None})
    if not prods:
        raise SystemExit(f"build_flows_letter: no product carries flows for {p}")
    # every group across the flow products: the sum of its cells, each cell named
    across = []
    for g, t in gsum.items():
        across.append({"grp": g, **{f: r1(math.fsum(v for _, v in t[f])) for f in t}, "in": {f: [[pid, v] for pid, v in t[f]] for f in ("comp", "tr")}})
    across.sort(key=lambda r: (-r["comp"], r["grp"]))
    total = {f: r1(math.fsum(x["tot"][f] for x in prods if x["tot"].get(f) is not None)) for f in DECOMP + ("org", "net", "a")}
    total["in"] = {f: [[x["id"], x["tot"][f]] for x in prods if x["tot"].get(f) is not None] for f in DECOMP}
    win, lose = across[0], across[-1] if across[-1]["comp"] < 0 else None
    # the default-fund tender in force this month (comprehensive pension)
    tenders = [{"label": t["label"], "from": t["from"], "to": t["to"], "winners": sorted({w["grp"] for w in t["winners"]})}
               for t in idx["tenders"] if t["from"] <= p <= t["to"]]
    under = under_part(d, p)
    # the headline: generated from the tables, no adjectives
    by = {x["id"]: x for x in prods}
    lines = [f"{ym(p)}, כל מוצרי הגמל והפנסיה: {win['grp']} {mil(win['comp'])} בניוד תחרותי"
             + (f"; {lose['grp']} {mil(lose['comp'])}" if lose else "") + "."]
    for pid in HEAD_PRODS:
        x = by.get(pid)
        if not x or not x["top"]:
            continue
        s = f"{x['label']}: {who(x['top'])} {mil(x['top']['comp'])}"
        if x["low"]:
            s += f", {who(x['low'])} {mil(x['low']['comp'])}"
        lines.append(s + ".")
    lines.append(f"סך הניוד נטו של כל הגופים במוצרים האלה {mil(total['tr'])}: לקרנות ברירת מחדל {mil(total['dt'])}, סגירת מסלולים {mil(total['cl'])}, "
                 f"תחרותי {mil(total['comp'])}. בנוסף עברו {mil(total['mig'], False)} בין מסלולים של אותה קבוצה (נדידה פנימית, מקוזזת ולא נספרת).")
    if under:
        lines.append(f"{under['n']} מסלולים ברבעון התחתון של הקטגוריה עדיין קיבלו {mil(under['fl'], False)} נטו ב-12 החודשים; "
                     f"הפער שלהם מהחציון כ-{mil(under['cost'], False)} בשנה.")
    figs = {"win.comp": [f"ניוד תחרותי, כל המוצרים · {win['grp']}", win["comp"]]}
    if lose:
        figs["lose.comp"] = [f"ניוד תחרותי, כל המוצרים · {lose['grp']}", lose["comp"]]
    for x in prods:
        for f in DECOMP:
            figs[f"{x['id']}.tot.{f}"] = [f"{x['label']} · {FIG_HE[f]}", x["tot"][f]]
        for r in x["groups"]:
            figs[f"{x['id']}.{r['grp']}.comp"] = [f"{x['label']} · {r['grp']} · ניוד תחרותי", r["comp"]]
    for f in DECOMP:
        figs[f"all.{f}"] = [f"כל המוצרים · {FIG_HE[f]}", total[f]]
    if under:
        for f in ("n", "a", "cost", "fl"):
            figs[f"under.{f}"] = [f"מתחת לחציון · {FIG_HE[f]}", under[f]]
    method = {k: idx["method"][k] for k in METHOD_KEYS if k in idx["method"]}
    return {
        "p": p, "received": idx["received"] if idx["asof"] == p else None, "src": idx["src"], "src_short": SRC_NAME,
        "headline": lines, "winner": win, "loser": lose, "across": across, "total": total, "prods": prods, "tenders": tenders, "under": under,
        "defs": defs(method, total, p, idx["received"] if idx["asof"] == p else None),
        "method": method, "coverage": {k: idx["coverage"][k] for k in ("tr_split", "group", "default") if k in idx["coverage"]},
        "figs": figs,
    }


def under_part(d, p):
    """the month's "below the median and still taking money" figures, when under.json is of the same month"""
    if not (d / "under.json").exists():
        return None
    U = load(d, "under.json")
    if U["asof"] != p:
        return None
    S, j = U["series"], len(U["months"]) - 1
    rows = [dict(zip(U["cols"], r)) for r in U["rows"]]
    head = sorted([r for r in rows if r.get("head")], key=lambda r: (-r["cost"], r["k"]))
    out = {"asof": p, "n": S["n"][j], "a": S["a"][j], "cost": S["cost"][j], "fl": S["fl"][j], "icost": S["icost"][j], "n_rk": S["n_rk"][j], "n_cat": S["n_cat"][j],
           "bq": U["bq"], "win": U["win"], "src": U["src"], "past": U["method"]["past"],
           "top": [{k: r[k] for k in ("k", "name", "grp", "cat", "a", "r5", "med", "pct", "gap", "cost", "nd12", "c12", "mig")} for r in head[:TOP_UNDER]]}
    if j >= 12 and len(U["cov"][j - 12]) == len(U["cov"][j]):   # a year earlier, only when the same products were measured
        out["yoy"] = {"p": U["months"][j - 12], "n": S["n"][j - 12], "cost": S["cost"][j - 12], "fl": S["fl"][j - 12]}
    return out


def defs(method, total, p, received):
    """fox's definitions, each from the method strings flows.json publishes, and how to compare with another publication's "העברות נטו"
    (stated as checks against fox's own decomposition: fox does not characterise anyone else's definition)"""
    D_ = [
        {"k": "tr", "he": "ניוד נטו", "def": method["tr"]},
        {"k": "comp", "he": "ניוד תחרותי", "def": method["comp"]},
        {"k": "dt", "he": "ניוד לקרן ברירת מחדל (מכרז)", "def": method["dt"]},
        {"k": "cl", "he": "סגירת מסלולים", "def": method["cl"]},
        {"k": "mig", "he": "נדידה פנימית", "def": method["mig"]},
        {"k": "org", "he": "צבירה אורגנית", "def": method["org"]},
        {"k": "net", "he": "צבירה נטו", "def": method["net"]},
    ]
    compare = [
        f"רמת הצבירה: מסלול, קופה, חברה מנהלת או קבוצה. נדידה פנימית מתקזזת רק כשמסכמים את כל מסלולי הקבוצה במוצר; ב-{ym(p)} עברו כך {mil(total['mig'], False)} בין מסלולים של אותה קבוצה.",
        f"קרנות ברירת מחדל: ב-{ym(p)} ניוד לקרן ברירת מחדל היה {mil(total['dt'])}. fox מנכה אותו מהניוד התחרותי; פרסום שאינו מנכה יראה את הזוכה במכרז גבוה יותר.",
        f"סגירה ומיזוג של מסלולים: {mil(total['cl'])} ב-{ym(p)}, מנוכים מהניוד התחרותי.",
        "המדד: ניוד (העברות בין גופים) מול צבירה (הפקדות פחות משיכות, ועוד ניוד). שני מספרים שונים לאותו גוף באותו חודש.",
        f"גרסת הנתונים: הרשות מעדכנת את קבצי החודש. fox קיבל את {ym(p)} ב-{dmy(received)}; כל גרסה של המכתב נושאת את יום הבנייה." if received else
        "גרסת הנתונים: הרשות מעדכנת את קבצי החודש; כל גרסה של המכתב נושאת את יום הבנייה.",
    ]
    return {"fox": D_, "compare": compare}


# ------------------------------------------------------------------------------------------------------------------------------ versions
def changes(old, new):
    """the figures that moved between two bodies (label, before, after), in the order of the new letter"""
    a, b = old.get("figs", {}), new.get("figs", {})
    out = []
    for k, (l, v) in b.items():
        w = a.get(k, [l, None])[1]
        if w != v:
            out.append({"k": k, "l": l, "a": w, "b": v})
    for k, (l, w) in a.items():
        if k not in b:
            out.append({"k": k, "l": l, "a": w, "b": None})
    return out


def letter(d, today, p=None):
    """(files to write {relpath: doc}, the letter): the current letter of month p, a new version only when its body changed"""
    B = body(d, p)
    p = B["p"]
    h = sha(B)
    path = f"{LETTERS}/{p}.json"
    prev = load(d, path) if (d / path).exists() else None
    files = {}
    if prev and prev["hash"] == h:
        L = prev
    else:
        ver = prev["ver"] + 1 if prev else 1
        versions = list(prev["versions"]) if prev else []
        ch = []
        if prev:
            files[f"{LETTERS}/{p}.v{prev['ver']}.json"] = prev           # the superseded version, frozen as it was
            ch = changes(prev["body"], B)
        versions.append({"ver": ver, "built": today, "hash": h, "changes": ch})
        L = {"v": V, "p": p, "ver": ver, "built": today, "hash": h, "permalink": f"{SITE}/flows/letter/{p}?v={ver}", "versions": versions, "body": B}
    files[path] = L
    return files, L


def index(d, cur):
    """every letter on disk (the current one from memory) and the feed events, one per letter month"""
    seen = {}
    dd = d / LETTERS
    if dd.exists():
        for f in sorted(dd.glob("[0-9]*.json")):
            if ".v" in f.stem:
                continue
            x = json.loads(f.read_text(encoding="utf-8"))
            seen[x["p"]] = x
    seen[cur["p"]] = cur
    rows, events = [], []
    for p in sorted(seen, reverse=True):
        x = seen[p]
        B = x["body"]
        rows.append({"p": p, "ver": x["ver"], "built": x["built"], "first": x["versions"][0]["built"], "hash": x["hash"], "h": B["headline"][0]})
        events.append({"id": f"letter:{p}", "t": "letter", "d": B["received"] or x["versions"][0]["built"], "dk": "fetched", "c": "market", "per": str(p),
                       "h": f"מכתב התזרימים {ym(p)}: " + B["headline"][0], "src": {"k": "reg", "ym": p}, "to": f"/flows/letter/{p}"})
    return {"v": V, "latest": max(seen), "letters": rows, "events": events,
            "contract": "feed.json events (build_feed.py docstring): type `letter`, one per regulator month; build_feed merges `events` like fragility.json"}


def build(d=D, today=None):
    today = today or dt.date.today().isoformat()
    files, L = letter(d, today)
    files[f"{LETTERS}/index.json"] = index(d, L)
    return files, L


def write(d, files):
    """write what changed; a superseded version's snapshot is written once and never rewritten"""
    (d / LETTERS).mkdir(parents=True, exist_ok=True)
    wrote = []
    for p, doc in files.items():
        q = d / p
        b = dumps(doc).encode("utf-8")
        if ".v" in q.stem and q.exists():
            continue
        if not q.exists() or q.read_bytes() != b:
            q.write_bytes(b)
            wrote.append(p)
    return wrote


def verify(d=D):
    """problems: every snapshot recorded by a letter exists and hashes to the version's hash; versions are 1..n; the body hashes"""
    bad = []
    dd = d / LETTERS
    for f in sorted(dd.glob("[0-9]*.json")) if dd.exists() else []:
        x = json.loads(f.read_text(encoding="utf-8"))
        if ".v" in f.stem:
            continue
        if sha(x["body"]) != x["hash"]:
            bad.append(f"{f.name}: body does not hash to {x['hash'][:12]}")
        vs = x["versions"]
        if [v["ver"] for v in vs] != list(range(1, x["ver"] + 1)) or vs[-1]["hash"] != x["hash"]:
            bad.append(f"{f.name}: versions are not 1..{x['ver']} ending at the current hash")
        for v in vs[:-1]:
            s = dd / f"{x['p']}.v{v['ver']}.json"
            if not s.exists():
                bad.append(f"{f.name}: snapshot v{v['ver']} missing")
                continue
            y = json.loads(s.read_text(encoding="utf-8"))
            if y["hash"] != v["hash"] or sha(y["body"]) != v["hash"]:
                bad.append(f"{s.name}: snapshot does not hash to version {v['ver']}")
        B = x["body"]
        for pr in B["prods"]:
            t = pr["tot"]
            if None not in (t["tr"], t["comp"], t["dt"], t["cl"]) and abs(t["tr"] - (t["comp"] + t["dt"] + t["cl"])) > 0.051 * 3:
                bad.append(f"{f.name}: {pr['id']} tr ≠ comp + dt + cl")
    return bad


def main(argv):
    if "--check" in argv:
        files, L = build(today=None)
        # a check never cuts a version: compare what is on disk with a rebuild of the same body
        diff = []
        cur = D / f"{LETTERS}/{L['p']}.json"
        if not cur.exists():
            diff.append(f"{LETTERS}/{L['p']}.json missing")
        else:
            disk = json.loads(cur.read_text(encoding="utf-8"))
            if disk["hash"] != sha(body(D)):
                diff.append(f"{LETTERS}/{L['p']}.json: the inputs changed since it was built (run build_flows_letter.py: a new version)")
            ix = D / f"{LETTERS}/index.json"
            if not ix.exists() or json.loads(ix.read_text(encoding="utf-8")) != index(D, disk):
                diff.append(f"{LETTERS}/index.json differs from a rebuild")
        bad = verify(D)
        for x in diff + bad:
            print("  " + x)
        ok = not diff and not bad
        print(("flows letter ok: " if ok else "flows letter FAILED: ") + f"{ym(L['p'])} v{L['ver']}, {len(bad)} integrity, {len(diff)} stale")
        return 0 if ok else 1
    files, L = build()
    wrote = write(D, files)
    bad = verify(D)
    for x in bad:
        print("  " + x)
    print(f"flows letter {ym(L['p'])}: version {L['ver']} (built {dmy(L['built'])}, hash {L['hash'][:12]}); wrote {len(wrote)} file(s)"
          + "".join(f"\n  {x}" for x in L["body"]["headline"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
