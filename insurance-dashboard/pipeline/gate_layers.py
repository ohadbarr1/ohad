"""Gate checks for the published layers outside the statements (lane G; r2-ws5 finding 4, gap 1). Called by pipeline/gate.py.

Every published value has a source (a MAYA report id + page, or a source URL + retrieval date), a sane type and unit, and, where the
page text is available here (the in-app reader text in the repo, else the local PDF: pipeline/pagetext.py), is printed on its cited page.
A value read from a page or slide image (source image|chart, flag i) is not text-checked but must carry the reading note.

  solvency       csm/solvency.json: every cell's report is listed with its file and publication date; ratios in %, amounts in NIS m sane
  solvency_page  the solvency cells and sensitivities on their cited page
  capital_page   csm/capital.json (capital use: solvency ratios, own funds, dividends) on the cited page of the cited MAYA file
  adjusted_page  adjusted.json (company-defined KPIs from decks and reports) on the cited page
  targets_page   targets.json: the target's figure (or, for a target without one, its quoted words) on the cited page
  decks_page     every deck fact extracted (data/extracted_pres) on its slide
  image_notes    every value read from an image carries the reading note; the published image flag matches the extraction
  debt           debt/: the ת126 self-check (tables parsed and tied out) and every cell's report listed with URL + publication date
  ownership      ownership/: shares in [0, 100] that add up, every holding dated, every company with source URL + retrieval date
  macro          macro/: every series with source URL + retrieval date, values numeric and in range, months in order
  cell_sources   every current statement figure cites a MAYA report with its publication date (warns with the count where not)

Page checks: a miss not in pipeline/gate_known.json fails; a known miss warns; a value with no page text here is counted as
"skipped (no sources)" and warns (CI has the reader text but not the PDFs): never a silent pass.
"""
import collections
import glob
import json
import re
from pathlib import Path

import pagetext

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
KNOWN = Path(__file__).resolve().parent / "gate_known.json"
RID = re.compile(r"P(\d{6,8})-\d+\.pdf")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}")
MISSES = {}  # check id -> list of miss keys (pipeline/gate.py --baseline writes them to gate_known.json)


def load(rel):
    p = DATA / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def known(cid):
    try:
        return set(json.loads(KNOWN.read_text(encoding="utf-8")).get(cid, []))
    except (OSError, ValueError):
        return set()


def page_check(add, cid, items, what):
    """items: (key, rid, page, values, quote, image) — key identifies the value in a miss list; values: the numbers any one of which must be
    on the page; quote: words to look for where there is no number; image: read from the image (not text-checked)."""
    n = ok = img = skip = blank = 0
    misses, blanks = [], []
    for key, rid, pg, vals, quote, image in items:
        if image:
            img += 1
            continue
        t, _ = pagetext.page(rid, pg)
        if t is None:
            skip += 1
            continue
        if len(re.sub(r"\s", "", t)) < 20:  # an image-only page: no text layer to check against, and the value is not flagged as read from the image
            blank += 1
            blanks.append(key)
            continue
        n += 1
        vals = [v for v in vals if isinstance(v, (int, float)) and v != 0]
        if (vals and any(pagetext.found(v, t) for v in vals)) or (not vals and pagetext.words(quote, t)) or (not vals and not quote):
            ok += 1
        else:
            misses.append(key)
    MISSES[cid] = misses
    kn = known(cid)
    new = [m for m in misses if m not in kn]
    if n == 0 and skip:  # nothing could be checked here (CI without the page texts): the check itself is a warning, never a pass
        return add(cid, False, skip + img, skip, f"{what}: skipped (no sources): no page text here for {skip} values; {img} read from the image", level="warn")
    add(cid, not new, n, len(new), f"{what}: {ok}/{n} on the cited page; {len(new)} new misses" + (f", e.g. {new[0]}" if new else "")
        + f"; {img} read from the image (note checked separately); {skip} skipped (no sources)")
    if misses and len(misses) > len(new):
        add(cid + "_known", False, n, len(misses) - len(new), f"known misses (reviewed): {len(misses) - len(new)}, e.g. {sorted(set(misses) - set(new))[0]}", level="warn")
    if blank:
        add(cid + "_noimgflag", False, n + blank, blank, f"cited page has no text layer (an image page) but the value carries no image flag: {blank}, e.g. {blanks[0]}", level="warn")
    if skip:
        add(cid + "_skipped", False, n + skip + img, skip, f"skipped (no sources): {skip} values whose page text is not available here", level="warn")


