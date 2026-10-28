"""The data pipeline as a graph: every builder with its inputs and outputs, run in dependency order, only when stale. Standard library only.

    python3 pipeline/dag.py                    run every stale automatic step, in topological order
    python3 pipeline/dag.py --dry-run          print the plan (what is stale and why) and run nothing
    python3 pipeline/dag.py --only <t>[,<t>]   a step or group (deploy, facts, ...) plus its stale automatic upstream steps
    python3 pipeline/dag.py --only deploy --no-deps   exactly the steps of the group (deploy.sh: the steps it always ran)
    python3 pipeline/dag.py --why <file>       which step writes the file, whether it is stale (which input changed), who reads it
    python3 pipeline/dag.py --graph            the graph as text (docs/PIPELINE.md carries a copy), --check: validate it (CI)

A step is STALE when it never ran here, its script (or a module it imports) changed, an input changed, an output is missing or was
changed outside the DAG, or (for a date-dependent step) the day changed. "Changed" = content hash; a (size, mtime) cache keeps a no-op
run to a stat per file. State: ~/.cache/fox/dag-<checkout>.json (FOX_CACHE), per checkout; a fresh checkout has none, so everything is stale once.
MANUAL steps need the network, duckdb, pandas/parquet on the synced drive or an LLM extraction: the DAG lists them as stale and tells
you what to run, but never runs them (`--only <step> --manual` runs one on purpose). docs/PIPELINE.md: the graph and how to add a step.
"""
import argparse
import datetime as dt
import fnmatch
import glob
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # insurance-dashboard/
# per checkout (worktrees share ~/.cache): content hashes are keyed by relative path + (size, mtime)
STATE = Path(os.environ.get("FOX_CACHE", Path.home() / ".cache" / "fox")) / f"dag-{hashlib.sha1(str(ROOT).encode()).hexdigest()[:10]}.json"
PY = sys.executable or "/usr/bin/python3"
MANUAL = {"network", "duckdb", "pandas", "openpyxl", "drive", "llm", "pdftotext"}

D = "web/public/data/"
REG = "data/registry/"


def step(name, cmd, inputs=(), outputs=(), needs=(), code=(), edits=(), daily=False, groups=(), note=""):
    """cmd: a script path (relative to insurance-dashboard/) or a list of argv lists. inputs/outputs: paths or globs (a directory means
    every file under it). edits: files the step reads and rewrites in place (it runs after their producer, before their readers).
    code: modules the script imports (a change makes it stale). daily: the output depends on today's date. needs: see MANUAL."""
    argv = [[cmd]] if isinstance(cmd, str) else [list(c) for c in cmd]
    return {"name": name, "cmd": argv, "inputs": list(inputs), "outputs": list(outputs), "edits": list(edits), "needs": set(needs),
            "code": sorted({a[0] for a in argv if a[0].endswith(".py")} | set(code)), "daily": daily, "groups": set(groups), "note": note}


# the company workbooks (companies/<id>.json; not index.json, <id>.docs.json, <id>.price.json): one path each, so readers and writers match
WB = sorted(f"{D}companies/{f.name}" for f in (ROOT / D / "companies").glob("*.json") if f.name != "index.json" and f.name.count(".") == 1)
LTS_COS = ["altshuler", "analyst", "clal", "harel", "ic", "meitav", "menora", "migdal", "more", "phoenix", "yelin"]

