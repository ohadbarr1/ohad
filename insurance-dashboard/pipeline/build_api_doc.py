"""The open JSON files as a de-facto API: web/src/lib/apiFamilies.json (read by /data/api, pages/Api.tsx) and docs/API.md (its mirror).

Every file family under web/public/data, from the data contracts (web/src/lib/schemas.json `files`, first match wins) and, for files
without a contract, the path with its variable parts as `*`. For each family: the path pattern, the schema id, the DAG step that writes
it (pipeline/dag.py) and the step's note, the update cadence (from the step: the regulator's monthly files, a filing, every build), the
provenance fields its schema names (pg, url, rid, src, ...), an example file and, in API.md, the start of its first record. Feeds (RSS,
Atom, ICS), the model workbooks (xlsx) and the contracts file are listed beside them, with the terms and the changelog of breaking
changes (CHANGELOG below: add a line, with the date, whenever a key is renamed or removed, a unit changes or a file moves).

python3 pipeline/build_api_doc.py           write both files
python3 pipeline/build_api_doc.py --check   every family on disk is documented and both files are current (tests/test_api_doc.py)
"""
import fnmatch
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dag  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
PUB = ROOT / "web" / "public"
SPEC = ROOT / "web" / "src" / "lib" / "schemas.json"
OUT_JSON = ROOT / "web" / "src" / "lib" / "apiFamilies.json"
OUT_MD = ROOT / "docs" / "API.md"
SITE = "https://fox-research-il.web.app"
PROV = {"pg", "page", "pages", "u", "url", "urls", "url2", "pg2", "rid", "r", "doc", "docs", "src", "source", "report_id", "file", "files", "prov", "vint",
        "fs", "in", "st0", "st1", "der", "cmp", "std", "fetched", "built", "asof", "generated", "provenance", "ref", "refs"}
INTERNAL = ("search/ft/", "search/text/", "search/facts/", "prov/reg/", "feed_seen.json", "answers_history.json", "qa.json", "consistency.json", "autopilot/")
REG_STEPS = {"build_market", "build_funds", "build_fund_stats", "build_flows", "build_lens", "build_roster", "build_recon", "build_warroom", "build_flow_npv",
             "build_decision", "build_market_home", "build_regulation"}
CHANGELOG = [  # date, kind (added / breaking / changed), what
    ("2026-11-02", "added", "xlsx/<company>.xlsx: one model-ready workbook per company (P&L, Balance sheet, IFRS 17, Solvency, Savings, KPIs, Sources)."),
    ("2026-11-02", "added", "consensus.json: published sell-side price targets and recommendations, each with its source URL (schema `consensus`)."),
    ("2026-11-02", "added", "This page and docs/API.md. No changelog was kept before this date: the contracts in schemas.json as of this date are the baseline."),
]
TERMS = ("Free to use, including commercially. Cite fox (with a link to the page or file) and the primary source the record names: the MAYA filing "
         "and page, or the regulator's dataset. Fundamentals only: no share prices are published (the valuation pages take a manual price input). "
         "The files are static and refreshed by the pipeline; there is no key and no rate limit, but please cache: every file is served with a short "
         "max-age. No warranty: check the figure against the cited page before relying on it.")
FEEDS = [
    ("/feed.xml", "RSS 2.0", "the delta feed: every new filing figure, restatement, target, regulator month (feed.json as RSS)"),
    ("/feed.atom", "Atom", "the same feed as Atom"),
    ("/feed/<company>.xml", "RSS 2.0", "one company's events (also .atom)"),
    ("/feed/months.xml", "RSS 2.0", "the regulator's monthly files as they land (also .atom)"),
    ("/feed/funds.xml", "RSS 2.0", "fund and track events (also .atom)"),
    ("/feed/market.xml", "RSS 2.0", "market-level events (also .atom)"),
    ("/data/calendar.ics", "iCalendar", "every expected filing date (calendar.json as ICS)"),
    ("/data/cal/<company>.ics", "iCalendar", "one company's expected filing dates"),
    ("/data/xlsx/<company>.xlsx", "XLSX", "the model-ready workbook of a company: metrics x periods Q1'23 ... Q2'26 + FY, every value with its document, page and link (Sources sheet)"),
    ("/data/schemas.json", "JSON Schema", "the data contracts: the schema of every contracted family below"),
]


def spec():
    return json.loads(SPEC.read_text(encoding="utf-8"))


def pat_re(p):
    return re.compile("^" + re.escape(p).replace(r"\*", "[^/]*") + "$")