# ------------------------------------------------------------------------------------------------------------------------- solvency
RATIO = re.compile(r"^(sr|sra|tg|sens)")


def solvency(add):
    s = load("csm/solvency.json")
    if not s:
        return add("solvency", False, 0, 1, "csm/solvency.json missing")
    reps = s["reports"]
    bad, items = [], []
    n = 0
    for c, dates in s["companies"].items():
        for d, cells in dates.items():
            for m, x in cells.items():
                n += 1
                key = f"{c} {d} {m}"
                r = reps.get(str(x.get("r")))
                if not r or not r.get("f") or not ISO.match(r.get("pub") or "") or not x.get("pg"):
                    bad.append(f"{key}: no report/page/publication date")
                v = x.get("v")
                if not isinstance(v, (int, float)):
                    bad.append(f"{key}: value {v!r} not numeric")
                elif RATIO.match(m) and not (0 < v < 1000):
                    bad.append(f"{key}: ratio {v} outside (0, 1000)%")
                elif not RATIO.match(m) and abs(v) > 1e6:
                    bad.append(f"{key}: amount {v} above NIS 1,000bn")
                items.append((key, x.get("r"), x.get("pg"), [v, x.get("hi")], None, x.get("i") == 1))
                if isinstance(x.get("alt"), dict):  # the other print of the same cell (an amended report, the second table)
                    a = x["alt"]
                    items.append((key + " alt", a.get("r"), a.get("pg"), [a.get("v")], None, x.get("i") == 1 and (a.get("r"), a.get("pg")) == (x.get("r"), x.get("pg"))))
    for i, x in enumerate(s.get("sens", [])):
        n += 1
        key = f"{x.get('c')} {x.get('d')} sens {x.get('risk')} {x.get('v')}"
        r = reps.get(str(x.get("r")))
        if not r or not x.get("pg"):
            bad.append(f"{key}: no report/page")
        if not isinstance(x.get("v"), (int, float)) or abs(x["v"]) > 1000:
            bad.append(f"{key}: sensitivity {x.get('v')!r} not a percentage-point change")
        items.append((key, x.get("r"), x.get("pg"), [x.get("v")], None, False))
    add("solvency", not bad, n, len(bad), f"{n} cells and sensitivities: report with file + publication date, page, numeric, ratio in (0, 1000)%"
        + (f"; e.g. {bad[0]}" if bad else ""))
    page_check(add, "solvency_page", items, "solvency (Solvency II reports)")


def capital(add):
    cap = load("csm/capital.json")
    if not cap:
        return add("capital_page", False, 0, 1, "csm/capital.json missing")
    items, bad, der = [], [], 0
    for c, ms in cap["companies"].items():
        for m, pts in ms.items():
            for p, x in pts.items():
                key = f"{c} {m} {p}"
                rid = RID.search(x.get("u") or "")
                if not rid or not x.get("pg") or not isinstance(x.get("v"), (int, float)):
                    bad.append(key)
                    continue
                if x.get("der"):  # Q4 = FY less 9M: not printed; its inputs are page-checked as their own points
                    der += 1
                    continue
                items.append((key, int(rid.group(1)), x["pg"], [x["v"]], None, x.get("img") == 1 or x.get("i") == 1))
    if bad:
        add("capital", False, len(items) + len(bad), len(bad), f"capital-use points without a MAYA file, page or numeric value; e.g. {bad[0]}")
    page_check(add, "capital_page", items, f"capital use (csm/capital.json; {der} derived Q4 = FY less 9M not printed)")