STEPS = [
    # ---------------------------------------------------------------- sources: network, the synced drive, LLM extraction (manual)
    step("fetch_maya", "pipeline/fetch_maya.py", [REG + "companies.json"], ["data/warehouse.duckdb", "data/sources/pdf"], {"network", "duckdb"},
         note="MAYA filings + PDFs (also: pipeline/autopilot, which appends documents.csv)"),
    step("fetch_xbrl", "pipeline/fetch_xbrl.py", [REG + "documents.csv"], [REG + "xbrl_facts.json", "data/sources/xbrl"], {"network"}),
    step("fetch_regulator", "pipeline/fetch_regulator.py", [], ["data/raw/_meta.json"], {"network", "pandas", "drive"}, note="gemel-net / pensia-net / bituach-net parquet"),
    step("fetch_macro", "pipeline/fetch_macro.py", [], ["data/raw/macro"], {"network", "drive"}),
    step("fetch_boi", "pipeline/fetch_boi.py", [], ["data/raw/boi"], {"network", "drive"}),
    step("fetch_prices", "pipeline/fetch_prices.py", [REG + "companies.json"], [D + "companies/*.price.json"], {"network", "drive"},
         note="valuation input only (labelled)"),
    step("fetch_holders", "pipeline/fetch_holders.py", [REG + "companies.json"], ["data/raw/maya_holders"], {"network", "drive"}),
    step("fetch_liabilities", "pipeline/fetch_liabilities.py", [REG + "companies.json", REG + "documents.csv"], ["data/raw/maya_liabilities"], {"network", "drive"}),
    step("build_pages", "pipeline/build_pages.py", [REG + "documents.csv", "data/sources/pdf"], [D + "search/text", REG + "pages_manifest.json"],
         {"pdftotext", "drive"}, note="page text of every PDF (reads the PDFs on the synced drive)"),
    step("extraction", [], [], ["data/extracted", "data/extracted_fs", "data/extracted_hist", "data/extracted_lts", "data/extracted_pres",
                                "data/extracted_savings", "data/extracted_solvency", "data/extracted_sop"], {"llm"},
         note="LLM extraction waves (owner approval each, EXTRACT_SPEC.md); not a script"),
    # ---------------------------------------------------------------- builders that need duckdb / pandas (manual on this machine)
    step("build_ifrs", "pipeline/build_ifrs.py", ["data/extracted", REG + "documents.csv", REG + "presentations.json", "data/warehouse.duckdb"],
         [D + "ifrs.json", D + "ifrs_*.json", D + "ifrs"], {"duckdb", "drive"}, note="also reads data/work/manifest_quarters.json (drive)"),
    step("build_kpi", "pipeline/build_kpi.py", ["data/extracted", REG + "kpi_verified.json", REG + "kpi_windows.json", REG + "kpi_windows_manual.json",
                                                "data/warehouse.duckdb"], [D + "kpi.json"], {"duckdb"}, code=["pipeline/autopilot/t0.py"]),
    step("build_documents", "pipeline/build_documents.py", ["data/warehouse.duckdb"], [D + "companies/*.docs.json"], {"duckdb"}),
    step("build_market", "pipeline/build_market.py", ["data/raw/_meta.json"], ["data/market.json", D + "market.json", D + "prov/reg"], {"pandas", "drive"}),
    step("build_funds", "pipeline/build_funds.py", ["data/raw/_meta.json"], [D + "funds.json", D + "funds"], {"pandas", "drive"}),
    step("build_macro", "pipeline/build_macro.py", ["data/raw/macro"], [D + "macro/macro.json"], {"drive"}),
    step("build_boi_curve", "pipeline/build_boi_curve.py", ["data/raw/boi"], [D + "macro/boi_curve.json"], {"drive"}),
    step("build_ownership", "pipeline/build_ownership.py", ["data/raw/maya_holders", REG + "companies.json"], [D + "ownership"], {"drive"}),
    step("build_debt", "pipeline/build_debt.py", ["data/raw/maya_liabilities", REG + "companies.json", *WB, D + "csm/capital.json"],
         [D + "debt"], {"drive"}),
    step("build_savings", "pipeline/build_savings.py", ["data/extracted_savings", REG + "documents.csv"], [D + "savings_econ.json"], {"drive"},
         note="also reads data/work/savings_verified.json (drive)"),
    # ---------------------------------------------------------------- automatic: standard library, local files only
    # --shards 1536: the shard layout the published index uses (the automatic count would rename every shard file)
    step("build_search", [["pipeline/build_search.py", "--shards", "1536"]], [REG + "documents.csv", REG + "pages_manifest.json", D + "search/text"],
         [D + "search/docs.json", D + "search/ft"]),
    step("build_series", "pipeline/build_series.py", ["data/extracted", "data/extracted_hist", REG + "documents.csv", REG + "presentations.json"],
         [D + "series"]),
    step("build_hist", "pipeline/build_hist.py", ["data/extracted_hist", REG + "documents.csv", REG + "presentations.json"], [D + "hist"]),
    step("build_sop", "pipeline/build_sop.py", ["data/extracted_sop", REG + "documents.csv", REG + "presentations.json"], [D + "sop"]),
    step("build_solvency", "pipeline/build_solvency.py", ["data/extracted_solvency", REG + "documents.csv"], [D + "csm/solvency.json"]),
    step("facts", "pipeline/build_facts.py",
         ["data/extracted_fs", "data/workbook_base", REG + "companies.json", REG + "documents.csv", D + "series/*.json", D + "search/docs.json",
          "web/src/lib/labels.ts", "web/src/pages/CompanyIfrs.tsx", "web/src/pages/IndustryIfrs.tsx"],
         [*WB, D + "search/rows.json", D + "lines.json", D + "facts", "pipeline/taxonomy/lines.json",
          "pipeline/taxonomy/coverage.json"],
         code=["pipeline/build_workbook.py", "pipeline/taxonomy/build.py", "pipeline/taxonomy/rules.py"], edits=["pipeline/taxonomy/registry.json"],
         groups={"facts"}, note="the merge + fact table; writes the company workbooks FROM the table (= build_workbook.py). Unlabeled-row "
                                "captions are read from data/work page texts (drive), cached in ~/.cache/fox/captions.json"),
    step("build_company_index", "pipeline/build_company_index.py", [REG + "companies.json", *WB], [D + "companies/index.json"]),
    step("build_restatements", "pipeline/build_restatements.py",
         [D + "facts/*.json", D + "ifrs.json", D + "ifrs_*.json", D + "search/docs.json", D + "companies/index.json", "web/src/lib/labels.ts",
          "web/src/pages/CompanyIfrs.tsx", "web/src/pages/IndustryIfrs.tsx"], [D + "restatements.json"], groups={"facts"}),
    step("build_csm", "pipeline/build_csm.py", [D + "ifrs.json", D + "ifrs_*.json", D + "series/*.json", D + "csm/solvency.json"],
         [D + "csm/facts", D + "csm/summary.json", D + "csm/sens.json", D + "csm/rates.json", D + "csm/capital.json"]),
    step("build_targets", "pipeline/build_targets.py", ["data/extracted_pres", D + "ifrs.json", D + "ifrs_*.json", D + "csm/capital.json", D + "search/docs.json"],
         [D + "targets.json", D + "adjusted.json"]),
    step("lts_norm", [[f"pipeline/lts_norm_{c}.py"] for c in LTS_COS] + [["pipeline/lts_norm_all.py"]], ["data/extracted_lts"], ["data/lts_norm"],
         code=["pipeline/lts_method.py", "pipeline/build_lts.py"], note="per-company normalisers, then the sector rates"),
    step("build_lts", "pipeline/build_lts.py", ["data/extracted_lts", "data/lts_norm", "data/lts_deck_check.json"], [D + "lts.json", D + "lts_prov"],
         code=["pipeline/lts_method.py"]),
    step("build_recon", "pipeline/build_recon.py", [D + "market.json", D + "prov/reg", *WB, REG + "recon_map.json"],
         [D + "recon.json"]),
    step("build_lens", "pipeline/build_lens.py", [D + "market.json", D + "lts.json", D + "recon.json"], [D + "lens.json"]),
    step("build_flow_npv", "pipeline/build_flow_npv.py", [D + "lens.json", D + "market.json", D + "lts.json", D + "macro/macro.json", "web/src/lib/valuation.ts"],
         [D + "flow_npv.json"], note="M3: NPV of net transfers and organic flow per manager x product (assumptions labelled)"),
    step("build_roster", "pipeline/build_roster.py", [D + "market.json", D + "funds.json", D + "funds"], [D + "roster.json"]),
    step("build_pagefacts", "pipeline/build_pagefacts.py", [*WB, D + "ifrs", D + "ifrs.json", D + "savings_econ.json", D + "lts_prov"],
         [D + "search/facts"]),
    # ---------------------------------------------------------------- the steps deploy.sh runs before the gate (group "deploy")
    step("build_web_index", "pipeline/build_web_index.py", [D + "market.json", D + "companies/*.docs.json"], [D + "search/entities.json", D + "filings_latest.json"],
         groups={"deploy"}),
    step("build_calendar", "pipeline/build_calendar.py", [REG + "companies.json", REG + "documents.csv"], [D + "calendar.json", D + "calendar.ics"],
         daily=True, groups={"deploy"}, note="projections from today's date"),
    # module M1 (unpublished): the nowcast engine; appends the live stage to the frozen ledger (never rewrites an entry)
    step("build_nowcast", "pipeline/build_nowcast.py", [D + "lens.json", D + "market.json", D + "calendar.json", D + "macro/macro.json",
         REG + "documents.csv", "data/extracted_fs"], [D + "nowcast.json", "data/nowcast/est_events.json"], edits=["data/ledger/nowcast"],
         note="append-only ledger data/ledger/nowcast/<quarter>/<stage>.json"),
    step("canon_kpi", "pipeline/canon_kpi.py", [D + "lines.json", D + "companies/index.json", *WB, "web/src/pages/ReportDay.tsx"],
         [], code=["pipeline/reportday.py"], edits=[D + "kpi.json"], groups={"deploy"}, note="printed figure over the XBRL tag, in place"),
    step("build_registry", "pipeline/build_registry.py",
         [D + "adjusted.json", D + "companies/index.json", D + "csm/solvency.json", D + "ifrs.json", D + "ifrs_*.json", D + "kpi.json", D + "lines.json",
          D + "lts.json", D + "market.json", D + "savings_econ.json", D + "series", D + "sop", "web/src/lib/labels.ts"],
         [D + "peers"], groups={"deploy"}, note="Peer Table metric registry (follows the canon)"),
    step("build_market_home", "pipeline/build_market_home.py", [D + "market.json"], [D + "market_home.json"], groups={"deploy"}),
    # lane S2: report card per filing (numbers only, every digit a fact; pipeline/check_cards.py validates) and the per-company "new since" events
    step("build_cards", "pipeline/build_cards.py",
         [*WB, D + "companies/index.json", D + "companies/*.docs.json", D + "kpi.json", D + "targets.json", D + "ifrs.json", D + "ifrs_*.json",
          D + "csm/facts", D + "peers/m/ifrs-csm_new_business.json", D + "peers/m/ifrs-csm_release.json", "web/src/pages/ReportDay.tsx"],
         [D + "cards"], code=["pipeline/reportday.py", "pipeline/csm_resolve.py"], groups={"deploy"},
         note="report cards: Report Day roles, csm_resolve, Peer Table cells, targets"),
    step("build_since", "pipeline/build_since.py",
         [*WB, D + "companies/index.json", D + "companies/*.docs.json", D + "targets.json", D + "market.json"],
         [D + "since.json"], daily=True, groups={"deploy"}, note="dated events per company for the \"since you last looked\" marks (last 400 days)"),
    # module A6: the position book, published positions (append-only ledger data/ledger/positions/) scored against the published data
    step("build_positions", "pipeline/build_positions.py",
         [D + "lens.json", D + "kpi.json", D + "targets.json", D + "calendar.json", D + "companies/index.json", D + "cards", "data/ledger/positions",
          D + "fragility.json"],
         [D + "positions.json"], groups={"deploy"},
         note="drafts (data/positions/, status draft) only with --drafts, a dev build the gate refuses (check `positions`)"),
    # module M2: the delta feed (/feed) from the published files, and its weekly digest (an email body; no sender is wired)
    step("build_feed", "pipeline/build_feed.py",
         [D + "search/docs.json", D + "companies/index.json", *WB, D + "cards", D + "restatements.json", D + "targets.json", D + "market.json",
          D + "funds", D + "csm/solvency.json", D + "positions.json", D + "fragility.json", "web/src/pages/ReportDay.tsx"],
         [D + "feed.json"], code=["pipeline/reportday.py"], groups={"deploy"},
         note="dated, typed, sourced events since 01.01.25 (pipeline/check_feed.py = gate `feed`)"),
    # module A4: the attribution engine (the "why" of every ROE / profit change, and between peers), from the reported facts only
    step("build_attribution", "pipeline/build_attribution.py",
         [*WB, D + "companies/index.json", D + "lens.json", D + "lts_prov", D + "search/docs.json"],
         [D + "attribution"], code=["pipeline/attribution.py"], groups={"deploy"},
         note="QoQ / YoY / LTM bridges per company and pairwise peer bridges (pipeline/build_attribution.py --check = gate `attribution`)"),
    step("build_digest", "pipeline/build_digest.py", [D + "feed.json"], ["data/digest/digest.html", "data/digest/digest.txt"], daily=True,
         note="the last 7 days of feed.json as a Hebrew RTL email body (untracked output; no sender is wired)"),
    # module A1: the driver graph (mechanisms layer): calibrated edges per company over the published files; gate `drivers`
    step("build_drivers", "pipeline/build_drivers.py",
         [D + "lens.json", D + "flow_npv.json", D + "market.json", D + "funds/cat.json", D + "macro/boi_curve.json", D + "macro/macro.json", D + "lines.json", D + "csm/sens.json",
          D + "csm/solvency.json", D + "csm/capital.json", D + "csm/facts", D + "companies/index.json", D + "debt", "web/src/lib/valuation.ts"],
         [D + "drivers"], code=["pipeline/build_flow_npv.py", "pipeline/csm_resolve.py"], groups={"deploy"},
         note="A1: graph.json + per-company elasticities (identity / regression / disclosure / assumption, each with provenance)"),
    # module A8: the regulatory impact simulator: the hand-curated initiative register through the A1 driver files; gate `regulation`
    step("build_regulation", "pipeline/build_regulation.py",
         ["data/regulation/initiatives.json", D + "drivers", D + "market.json"],
         [D + "regulation/impact.json"], groups={"deploy"},
         note="A8: low / central / high impact per initiative x manager, the exposure to the whole pipeline (weights labelled)"),
    # module A5: the war room (/warroom): fee -> flow elasticities per product from the regulator's track-month files, and the move board
    step("build_warroom", "pipeline/build_warroom.py",
         [D + "prov/reg", D + "market.json", D + "funds.json", D + "lens.json", D + "flow_npv.json", D + "companies/index.json", "pipeline/build_funds.py"],
         [D + "warroom"], code=["pipeline/warroom_ols.py"], groups={"deploy"},
         note="A5: panel WLS (track + category x month effects, lags 0-6) with quality labels; board per product x category (gate `warroom`)"),
    # module A9: the consolidation screen (every acquirer x target among the managers with printed costs); gate `consolidation`.
    # It runs the A7 capital logic in memory (pipeline/build_capital.py as code), and A7 reads its bolt-on row back: no cycle
    step("build_consolidation", "pipeline/build_consolidation.py",
         [D + "drivers", D + "csm/solvency.json", D + "csm/facts", D + "csm/capital.json", D + "companies/index.json", D + "lens.json",
          D + "market.json", D + "funds.json", D + "flow_npv.json"],
         [D + "consolidation"], code=["pipeline/build_capital.py"], groups={"deploy"},
         note="A9: synergy (AUM x fee yield x c/i gap), capacity (A7 + debt headroom), accretion at 0/20/40% premia, solvency cost, fit components"),
    # module A7: capital and strategic options per insurer (distributable capital, the option set, its ranking); gate `capital`
    step("build_capital", "pipeline/build_capital.py",
         [D + "csm/solvency.json", D + "csm/facts", D + "csm/capital.json", D + "drivers", D + "companies/index.json", D + "consolidation/bolt.json"],
         [D + "capital/options.json"], groups={"deploy"},
         note="A7: own funds − SCR × board target − buffer per basis; dividend / organic / bolt-on (A9, consolidation/bolt.json) / hold rows; the A2 overlay runs on the page"),
    # module A10: the Fragility Monitor (/fragility): seven signals per manager, each with its value, trend, peer percentile, stated rule and
    # state, no composite; its crossings feed M2 and mark A6 positions for review (so it runs before build_positions and build_feed)
    step("build_fragility", "pipeline/build_fragility.py",
         [D + "lens.json", D + "market.json", D + "funds.json", D + "funds", D + "macro/macro.json", D + "macro/boi_curve.json", D + "calendar.json",
          D + "csm/solvency.json", D + "csm/facts", D + "cards", D + "companies/index.json", D + "drivers"],
         [D + "fragility.json"], code=["pipeline/csm_resolve.py"], groups={"deploy"},
         note="A10: flow, fee, performance, cost, solvency, CSM runway, A2 scenario headroom; gate `fragility` (rebuild, provenance, no composite)"),
    # module A3: the expectations decoder (what the multiple requires, one input at a time, scored against the company's own history); gate `expectations`
    step("build_expectations", "pipeline/build_expectations.py",
         [D + "drivers", D + "companies/index.json", D + "companies/*.price.json", D + "market.json", D + "lens.json", D + "kpi.json", D + "targets.json",
          D + "series", D + "funds/cat.json"],
         [D + "expectations"], code=["pipeline/build_drivers.py"], groups={"deploy"},
         note="A3: forward model to FY'28 + terminal at justified P/B; bisection per lever; percentiles against the company's own 24 quarters"),
    # module S1 + S6: the Question Index (standing questions, each answered at three altitudes from the published files); gate `answers`
    step("build_answers", "pipeline/build_answers.py",
         [D + "lens.json", D + "market.json", D + "companies/index.json", D + "fragility.json", D + "targets.json", D + "kpi.json", D + "csm",
          D + "capital", D + "consolidation", D + "expectations", D + "warroom", D + "regulation", D + "attribution", D + "drivers", D + "funds.json",
          D + "nowcast.json", D + "flow_npv.json"],
         [D + "answers"], code=["pipeline/answer_core.py", "pipeline/questions"], groups={"deploy"},
         note="S1: answers/index.json + answers/<topic>.json; every figure a token with provenance (answer_core rules)"),
    step("build_coverage", "pipeline/build_coverage.py", [D + "**/*.json", "web/src/lib/schemas.json", "data/extracted_pres"], [D + "coverage.json"], daily=True,
         groups={"deploy"}, note="/data page: reads every data file (incl. qa.json from the last gate) and today's date"),
]
CHECKS = "python3 pipeline/gate.py (after the build: writes qa.json, consistency.json; deploy.sh runs it after `--only deploy`)"