def files_on_disk():
    out = []
    for d, dirs, fs in os.walk(DATA):
        dirs[:] = sorted(x for x in dirs if not x.startswith("."))
        for f in sorted(fs):
            if not f.startswith("."):
                out.append(os.path.relpath(os.path.join(d, f), DATA).replace(os.sep, "/"))
    return sorted(out)


def family_of(rel, pats):
    for p, r, s in pats:
        if r.match(rel):
            return p, s
    parts = rel.split("/")
    gen = ["*" if re.fullmatch(r"\d+", x) else x for x in parts[:-1]]
    ext = os.path.splitext(parts[-1])[1]
    return ("/".join(gen + [f"*{ext}"]) if len(parts) > 1 else rel), None


def step_of(rel):
    path = "web/public/data/" + rel
    for s in dag.STEPS:
        for o in s["outputs"] + s["edits"]:
            if any(ch in o for ch in "*?[") and fnmatch.fnmatch(path, o):
                return s
            if path == o or path.startswith(o.rstrip("/") + "/"):
                return s
    return None


def cadence(s, rel=""):
    if rel in ("qa.json", "consistency.json"):
        return "every deploy (pipeline/gate.py)"
    if not s:
        return "outside the DAG (its own script, on demand)"
    n = s["name"]
    if s["daily"]:
        return "every build (date-dependent)"
    if n in REG_STEPS:
        return "monthly (regulator files, data.gov.il)"
    if n in ("build_macro", "build_boi_curve"):
        return "monthly (Bank of Israel, CBS)"
    if n in ("fetch_prices",):
        return "manual (valuation input only)"
    if n in ("build_ownership", "build_debt"):
        return "on each MAYA form"
    if n in ("build_consensus",):
        return "by hand, when a target is published"
    return "quarterly, on each filing (MAYA)"


def prov_fields(schema, defs, depth=0, seen=None):
    seen = seen if seen is not None else set()
    out = set()
    if depth > 6 or not isinstance(schema, dict):
        return out
    if "$ref" in schema:
        k = schema["$ref"].split("/")[-1]
        if k in seen:
            return out
        seen.add(k)
        return prov_fields(defs.get(k, {}), defs, depth + 1, seen)
    for k, v in (schema.get("properties") or {}).items():
        if k in PROV:
            out.add(k)
        out |= prov_fields(v, defs, depth + 1, seen)
    for key in ("items", "additionalProperties"):
        if isinstance(schema.get(key), dict):
            out |= prov_fields(schema[key], defs, depth + 1, seen)
    return out


def sample(rel, limit=600):
    p = DATA / rel
    if p.suffix != ".json":
        return None
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    def first(x, depth=0):
        """the first record: the first item of the first list, or the object trimmed to its first keys"""
        if isinstance(x, list):
            return [first(x[0], depth + 1)] if x else []
        if isinstance(x, dict) and depth < 3:
            return {k: first(v, depth + 1) for k, v in list(x.items())[:8]}
        return x

    if isinstance(d, dict):  # a file of records: its scalar header keys and the first record of its first list of records
        recs = next(((k, v) for k, v in d.items() if isinstance(v, list) and v and isinstance(v[0], (dict, list))), None)
        if recs:
            head = {k: v for k, v in d.items() if not isinstance(v, (dict, list))}
            d = {**dict(list(head.items())[:4]), recs[0]: [recs[1][0]]}
    s = json.dumps(first(d), ensure_ascii=False, separators=(",", ":"))
    return s if len(s) <= limit else s[:limit] + "…"


def families():
    S = spec()
    pats = [(f["pattern"], pat_re(f["pattern"]), f["schema"]) for f in S["files"]]
    fam = {}
    for rel in files_on_disk():
        p, s = family_of(rel, pats)
        x = fam.setdefault(p, {"pattern": p, "schema": s, "files": 0, "example": rel})
        x["files"] += 1
    out = []
    for p, x in sorted(fam.items()):
        st = step_of(x["example"])
        out.append({
            "pattern": p, "schema": x["schema"], "example": x["example"], "files": x["files"], "kind": "internal" if p.startswith(INTERNAL) else "open",
            "format": os.path.splitext(x["example"])[1].lstrip(".") or "file",
            "step": st["name"] if st else None, "note": (st or {}).get("note") or "", "cadence": cadence(st, x["example"]),
            "prov": sorted(prov_fields(S["$defs"].get(x["schema"], {}), S["$defs"])) if x["schema"] else [],
        })
    return out