def adjusted(add):
    a = load("adjusted.json")
    if not a:
        return add("adjusted_page", False, 0, 1, "adjusted.json missing")
    items, bad = [], []
    for c, ms in a["companies"].items():
        for m, x in ms.items():
            for p in x["pts"]:
                key = f"{c} {m} {p['p']}"
                d = a["docs"].get(str(p.get("rid")))
                if not d or not d[4] or not ISO.match(d[3] or "") or not p.get("pg") or not isinstance(p.get("v"), (int, float)):
                    bad.append(key)
                items.append((key, p.get("rid"), p.get("pg"), [p.get("v")], None, p.get("i") == 1))
    if bad:
        add("adjusted", False, len(items), len(bad), f"adjusted KPIs without a listed document (file, date), page or number; e.g. {bad[0]}")
    page_check(add, "adjusted_page", items, "adjusted KPIs (adjusted.json)")


def targets(add):
    t = load("targets.json")
    if not t:
        return add("targets_page", False, 0, 1, "targets.json missing")
    items, bad = [], []
    for r in t["rows"]:
        key = f"{r['c']} {r['m']} {r.get('d')} p{r.get('pg')}"
        d = t["docs"].get(str(r.get("doc")))
        if not d or not d[4] or not r.get("pg"):
            bad.append(key)
        if r.get("u") == "pct" and isinstance(r.get("v"), (int, float)) and not (-100 < r["v"] < 1000):
            bad.append(f"{key}: {r['v']}% out of range")
        items.append((key, r.get("doc"), r.get("pg"), [r.get("v"), r.get("lo"), r.get("hi")], r.get("q"), r.get("img") == 1))
    if bad:
        add("targets", False, len(items), len(bad), f"targets without a listed document or page, or out of range; e.g. {bad[0]}")
    page_check(add, "targets_page", items, "targets (targets.json; a figure, else the quoted words)")


def decks(add):
    items = []
    for f in sorted(glob.glob(str(ROOT / "data" / "extracted_pres" / "*" / "*.json"))):
        d = json.loads(Path(f).read_text(encoding="utf-8"))
        rid = d.get("report_id")
        for x in d.get("facts", []):
            if not any(isinstance(x.get(k), (int, float)) for k in ("value", "value_low", "value_high")):
                continue  # a nil ('-') the extraction kept as null: no figure is published
            key = f"{d.get('company')} {d.get('period')} {x.get('metric')} {x.get('date')} p{x.get('page_he')}"
            items.append((key, rid, x.get("page_he"), [x.get("value"), x.get("value_low"), x.get("value_high")], x.get("label"),
                          x.get("source") in ("image", "chart")))
    page_check(add, "decks_page", items, "deck facts (data/extracted_pres)")


def image_notes(add):
    """Every image/chart reading carries a note; the published flag i on a solvency cell sits on a page with an image reading behind it."""
    n, bad = 0, []
    img = set()
    for sub in ("extracted_solvency", "extracted_pres"):
        for f in sorted(glob.glob(str(ROOT / "data" / sub / "*" / "*.json"))):
            d = json.loads(Path(f).read_text(encoding="utf-8"))
            for x in d.get("facts", []):
                if x.get("source") in ("image", "chart"):
                    n += 1
                    img.add((int(d.get("report_id") or 0), x.get("page_he")))
                    if not (x.get("note") or "").strip():
                        bad.append(f"{Path(f).parent.name}/{Path(f).name} {x.get('metric')} p{x.get('page_he')}")
    s = load("csm/solvency.json") or {"companies": {}}
    flagged = orphan = 0
    for c, dates in s["companies"].items():
        for dt_, cells in dates.items():
            for m, x in cells.items():
                if x.get("i") == 1:
                    flagged += 1
                    if (int(x["r"]), x.get("pg")) not in img:  # the flag is per page: some value of that page was read from its image
                        orphan += 1
                        bad.append(f"solvency {c} {dt_} {m}: image flag on a page without an image reading")
    add("image_notes", not bad, n + flagged, len(bad), f"{n} values read from a page or slide image, each with its reading note; {flagged} flagged solvency cells"
        + (f"; e.g. {bad[0]}" if bad else ""))