# ------------------------------------------------------------------------------------------------------------------------------ files
def _is_glob(p):
    return any(ch in p for ch in "*?[")


def expand(root, pat):
    """Files a path or glob names (a directory: every file under it, recursively), as Paths. Hidden files and __pycache__ are ignored."""
    root = str(root)
    hits = glob.glob(os.path.join(root, pat), recursive=True) if _is_glob(pat) else [os.path.join(root, pat)]
    out = set()
    for h in hits:
        if os.path.isdir(h):
            for d, dirs, files in os.walk(h):
                dirs[:] = [x for x in dirs if not x.startswith(".") and x != "__pycache__"]
                out.update(os.path.join(d, f) for f in files if not f.startswith("."))
        elif os.path.isfile(h) and not os.path.basename(h).startswith("."):
            out.add(h)
    return [Path(x) for x in sorted(out)]


def _prefix(p):
    for i, ch in enumerate(p):
        if ch in "*?[":
            return p[:i]
    return p


def _suffix(p):
    for i in range(len(p) - 1, -1, -1):
        if p[i] in "*?]":
            return p[i + 1:]
    return p


def external(root, pat):
    """Does the path run through a symlink (the synced-drive folders)? Those are never walked or hashed."""
    q = Path(root)
    for part in _prefix(pat).rstrip("/").split("/"):
        if not part:
            break
        q = q / part
        if q.is_symlink():
            return True
    return False


