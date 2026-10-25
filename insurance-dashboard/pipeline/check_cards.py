"""The digit validator of the report cards (lane S2): every digit a card shows maps to a published fact.

python3 pipeline/check_cards.py [--quiet]     (standard library only; pipeline/gate.py runs it as the `cards` check)

For every web/public/data/cards/<company>/<period>.json:
  1. literal text (the lead's template strings, row and target labels, basis labels, top restatement lines) carries no digit, except the
     fixed terms in ALLOWED: every number on the card is a token, {"f": fact id} (or a period, date or year token, checked by form);
  2. every fact's text is its value formatted by the one formatter (build_cards.fmt): no hand-typed digit;
  3. every printed fact equals the published figure its `ref` names, re-read from the published file (statements workbook, CSM ledger
     through csm_resolve, the report's IFRS 17 facts, the Peer Table cells, targets.json, the workbook's restatement pairs, kpi.json);
  4. every computed fact equals its operation over its inputs (difference, percent, multiple, sum, ROE, NB ÷ release), and every count
     equals a recount.
Exit 1 on any miss; the last line says "<n> cards, <m> facts, <k> problems".
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cards as bc  # noqa: E402
import csm_resolve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
CARDS = DATA / "cards"
DIGIT = re.compile(r"[0-9]")
ALLOWED = re.compile(r"IFRS 17|IFRS 4|2% ומעלה")  # fixed terms of the templates: standards' names, Report Day's 2% threshold
PERIOD = re.compile(r"^\d{4}(Q[1-4]|FY)$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TOL = 1e-6


class Pub:
    """The published files, read once."""

    def __init__(self):
        self.cache = {}

    def j(self, rel):
        if rel not in self.cache:
            p = DATA / rel
            self.cache[rel] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
        return self.cache[rel]

    def wb(self, c):
        key = f"wb:{c}"
        if key not in self.cache:
            d = self.j(f"companies/{c}.json")
            self.cache[key] = {(f[0], f[1]): f[2] for f in d["facts"]} if d else {}
        return self.cache[key]

    def ledger(self, c):
        d = self.j(f"csm/facts/{c}.json")
        return [(p, [f for f in F if f["c"] == c]) for p, F in d["reports"].items()] if d else []


def texts(card):
    """every literal string the card renders that is not a published label (those are checked against their source in check())"""
    for line in card.get("lead", []):
        for tok in line:
            if isinstance(tok, str):
                yield "lead", tok
    for r in card.get("rows", []):
        yield "row", r.get("l", "")
        if r.get("basis"):
            yield "basis", r["basis"]


def tokens(card):
    for line in card.get("lead", []):
        for tok in line:
            if isinstance(tok, dict):
                yield tok


def published(pub, card, fid, f):
    """the published figure a printed fact names, or a reason it cannot be found"""
    c, ref = card["c"], f["s"].get("ref") or {}
    l = ref.get("l")
    if l == "wb":
        v = pub.wb(c).get((ref["mi"], ref["pi"]))
        return None if v is None else v / 1000
    if l == "csm":
        x = csm_resolve.resolve(pub.ledger(c), csm_resolve.own_period(ref["d"]), ref["d"])
        if not x:
            return None
        if not x["sum"]:
            return x["v"]
        g = x["fs"][ref["i"]]
        return abs(g["dv"] if g.get("dv") is not None else g["v"])
    if l == "ifrs":
        for g in pub.j(f"ifrs_{ref['p']}.json") or []:
            if g["c"] == c and g["m"] == ref["m"] and g["d"] == ref["d"] and g.get("pg") == ref["pg"] and g["s"] == ref["s"] and g.get("w") == ref.get("w", "instant") \
                    and not g.get("tr") and not g.get("model") and not g.get("bk") and abs(g["v"] - f["v"]) <= TOL:
                return g["v"]
        return None
    if l == "peer":
        d = pub.j(f"peers/m/ifrs-{ref['f']}.json")
        cell = next((x for x in (d or {}).get("e", {}).get(c, {}).get("c", []) if x[0] == ref["k"]), None)
        if not cell:
            return None
        return cell[6][ref["i"]][1] if "i" in ref else cell[1]
    if l == "tg":
        t = pub.j("targets.json")["rows"][ref["i"]]
        if t["c"] != c:
            return None
        return t["act"]["v"] if ref["x"] == "act" else t.get(ref["x"])
    if l == "tgin":
        t = pub.j("targets.json")["rows"][ref["i"]]
        return t["act"]["in"][ref["j"]][1] if t["c"] == c and t.get("act") else None
    if l == "rest":
        r = pub.j(f"companies/{c}.json")["restated"][ref["i"]]
        return (r[5] if ref["x"] == 0 else r[8]) / 1000
    if l == "kpi":
        k = pub.j("kpi.json")["companies"][c]
        i = k["periods"].index(ref["p"])
        v = k["values"][ref["key"]][i]
        return None if v is None else v / 1000
    return None


def recount(pub, card, ref):
    if ref["q"] == "facts":
        return sum(1 for f in card["f"].values() if f["s"]["k"] == "pg")
    rest = [r for r in pub.j(f"companies/{card['c']}.json").get("restated") or [] if r[11] == card["end"]]
    if ref["q"] == "rest":
        return len(rest)
    if ref["q"] == "rest_big":
        return sum(1 for r in rest if r[5] == 0 or abs(r[8] - r[5]) / abs(r[5]) >= bc.BIG / 100)
    return None


def computed(card, f):
    s, F = f["s"], card["f"]
    ins = [F[x]["v"] for x in s["in"]]
    op = s["op"]
    if op == "diff":
        return ins[0] - ins[1]
    if op == "pct":
        return (ins[0] / ins[1] - 1) * 100
    if op == "ratio":
        return ins[0] / ins[1]
    if op == "sum":
        return sum(ins)
    if op == "roe":
        return ins[0] / ((ins[1] + ins[2]) / 2) * 100
    if op == "nbrel":
        return ins[0] / ins[1] * 100
    return None


def check(card, pub):
    probs = []
    c, p = card["c"], card["p"]
    for where, s in texts(card):
        if DIGIT.search(ALLOWED.sub("", s)):
            probs.append(f"{c} {p}: a digit in literal {where} text: {s!r}")
    for tok in tokens(card):
        if "f" in tok and tok["f"] not in card["f"]:
            probs.append(f"{c} {p}: token names no fact: {tok['f']}")
        if "p" in tok and not PERIOD.match(str(tok["p"])):
            probs.append(f"{c} {p}: bad period token {tok['p']}")
        if "d" in tok and not DATE.match(str(tok["d"])):
            probs.append(f"{c} {p}: bad date token {tok['d']}")
        if "pl" in tok and not (tok["pl"][0] in ("Q", "H", "9M", "FY", "I") and DATE.match(tok["pl"][1])):
            probs.append(f"{c} {p}: bad period-label token {tok['pl']}")
    # labels shown as published: a target's name, entity and horizon are targets.json's; a restated line is the workbook's
    rows_tg = pub.j("targets.json")["rows"]
    for t in card.get("tg", []):
        src = rows_tg[t["i"]] if 0 <= t.get("i", -1) < len(rows_tg) else {}
        if src.get("c") != c or t["l"] != src.get("l") or t["e"] != (src.get("e") or "") or t.get("h") != (src.get("h") or None):
            probs.append(f"{c} {p}: target {t.get('l')!r} is not targets.json row {t.get('i')}")
    restated = pub.j(f"companies/{c}.json").get("restated") or []
    for t in (card.get("rest") or {}).get("top", []):
        r = restated[t["i"]] if 0 <= t.get("i", -1) < len(restated) else None
        if not r or t["l"] != r[2] or t["pl"] != [r[3], r[4]]:
            probs.append(f"{c} {p}: restated line {t.get('l')!r} is not the workbook's pair {t.get('i')}")
    for fid, f in card["f"].items():
        if f["t"] != bc.fmt(f["v"], f["u"]):
            probs.append(f"{c} {p} {fid}: text {f['t']!r} is not {bc.fmt(f['v'], f['u'])!r}")
        k = f["s"]["k"]
        if k in ("pg", "xbrl"):
            v = published(pub, card, fid, f)
            if v is None or abs(v - f["v"]) > TOL * max(1, abs(v)):
                probs.append(f"{c} {p} {fid}: {f['v']} not found in the published files ({f['s'].get('ref')}: {v})")
        elif k == "calc":
            if f["s"]["op"] == "tgact":  # the actual build_targets.py computed: the published figure itself, with its inputs
                v = published(pub, card, fid, {"s": {"ref": f["s"]["ref"]}, "v": f["v"]})
            else:
                v = computed(card, f)
            if v is None or abs(v - f["v"]) > 1e-4 * max(1, abs(v)):
                probs.append(f"{c} {p} {fid}: {f['v']} is not {f['s']['op']} of its inputs ({v})")
        elif k == "count":
            v = recount(pub, card, f["s"]["ref"])
            if v != f["v"]:
                probs.append(f"{c} {p} {fid}: count {f['v']} vs recount {v}")
        else:
            probs.append(f"{c} {p} {fid}: unknown source kind {k}")
    return probs


def run(quiet=False):
    pub = Pub()
    idx = json.loads((CARDS / "index.json").read_text(encoding="utf-8")) if (CARDS / "index.json").exists() else None
    if not idx:
        return 0, 0, ["no cards/index.json"]
    n = nf = 0
    probs = []
    for c, e in idx["co"].items():
        for p in e["p"]:
            f = CARDS / c / f"{p}.json"
            if not f.exists():
                probs.append(f"{c} {p}: listed in the index, file missing")
                continue
            card = json.loads(f.read_text(encoding="utf-8"))
            n += 1
            nf += len(card["f"])
            probs += check(card, pub)
    listed = {(c, p) for c, e in idx["co"].items() for p in e["p"]}
    for f in CARDS.glob("*/*.json"):
        if (f.parent.name, f.stem) not in listed:
            probs.append(f"{f.parent.name} {f.stem}: card file not in the index")
    if not quiet:
        for x in probs[:40]:
            print(x)
    return n, nf, probs


if __name__ == "__main__":
    n, nf, probs = run("--quiet" in sys.argv)
    print(f"{n} cards, {nf} facts, {len(probs)} problems")
    sys.exit(1 if probs else 0)