# ------------------------------------------------------------------------------------------------------------------------- debt etc.
def debt(add):
    idx = load("debt/index.json")
    if not idx:
        return add("debt", False, 0, 1, "debt/index.json missing")
    ch = idx.get("checks", {})
    bad = []
    if ch.get("passed") != ch.get("tables") or ch.get("failed") or ch.get("unparsed") or ch.get("no_htm") or ch.get("title_mismatch"):
        bad.append(f"self-check: {ch.get('passed')}/{ch.get('tables')} tables tie out, {len(ch.get('failed') or [])} failed, "
                   f"{len(ch.get('unparsed') or [])} unparsed, {ch.get('no_htm')} without the form")
    n = 0
    for co in idx["companies"]:
        d = load(f"debt/{co['id']}.json")
        if not d:
            bad.append(f"debt/{co['id']}.json missing")
            continue
        reps = {r["rid"]: r for r in d["reports"]}
        for r in d["reports"]:
            if not r.get("url") or not ISO.match(r.get("pub") or ""):
                bad.append(f"{co['id']} {r['rid']}: no URL or publication date")
        for c in d["cells"]:
            n += 1
            if c[0] not in reps:
                bad.append(f"{co['id']}: cell of unlisted report {c[0]}")
            elif any(not isinstance(v, (int, float)) for v in c[3:]):
                bad.append(f"{co['id']} {c[0]} {c[1]} {c[2]}: non-numeric amount")
    add("debt", not bad, n, len(bad), f"ת126 self-check {ch.get('passed')}/{ch.get('tables')} tables tie out over {ch.get('parsed')} forms; {n} cells, each of a listed "
        f"report with URL + publication date" + (f"; e.g. {bad[0]}" if bad else ""))
    w = ch.get("warnings") or []
    if w:
        add("debt_warn", False, ch.get("tables", 0), len(w), f"form notes (a parent's table splits years differently from the subsidiary's form): {len(w)}", level="warn")


def ownership(add):
    idx = load("ownership/index.json")
    if not idx:
        return add("ownership", False, 0, 1, "ownership/index.json missing")
    n, bad = 0, []
    for co in idx["companies"]:
        n += 1
        if not ISO.match(co.get("asof") or ""):
            bad.append(f"{co['id']}: no as-of date")
        for k in ("controlling", "institutional", "public", "interested"):
            v = co.get(k)
            if v is not None and not (0 <= v <= 100):
                bad.append(f"{co['id']} {k} {v}% outside [0, 100]")
        parts = [co.get(k) for k in ("interested", "institutional", "public")]
        if None not in parts and abs(sum(parts) - 100) > 0.5:  # MAYA's distribution: interested parties + institutional + public = 100%
            bad.append(f"{co['id']}: interested {parts[0]} + institutional {parts[1]} + public {parts[2]} != 100")
        d = load(f"ownership/{co['id']}.json")
        if not d:
            continue
        sp = d.get("split") or {}
        if not d.get("retrieved") or not (sp.get("src") or "").startswith("http"):
            bad.append(f"{co['id']}: no source URL or retrieval date")
        for h in d.get("holders", []):
            n += 1
            if not ISO.match(h.get("date") or ""):
                bad.append(f"{co['id']} {h.get('name')}: holding without a date")
            for k in ("cap", "vote"):
                v = h.get(k)
                if v is not None and not (0 <= v <= 100):
                    bad.append(f"{co['id']} {h.get('name')} {k} {v}% outside [0, 100]")
    add("ownership", not bad, n, len(bad), f"{len(idx['companies'])} companies, holdings dated, shares in [0, 100] and adding up, source URL + retrieval date"
        + (f"; e.g. {bad[0]}" if bad else ""))