def overlaps(a, b):
    """Can two path patterns name a common file? Equal, one a directory of the other, or a glob that matches the other (a literal
    directory counts when the glob can match a file under it). Two globs overlap when one literal prefix extends the other."""
    a, b = a.rstrip("/"), b.rstrip("/")
    if a == b or b.startswith(a + "/") or a.startswith(b + "/"):
        return True
    ga, gb = _is_glob(a), _is_glob(b)
    if ga and gb:
        pa, pb = _prefix(a), _prefix(b)
        sa, sb = _suffix(a), _suffix(b)
        return (pa.startswith(pb) or pb.startswith(pa)) and (sa.endswith(sb) or sb.endswith(sa))
    if not (ga or gb):
        return False
    g, lit = (a, b) if ga else (b, a)
    pats = {g, g.replace("**/", "")}
    cands = [lit]
    if "." not in lit.rsplit("/", 1)[-1]:  # a directory
        ext = os.path.splitext(g)[1]
        cands += [f"{lit}/x{ext}", f"{lit}/x/x{ext}"]
    return any(fnmatch.fnmatchcase(c, q) for c in cands for q in pats)


class Hasher:
    """Content hash per file with a (size, mtime) cache, so an unchanged file costs a stat."""

    def __init__(self, root, cache):
        self.root, self.cache, self.read, self.memo = Path(root), cache, 0, {}

    def file(self, f):
        st = os.stat(f)
        key = os.path.relpath(f, self.root)
        c = self.cache.get(key)
        if c and c[0] == st.st_size and c[1] == st.st_mtime_ns:
            return c[2]
        h = hashlib.sha1()
        with open(f, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        self.read += st.st_size
        self.cache[key] = [st.st_size, st.st_mtime_ns, h.hexdigest()]
        return h.hexdigest()

    def files(self, pats, exclude=()):
        """{relative path: hash} of every file the patterns name, less the excluded patterns' files. A path behind a symlink (data/raw,
        data/work, data/sources: the synced drive) is never listed or read: it counts by its own stat (size, mtime), one entry."""
        key = (tuple(pats), tuple(exclude))
        if key in self.memo:
            return dict(self.memo[key])
        out = {}
        local = [p for p in pats if not external(self.root, p)]
        for p in pats:
            if p not in local:
                q = self.root / _prefix(p).rstrip("/")
                try:
                    st = q.stat()
                    out[_prefix(p).rstrip("/")] = f"stat:{st.st_size}:{st.st_mtime_ns}"
                except OSError:
                    out[_prefix(p).rstrip("/")] = "missing"
        skip = {f for p in exclude if not external(self.root, p) for f in expand(self.root, p)}
        out.update({os.path.relpath(f, self.root): self.file(f) for p in local for f in expand(self.root, p) if f not in skip})
        self.memo[key] = dict(out)
        return out


def digest(d):
    return hashlib.sha1(json.dumps(d, sort_keys=True).encode()).hexdigest()


# ------------------------------------------------------------------------------------------------------------------------------ graph
class Graph:
    def __init__(self, steps, root=ROOT, state_file=STATE, py=PY, today=None):
        self.steps = {s["name"]: s for s in steps}
        if len(self.steps) != len(steps):
            raise SystemExit("dag: two steps with one name")
        self.root, self.state_file, self.py = Path(root), Path(state_file), py
        self.today = today or dt.date.today().isoformat()
        try:
            self.state = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.state = {}
        self.state.setdefault("steps", {})
        self.state.setdefault("hash", {})
        self.hasher = Hasher(self.root, self.state["hash"])
        self.deps = {n: set() for n in self.steps}
        for b in self.steps.values():
            for a in self.steps.values():
                if a is b:
                    continue
                produces = a["outputs"] + a["edits"]
                reads = b["inputs"] + b["edits"]
                if any(overlaps(o, i) for o in produces for i in reads):
                    self.deps[b["name"]].add(a["name"])
        self.order = self._topo()

    def _topo(self):
        order, temp, done = [], set(), set()

        def visit(n, path):
            if n in done:
                return
            if n in temp:
                raise SystemExit("dag: cycle: " + " -> ".join(path + [n]))
            temp.add(n)
            for m in sorted(self.deps[n], key=list(self.steps).index):
                visit(m, path + [n])
            temp.discard(n)
            done.add(n)
            order.append(n)
        for n in self.steps:
            visit(n, [])
        return order

    def manual(self, n):
        s = self.steps[n]
        return bool(s["needs"] & MANUAL) or not s["cmd"]

    def downstream(self, n):
        out, todo = set(), [n]
        while todo:
            x = todo.pop()
            for m, ds in self.deps.items():
                if x in ds and m not in out:
                    out.add(m)
                    todo.append(m)
        return out

    def upstream(self, n):
        out, todo = set(), [n]
        while todo:
            x = todo.pop()
            for m in self.deps[x]:
                if m not in out:
                    out.add(m)
                    todo.append(m)
        return out

    def signature(self, n):
        s = self.steps[n]
        outs = s["outputs"] + s["edits"]
        ins = self.hasher.files(s["inputs"] + s["edits"], exclude=s["outputs"])  # a step reading its own output dir (coverage) ignores it
        code = self.hasher.files(s["code"])
        sig = {"cmd": s["cmd"], "in": ins, "code": code}
        if s["daily"]:
            sig["day"] = self.today
        return sig, self.hasher.files(outs)

    def why(self, n):
        """[] when fresh, else the reasons it is stale."""
        s = self.steps[n]
        rec = self.state["steps"].get(n)
        sig, outs = self.signature(n)
        if not rec:
            return ["never ran here"]
        if self.manual(n) and rec.get("out", {}) != outs:  # a manual step whose outputs moved was run by hand: that is its fresh state
            self.state["steps"][n] = {**rec, "sig": sig, "out": outs, "seen": dt.datetime.now().isoformat(timespec="seconds")}
            return []
        r = []
        if rec["sig"].get("cmd") != sig["cmd"]:
            r.append("command changed")
        for k, label in (("code", "code"), ("in", "input")):
            old, new = rec["sig"].get(k, {}), sig[k]
            ch = sorted(f for f in set(old) | set(new) if old.get(f) != new.get(f))
            if ch:
                r.append(f"{label} changed: {ch[0]}" + (f" (+{len(ch) - 1} more)" if len(ch) > 1 else ""))
        if s["daily"] and rec["sig"].get("day") != sig.get("day"):
            r.append(f"new day ({rec['sig'].get('day')} -> {sig['day']})")
        missing = [o for o in s["outputs"] if not external(self.root, o) and not expand(self.root, o)]
        if missing:
            r.append(f"output missing: {missing[0]}")
        old = rec.get("out", {})
        ch = sorted(f for f in set(old) | set(outs) if old.get(f) != outs.get(f))
        if ch:
            r.append(f"output changed outside the DAG: {ch[0]}" + (f" (+{len(ch) - 1} more)" if len(ch) > 1 else ""))
        return r

    def plan(self, targets=None, deps=True, include_manual=False):
        """[(step, reasons, manual)] in run order. A step downstream of a stale step is stale too (its input will change)."""
        if targets:
            want = set()
            for t in targets:
                hit = {n for n, s in self.steps.items() if t == n or t in s["groups"]}
                if not hit:
                    raise SystemExit(f"dag: no step or group named {t!r} (steps: {', '.join(self.steps)})")
                want |= hit
            if deps:
                want |= {u for n in list(want) for u in self.upstream(n)}
        else:
            want = set(self.steps)
        out, stale = [], set()
        for n in self.order:
            if n not in want:
                continue
            r = self.why(n)
            up = sorted(m for m in self.deps[n] & stale if not self.manual(m) or include_manual)
            if up and not r:
                r = [f"upstream step will run: {up[0]}" + (f" (+{len(up) - 1} more)" if len(up) > 1 else "")]
            if r:
                stale.add(n)
                out.append((n, r, self.manual(n) and not include_manual))
        return out

    def run_step(self, n, log=print):
        s = self.steps[n]
        t0 = time.time()
        self.hasher.memo.clear()  # files change from here on
        for argv in s["cmd"]:
            p = subprocess.run([self.py, *argv], cwd=self.root, capture_output=True, text=True)
            if p.returncode != 0:
                log(f"  FAILED {n}: {' '.join(argv)} (exit {p.returncode})\n" + (p.stdout[-1500:] + p.stderr[-1500:]).rstrip())
                return False
        self.hasher.memo.clear()
        sig, outs = self.signature(n)
        self.state["steps"][n] = {"sig": sig, "out": outs, "ran": dt.datetime.now().isoformat(timespec="seconds"), "secs": round(time.time() - t0, 2)}
        self.save()
        return True

    def save(self):
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps(self.state, separators=(",", ":")), encoding="utf-8")
        except OSError:
            pass

    def run(self, plan, log=print):
        """Runs the automatic steps of a plan in order; stops at the first failure. Returns (ran, skipped manual, ok)."""
        ran, manual = [], []
        for n, reasons, man in plan:
            if man:
                manual.append(n)
                continue
            t0 = time.time()
            ok = self.run_step(n, log)
            log(f"  {'ran' if ok else 'FAILED'} {n:22} {time.time() - t0:6.1f}s  ({reasons[0]})")
            if not ok:
                return ran, manual, False
            ran.append(n)
        self.save()
        return ran, manual, True

    def graph_text(self):
        rows = []
        for n in self.order:
            s = self.steps[n]
            kind = "manual (" + ", ".join(sorted(s["needs"] & MANUAL)) + ")" if self.manual(n) and s["needs"] else "manual" if self.manual(n) else "auto"
            rows.append(f"{n}  [{kind}{', daily' if s['daily'] else ''}{', groups: ' + ','.join(sorted(s['groups'])) if s['groups'] else ''}]")
            rows.append(f"    after: {', '.join(sorted(self.deps[n], key=self.order.index)) or '-'}")
            rows.append(f"    writes: {', '.join(s['outputs'] + [e + ' (in place)' for e in s['edits']]) or '-'}")
        return "\n".join(rows)

    def check(self):
        """Graph sanity for CI: every script exists, no cycle (constructor), no file written by two steps unless declared as an in-place
        edit, every input of an automatic step is either a source file or some step's output."""
        probs = []
        for s in self.steps.values():
            for argv in s["cmd"]:
                if not (self.root / argv[0]).exists():
                    probs.append(f"{s['name']}: script missing: {argv[0]}")
        names = list(self.steps)
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                both = [o for o in self.steps[a]["outputs"] for p in self.steps[b]["outputs"] if overlaps(o, p)]
                if both:
                    probs.append(f"{a} and {b} both write {both[0]}")
        return probs


