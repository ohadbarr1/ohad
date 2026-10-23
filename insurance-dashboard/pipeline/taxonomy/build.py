"""Build the line taxonomy from the workbooks: one id per workbook row (metric), the taxonomy entries, the coverage report.

Input: the workbooks of the extraction merge (build_workbook.merge()) with their row meta and every caption each statement row was printed under.
Output: (ids, entries, coverage, registry)
  ids       {company: {metric index: (line id, tier, block, occurrence)}}
  entries   {line id: {label, stmt, block, tier, unit, nature, tadd, sadd, std, bridge, cos, n}}
  coverage  rows and facts by tier, per company and per kind, and the unmapped tail
  registry  {"v", "alias": {alias key: line id}}: every normalised caption ever registered, so an id never moves (append-only)
"""
import collections
import re

from . import rules

ST_NAME = {"income": "pl", "oci": "oci", "balance": "bs", "cashflow": "cf"}


class UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)


def stmt_of(sheet):
    if sheet in rules.STMT_OF_SHEET:
        return rules.STMT_OF_SHEET[sheet]
    for rx, st in rules.SHEET_STMT_RE:
        if rx.match(sheet):
            return st
    return None


def build(wbs, meta, caps, registry, nfacts):
    """nfacts {company: {metric index: number of current facts}} (weights for the coverage report)."""
    reg_alias = dict(registry.get("alias", {}))
    rows = []  # statement-like rows: dict(co, mi, stmt, block, std, sheet, caps (newest first), label, unit, role, total)
    ids = collections.defaultdict(dict)
    entries = {}
    series_rows, note_rows = [], []
    for co in sorted(wbs):
        d = wbs[co]
        M = d["metrics"]
        by_sheet = collections.defaultdict(list)
        for i, m in enumerate(M):
            by_sheet[m["sheet"]].append(i)
        for sheet, idx in by_sheet.items():
            st = stmt_of(sheet)
            if st is None:
                for i in idx:
                    if M[i]["header"] and not nfacts.get(co, {}).get(i):
                        continue
                    mt = meta.get(co, {}).get(i)
                    (series_rows if mt and mt[0] == "se" else note_rows).append((co, i, mt))
                continue
            # one block per accounting standard (a std header row starts each); the Phoenix spreadsheet sheets are one block
            parts, cur = [], []
            for i in idx:
                if M[i].get("std"):
                    if cur:
                        parts.append(cur)
                    cur = []
                    continue
                cur.append(i)
            if cur:
                parts.append(cur)
            for part in parts:
                blks = rules.blocks(st, [{"label": M[i]["label"], "header": M[i]["header"], "unit": M[i]["unit"]} for i in part])
                for i, blk in zip(part, blks):
                    m = M[i]
                    if m["header"] and not nfacts.get(co, {}).get(i):  # a caption with figures of its own is a line too
                        continue
                    mt = meta.get(co, {}).get(i)
                    std = (mt[2] if mt and mt[0] == "st" else "IFRS 17").replace("IFRS ", "")
                    cs = [m["label"]]
                    if mt and mt[0] == "st":
                        extra = caps.get((co, mt[1], mt[2], mt[3]), set())
                        cs += sorted(c for c in extra if c != m["label"])
                    rows.append({"co": co, "mi": i, "stmt": st, "block": blk, "std": std, "sheet": sheet, "caps": cs, "label": m["label"],
                                 "unit": m["unit"], "role": m.get("role"), "total": bool(m.get("total")), "ent": m.get("entity", "F")})

    # ---- core lines: one row per company, sheet and standard block for each core id (the row the workbook gave that role, else the first)
    core_of = {}
    taken = set()
    role_mismatch = []
    order = sorted(range(len(rows)), key=lambda k: (0 if rows[k]["role"] and rules.ROLE_ID.get(rows[k]["role"]) else 1, k))
    for k in order:
        r = rows[k]
        # the row the workbook gave a role is that core line when the curated pattern agrees; a role the pattern rejects (the
        # workbook's caption match is looser) is counted and the row is matched like any other
        cid = rules.ROLE_ID.get(r["role"]) if r["role"] else None
        if cid is not None and rules.core_match(r["stmt"], r["block"], r["caps"], only=cid) is None:
            role_mismatch.append(f"{r['co']}: {r['role']} = {r['label']}")
            cid = None
        if cid is None:
            cid = rules.core_match(r["stmt"], r["block"], r["caps"])
        if cid is None:
            continue
        slot = (r["co"], r["sheet"], r["std"], cid)
        if slot in taken:
            continue
        taken.add(slot)
        core_of[k] = cid

    # ---- shared / own: normalised captions within a statement block; a caption a company prints twice in one block is generic
    def keys_of(r):
        return sorted({f"{r['stmt']}|{r['block']}|{rules.tnorm(c)}" for c in r["caps"] if rules.tnorm(c)})
    per_block = collections.defaultdict(collections.Counter)
    rkeys = []
    for r in rows:
        ks = keys_of(r)
        rkeys.append(ks)
        for kk in ks:
            per_block[(r["co"], r["sheet"], r["std"])][kk] += 1
    # generic per company: a caption a company prints twice in one block carries no identity for that company's rows; other companies
    # that print it once still meet on it
    generic = {(blk, kk) for blk, c in per_block.items() for kk, n in c.items() if n > 1}

    def good_keys(k):
        r = rows[k]
        return [kk for kk in rkeys[k] if ((r["co"], r["sheet"], r["std"]), kk) not in generic]
    uf = UF()
    for k in range(len(rows)):
        good = good_keys(k)
        for kk in good:
            uf.find(kk)
        for a, b in zip(good, good[1:]):
            uf.union(a, b)
    # history: captions once registered under one id stay together
    by_old = collections.defaultdict(list)
    for kk, lid in reg_alias.items():
        if kk in uf.p:
            by_old[lid].append(kk)
    for lid, kks in by_old.items():
        for a, b in zip(kks, kks[1:]):
            uf.union(a, b)
    group_rows = collections.defaultdict(list)
    for k in range(len(rows)):
        good = good_keys(k)
        if good:
            group_rows[uf.find(good[0])].append(k)
    group_keys = collections.defaultdict(set)
    for kk in uf.p:
        group_keys[uf.find(kk)].add(kk)
    conflicts = 0
    assigned = {}
    for g, ks in group_rows.items():
        cores = sorted({core_of[k] for k in ks if k in core_of})
        if len(cores) > 1:
            conflicts += 1
        olds = sorted({reg_alias[kk] for kk in group_keys[g] if kk in reg_alias and reg_alias[kk].count(".") == 2})  # earlier auto ids
        if len(cores) == 1:
            gid = cores[0]
        elif olds:
            gid = olds[0]
        else:
            first = min(group_keys[g])
            st, blk, _ = first.split("|", 2)
            gid = f"{st}.{blk}.{rules.h6(first)}"
        for k in ks:
            assigned[k] = core_of.get(k) if (len(cores) > 1 and k in core_of) else gid
        for kk in group_keys[g]:
            if gid.count(".") == 2 or len(cores) == 1:
                reg_alias.setdefault(kk, gid)
    for k in core_of:
        assigned.setdefault(k, core_of[k])
    # rows with only generic captions: an id of their own, stable within the company (caption and its occurrence in the block)
    occ = collections.Counter()
    for k, r in enumerate(rows):
        if k in assigned:
            continue
        kk = rkeys[k][0] if rkeys[k] else f"{r['stmt']}|{r['block']}|"
        occ[(r["co"], r["sheet"], r["std"], kk)] += 1
        assigned[k] = f"{r['stmt']}.{r['block']}.{rules.h6(r['co'] + '|' + kk + '|' + str(occ[(r['co'], r['sheet'], r['std'], kk)]))}"
    # one id once per company, sheet and standard block: a second row that reached the same id (two captions joined through other
    # companies) keeps an id of its own
    seen = collections.Counter()
    collisions = 0
    for k in range(len(rows)):
        r = rows[k]
        slot = (r["co"], r["sheet"], r["std"], r["ent"], assigned[k])
        seen[slot] += 1
        if seen[slot] > 1:
            collisions += 1
            assigned[k] = f"{assigned[k]}~{seen[slot]}"

    # ---- entries for statement lines
    cos_of = collections.defaultdict(set)
    for k, r in enumerate(rows):
        cos_of[assigned[k].split("~")[0]].add(r["co"])
    lab_of = collections.defaultdict(collections.Counter)
    for k, r in enumerate(rows):
        lid = assigned[k]
        base = lid.split("~")[0]
        # a second row of one company that reached an id (suffix ~n) has no cross-company identity of its own
        tier = "own" if "~" in lid else "core" if base in rules.CORE_META else ("shared" if len(cos_of[base]) >= 2 else "own")
        ids[r["co"]][r["mi"]] = (lid, tier, r["block"])
        lab_of[lid][r["label"]] += 1
        e = entries.setdefault(lid, {"label": None, "stmt": r["stmt"], "block": r["block"], "tier": tier, "units": collections.Counter(),
                                      "std": set(), "cos": set(), "n": 0, "aliases": set()})
        e["units"][r["unit"]] += 1
        e["std"].add(r["std"])
        e["cos"].add(r["co"])
        e["n"] += 1
        e["aliases"].update(rules.tnorm(c) for c in r["caps"] if rules.tnorm(c))
    for lid, e in entries.items():
        base = lid.split("~")[0]
        e["label"] = rules.CORE_META[base]["label"] if base in rules.CORE_META and "~" not in lid else lab_of[lid].most_common(1)[0][0]

    # ---- series lines (the extractor's metric keys are already stable across companies): n.<metric>
    s_cos = collections.defaultdict(set)
    for co, i, mt in series_rows:
        s_cos[mt[1]].add(co)
    # (the metric key may carry a caption after a colon; the id keeps the key and a hash of the caption)
    for co, i, mt in series_rows:
        m = wbs[co]["metrics"][i]
        base, _, rest = mt[1].partition(":")  # "csm_other:<caption>": the caption the extractor kept is hashed into the id
        lid = f"n.{base}" + (f".{rules.h6(rest.strip())}" if rest.strip() else "")
        tier = "shared" if len(s_cos[mt[1]]) >= 2 else "own"
        ids[co][i] = (lid, tier, mt[3])
        e = entries.setdefault(lid, {"label": m["label"], "stmt": "n", "block": mt[3], "tier": tier, "units": collections.Counter(), "std": set(),
                                      "cos": set(), "n": 0, "aliases": {mt[1]}, "series": mt[1]})
        e["units"][m["unit"]] += 1
        e["cos"].add(co)
        e["n"] += 1

    # ---- the Phoenix spreadsheet's notes: px.<sheet>.<caption>, an id of the company's own
    seen_px = collections.Counter()
    for co, i, mt in note_rows:
        m = wbs[co]["metrics"][i]
        key = f"{m['sheet']}|{rules.tnorm(m['label'])}|{m.get('dim') or ''}"
        seen_px[(co, key)] += 1
        lid = f"px.{rules.h6(co + '|' + m['sheet'])}.{rules.h6(key + '|' + str(seen_px[(co, key)]))}"
        ids[co][i] = (lid, "own", m["group"])
        e = entries.setdefault(lid, {"label": m["label"], "stmt": "px", "block": m["group"], "tier": "own", "units": collections.Counter(), "std": {"17"},
                                      "cos": set(), "n": 0, "aliases": set()})
        e["units"][m["unit"]] += 1
        e["cos"].add(co)
        e["n"] += 1

    # ---- attributes
    for lid, e in entries.items():
        base = lid.split("~")[0]
        unit = e["units"].most_common(1)[0][0]
        nature = rules.CORE_META.get(base, {}).get("nature") if base in rules.CORE_META else None
        lab = e["label"] or ""
        if nature is None:
            if unit == "nis":
                nature = "ps"
            elif unit == "shares":
                nature = "cnt"
            elif unit == "pct":
                nature = "ratio"
            elif e["stmt"] == "bs" or (e["stmt"] == "cf" and rules.NONFLOW.search(lab)) or (e["stmt"] == "n" and rules.STOCK.match(e.get("series", ""))) \
                    or (e["stmt"] == "px" and e["block"] == "balance"):
                nature = "bal"
            else:
                nature = "flow"
        e["unit"] = unit
        e["nature"] = nature
        e["tadd"] = unit == "k" and nature not in ("bal", "ps", "cnt", "ratio") and not rules.NONFLOW.search(lab)
        e["sadd"] = unit == "k"
        if base in rules.BRIDGE:
            to, note = rules.BRIDGE[base]
            e["bridge"] = {"to": to, "kind": "successor" if to else "ended", "note": note}
        elif e["std"] >= {"17", "4"}:
            e["bridge"] = {"to": lid, "kind": "same", "note": "אותה שורה תחת IFRS 4 ו-IFRS 17 (ערכי IFRS 4 כפי שדווחו במקור)"}
    for lid, e in entries.items():  # the IFRS 17 side of a bridge points back
        b = e.get("bridge")
        if b and b["kind"] == "successor" and b["to"] in entries:
            entries[b["to"]].setdefault("bridge_from", []).append(lid)

    # ---- coverage: share of workbook rows (and of current figures) on a cross-company id
    cov = {"rows": collections.Counter(), "facts": collections.Counter(), "by_company": {}, "by_kind": collections.defaultdict(collections.Counter),
           "facts_by_kind": collections.defaultdict(collections.Counter)}
    tail = []
    for co, mm in ids.items():
        c = collections.Counter()
        for i, (lid, tier, blk) in mm.items():
            n = nfacts.get(co, {}).get(i, 0)
            kind = "statements" if lid.split(".")[0] in ("pl", "oci", "bs", "cf") and not wbs[co]["metrics"][i]["sheet"][:2] in ("F.", "I.") else \
                "series" if lid.startswith("n.") else "company sheets"
            cov["rows"][tier] += 1
            cov["facts"][tier] += n
            cov["by_kind"][kind][tier] += 1
            cov["facts_by_kind"][kind][tier] += n
            c[tier] += 1
            if tier == "own":
                tail.append((n, co, wbs[co]["metrics"][i]["sheet"], wbs[co]["metrics"][i]["label"], lid))
        cov["by_company"][co] = dict(c)
    tot = sum(cov["rows"].values())
    totf = sum(cov["facts"].values())
    mapped = cov["rows"]["core"] + cov["rows"]["shared"]
    coverage = {
        "rows": tot, "rows_core": cov["rows"]["core"], "rows_shared": cov["rows"]["shared"], "rows_own": cov["rows"]["own"],
        "mapped_share": round(mapped / tot, 4) if tot else 0,
        "facts": totf, "facts_mapped_share": round((cov["facts"]["core"] + cov["facts"]["shared"]) / totf, 4) if totf else 0,
        "by_kind": {k: dict(v) for k, v in sorted(cov["by_kind"].items())},
        "facts_by_kind": {k: dict(v) for k, v in sorted(cov["facts_by_kind"].items())},
        "by_company": dict(sorted(cov["by_company"].items())),
        "lines": {"core": sum(1 for e in entries.values() if e["tier"] == "core"), "shared": sum(1 for e in entries.values() if e["tier"] == "shared"),
                  "own": sum(1 for e in entries.values() if e["tier"] == "own")},
        "core_ids_unused": sorted(set(rules.CORE_META) - {lid.split("~")[0] for lid in entries}),
        "conflicts": conflicts, "collisions": collisions, "role_mismatch": role_mismatch,
        "tail": [{"co": co, "sheet": sh, "label": lab, "id": lid, "facts": n} for n, co, sh, lab, lid in sorted(tail, key=lambda t: (-t[0], t[1], t[4]))[:60]],
    }
    registry = {"v": 1, "alias": dict(sorted(reg_alias.items()))}
    return ids, entries, coverage, registry