def render_json(fams):
    return json.dumps({"site": SITE, "terms": TERMS, "feeds": [list(f) for f in FEEDS], "changelog": [list(c) for c in CHANGELOG], "families": fams},
                      ensure_ascii=False, indent=1) + "\n"


def render_md(fams):
    L = ["# fox data API", "",
         "<!-- generated by pipeline/build_api_doc.py from web/src/lib/schemas.json, pipeline/dag.py and the files under web/public/data; "
         "edit the script, not this file. The same content is the page /data/api. -->", "",
         f"fox publishes every figure it shows as static JSON under `{SITE}/data/`. There is no server: a file is the API. Each family below has "
         "a path pattern, a data contract (JSON Schema in `/data/schemas.json`, checked on every build by `pipeline/check_schemas.py`), the "
         "pipeline step that writes it, how often it changes and the fields that carry its provenance (page, URL, report id).", "",
         "## Terms", "", TERMS, "",
         "## Provenance fields", "",
         "`pg` / `page`: the page in the source PDF · `u` / `url` / `urls`: the source file (a MAYA PDF, `#page=` jumps to the page) · `rid` / `r` / "
         "`report_id`: the MAYA report id (`https://maya.tase.co.il/he/reports/<id>`) · `doc` / `docs` / `files`: a document registry the rows "
         "index into · `src`: the source kind or URL · `std`: IFRS 4 / IFRS 17 · `cmp`: a comparative figure from a later report · `der`: derived "
         "(Q4 = FY − 9M) · `vint`: the vintages (every report that printed a figure) · `fetched` / `built` / `asof`: when it was read.", "",
         "## Feeds and downloads", "", "| Path | Format | What |", "|---|---|---|"]
    L += [f"| `{p}` | {f} | {w} |" for p, f, w in FEEDS]
    L += ["", "## Changelog", "", "A breaking change (a key renamed or removed, a unit changed, a file moved) is listed here with its date; the contract in "
          "schemas.json changes in the same commit.", "", "| Date | Kind | Change |", "|---|---|---|"]
    L += [f"| {d} | {k} | {w} |" for d, k, w in CHANGELOG]
    for kind, title in (("open", "Open data families"), ("internal", "Internal files (search index, provenance shards, build logs)")):
        L += ["", f"## {title}", ""]
        for f in (x for x in fams if x["kind"] == kind):
            L += [f"### `{f['pattern']}`", "",
                  f"- schema: {'`' + f['schema'] + '`' if f['schema'] else 'none (no contract yet)'} · files: {f['files']} · format: {f['format']}",
                  f"- written by: {'`' + f['step'] + '`' if f['step'] else 'by hand / outside the DAG'} · cadence: {f['cadence']}",
                  f"- example: [{SITE}/data/{f['example']}]({SITE}/data/{f['example']})"]
            if f["prov"]:
                L.append(f"- provenance fields: {', '.join('`' + p + '`' for p in f['prov'])}")
            if f["note"]:
                L.append(f"- note: {f['note']}")
            if kind == "open":
                s = sample(f["example"])
                if s:
                    L += ["", "```json", s, "```"]
            L.append("")
    return "\n".join(L).rstrip() + "\n"


def main():
    fams = families()
    j, m = render_json(fams), render_md(fams)
    if "--check" in sys.argv:
        probs = []
        doc = json.loads(OUT_JSON.read_text(encoding="utf-8")) if OUT_JSON.exists() else {"families": []}
        have = {f["pattern"] for f in doc["families"]}
        miss = [f["pattern"] for f in fams if f["pattern"] not in have]
        if miss:
            probs.append(f"undocumented families: {miss[:8]}")
        if not OUT_MD.exists() or any(f"`{f['pattern']}`" not in OUT_MD.read_text(encoding="utf-8") for f in fams):
            probs.append("docs/API.md misses a family")
        for p in probs:
            print("  " + p)
        print(f"api_doc: {len(fams)} families, {len(probs)} problems (python3 pipeline/build_api_doc.py to regenerate)")
        return 1 if probs else 0
    OUT_JSON.write_text(j, encoding="utf-8")
    OUT_MD.write_text(m, encoding="utf-8")
    print(f"apiFamilies.json + docs/API.md: {len(fams)} families ({sum(1 for f in fams if f['kind'] == 'open')} open), {len(FEEDS)} feeds, {len(CHANGELOG)} changelog lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