# ------------------------------------------------------------------------------------------------------------------------------ cli
def owner_of(graph, rel):
    rel = rel.replace("\\", "/")
    for prefix in (str(graph.root) + "/", "insurance-dashboard/"):
        if rel.startswith(prefix):
            rel = rel[len(prefix):]
    writers = [n for n, s in graph.steps.items() if any(overlaps(o, rel) for o in s["outputs"] + s["edits"])]
    readers = [n for n, s in graph.steps.items() if any(overlaps(i, rel) for i in s["inputs"] + s["edits"] + s["code"]) and n not in writers]
    return rel, writers, readers


def main(argv=None):
    ap = argparse.ArgumentParser(description="fox data pipeline DAG (docs/PIPELINE.md)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, run nothing")
    ap.add_argument("--only", help="comma-separated steps or groups (deploy, facts)")
    ap.add_argument("--no-deps", action="store_true", help="with --only: do not add stale upstream steps")
    ap.add_argument("--manual", action="store_true", help="with --only: also run manual steps named there (network, duckdb, drive)")
    ap.add_argument("--why", help="explain a file: writer, staleness, readers")
    ap.add_argument("--graph", action="store_true", help="print the graph")
    ap.add_argument("--check", action="store_true", help="validate the graph (CI)")
    ap.add_argument("--adopt", action="store_true", help="record the current files as fresh without running (a checkout whose outputs "
                    "are known to match their inputs, e.g. right after a full build or for the manual steps)")
    a = ap.parse_args(argv)
    t0 = time.time()
    g = Graph(STEPS)
    if a.graph:
        print(g.graph_text())
        return 0
    if a.check:
        probs = g.check()
        for p in probs:
            print("  " + p)
        print(f"dag: {len(g.steps)} steps, {sum(len(d) for d in g.deps.values())} edges, {len(probs)} problems")
        return 1 if probs else 0
    if a.why:
        rel, writers, readers = owner_of(g, a.why)
        if not writers:
            print(f"{rel}: a source file (no step writes it)")
        for n in writers:
            r = g.why(n)
            s = g.steps[n]
            print(f"{rel}: written by {n} ({'manual: ' + ', '.join(sorted(s['needs'] & MANUAL)) if g.manual(n) else 'auto'}) - "
                  + ("fresh" if not r else "STALE: " + "; ".join(r)))
            up = [u for u in sorted(g.upstream(n), key=g.order.index) if g.why(u)]
            if up:
                print(f"  stale upstream: {', '.join(up)}")
        print(f"  read by: {', '.join(sorted(readers, key=g.order.index)) or '-'}")
        g.save()
        return 0
    targets = [t.strip() for t in a.only.split(",")] if a.only else None
    if a.adopt:
        names = [n for n, _, _ in g.plan(targets, deps=not a.no_deps, include_manual=True)]
        for n in names:
            sig, outs = g.signature(n)
            g.state["steps"][n] = {"sig": sig, "out": outs, "ran": None, "adopted": dt.datetime.now().isoformat(timespec="seconds")}
        g.save()
        print(f"dag: {len(names)} step(s) recorded as fresh without running ({', '.join(names) or '-'})")
        return 0
    plan = g.plan(targets, deps=not a.no_deps, include_manual=a.manual and bool(targets))
    if a.dry_run or not plan:
        for n, r, man in plan:
            print(f"  {'manual' if man else 'run   '} {n:22} {'; '.join(r)}" + (f"   [{', '.join(sorted(g.steps[n]['needs'] & MANUAL))}]" if man else ""))
        auto = [n for n, _, m in plan if not m]
        print(f"dag: {len(auto)} step(s) to run, {len(plan) - len(auto)} stale manual step(s); {len(g.steps)} steps"
              + (" (dry run)" if a.dry_run else "") + f"; {time.time() - t0:.2f}s, {g.hasher.read // 1024} KB hashed")
        g.save()
        return 0
    ran, manual, ok = g.run(plan)
    if a.no_deps and targets:
        skipped = sorted({u for n in ran for u in g.upstream(n) if u not in ran and not g.manual(u) and g.why(u)}, key=g.order.index)
        if skipped:
            print(f"  note: {len(skipped)} stale upstream step(s) not run (--no-deps): {', '.join(skipped[:6])}{' ...' if len(skipped) > 6 else ''}"
                  " (python3 pipeline/dag.py --dry-run)")
    if manual:
        print(f"  manual and stale (run yourself): {', '.join(manual)}")
    print(f"dag: {len(ran)} step(s) run in {time.time() - t0:.1f}s" + ("" if ok else "; FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