RANGE = {"rate": (-1, 20), "nom10": (-2, 15), "real10": (-4, 10), "be10": (-2, 10), "exp1": (-5, 15)}


def macro(add):
    m = load("macro/macro.json")
    c = load("macro/boi_curve.json")
    n, bad = 0, []
    for k, s in (m or {"series": {}})["series"].items():
        if not (s.get("url") or "").startswith("http") or not ISO.match(s.get("retrieved") or "") or not s.get("source"):
            bad.append(f"{k}: no source URL / retrieval date")
        pts = s.get("months") or []
        if k == "cpi":
            for p in s.get("points") or []:
                n += 1
                if not (isinstance(p.get("idx"), (int, float)) and 20 < p["idx"] < 1000) or not (isinstance(p.get("mom"), (int, float)) and abs(p["mom"]) < 10):
                    bad.append(f"cpi {p.get('m')}: index {p.get('idx')} / m-o-m {p.get('mom')} out of range")
            ms = [p.get("m") for p in s.get("points") or []]
        else:
            lo, hi = RANGE.get(k, (-50, 50))
            for mo, v in pts:
                n += 1
                if not isinstance(v, (int, float)) or not lo <= v <= hi:
                    bad.append(f"{k} {mo}: {v} outside [{lo}, {hi}]")
            ms = [p[0] for p in pts]
        if ms != sorted(ms) or len(set(ms)) != len(ms):
            bad.append(f"{k}: months out of order or repeated")
    if c:
        if not (c.get("url") or "").startswith("http") or not ISO.match(c.get("retrieved") or ""):
            bad.append("boi_curve: no source URL / retrieval date")
        for kind in ("nominal", "real"):
            for t, vs in c.get(kind, {}).items():
                if len(vs) != len(c["months"]):
                    bad.append(f"boi_curve {kind} {t}y: {len(vs)} values for {len(c['months'])} months")
                for v in vs:
                    n += 1
                    if v is not None and not (-6 <= v <= 20):
                        bad.append(f"boi_curve {kind} {t}y: {v} out of range")
    add("macro", not bad, n, len(bad), f"{n} macro values: source URL + retrieval date, numeric, in range, months in order" + (f"; e.g. {bad[0]}" if bad else ""))


def cell_sources(add):
    """Every current statement figure (flag 16 in the fact table) cites a MAYA report with its publication date. A figure on a company-site
    copy (no report id, no date) warns with its count; the workbook source carries the mark (r2-ws5 finding 7)."""
    idx = load("facts/index.json") or {"companies": []}
    n = bad = 0
    by = collections.Counter()
    hosts = collections.Counter()
    for co in idx["companies"]:
        d = load(f"facts/{co['id']}.json")
        if not d:
            continue
        V, R = d["vint"], d["rows"]
        for t, fl in zip(R["t"], R["f"]):
            if not fl & 16:
                continue
            n += 1
            if V["rid"][t] is None or not V["pub"][t]:
                bad += 1
                by[co["id"]] += 1
                u = d["urls"][V["u"][t]] if V["u"][t] is not None and V["u"][t] < len(d["urls"]) else None
                hosts[re.sub(r"^https?://(www\.)?([^/]+).*$", r"\2", u or "-")] += 1
    add("cell_sources", bad == 0, n, bad, f"{n} current statement figures; {bad} without a MAYA report id + publication date"
        + (f" ({', '.join(f'{k} {v}' for k, v in by.items())}; cited host: {', '.join(f'{k} {v}' for k, v in hosts.items())})" if bad else ""), level="warn")


def run(add):
    solvency(add)
    capital(add)
    adjusted(add)
    targets(add)
    decks(add)
    image_notes(add)
    debt(add)
    ownership(add)
    macro(add)
    cell_sources(add)
    pagetext.save()
