"""Report-day run plan: new filing -> fetch -> XBRL skeleton -> (extraction hook, off) -> rebuild -> gate -> status.json. Never deploys.

python3 pipeline/autopilot/run.py                     # dry run: poll, preview the skeleton in memory, print the plan; writes only
                                                      #   the status file to $TMPDIR/fox-autopilot/status.json (or --status-out)
python3 pipeline/autopilot/run.py --apply             # do it: fetch, registry, kpi.json, builders, gate, web/public/data/autopilot/status.json
python3 pipeline/autopilot/run.py --apply --no-poll   # no network: rebuild the status from what is on disk
options: --replay DIR / --record DIR (see poll.py), --companies a,b, --skip-gate, --skip-build, --status-out PATH, --json PATH

Steps
  1. poll        poll.py over the listed companies (dry run unless --apply)
  2. skeleton    each new quarterly/annual report with an XBRL instance -> data/registry/xbrl_facts.json -> kpi.json (t0.py):
                 the period appears with its 19 tagged values, status "unverified", until the printed figure of the same report agrees
                 (t0.verify). With duckdb importable, fetch_xbrl.py + build_kpi.py run instead (build_kpi.py calls t0 itself).
  3. extraction  hook only. The owner-approved LLM extraction of the PDF (statements v6, IFRS 17, solvency, presentation KPIs) would run
                 here under a token budget (config.json "llm"); it is OFF and nothing here calls a model. Each filing records the
                 estimate and why it was skipped.
  4. rebuild     the builders whose inputs changed, in deploy.sh's order (canon_kpi, build_registry, build_calendar, build_coverage)
  5. gate        pipeline/gate.py; its verdict goes into status.json
  6. status      web/public/data/autopilot/status.json: per company the latest filing seen, what the site publishes, what is
                 unverified, headline deltas with sources, the next expected report; the run's own log
  7. deploy      printed for a human, never run: the exact ./deploy.sh command
"""
import csv
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deltas  # noqa: E402
import poll as pl  # noqa: E402
import t0  # noqa: E402
from common import FILES, Blocked, Paths, read_json, write_json  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fetch_xbrl as fx  # noqa: E402

PY = sys.executable or "/usr/bin/python3"
DEPLOY = "cd insurance-dashboard && ./deploy.sh --check-only && ./deploy.sh"
BUILDERS_KPI = ["canon_kpi.py", "build_registry.py", "build_coverage.py"]
BUILDERS_DOCS = ["build_calendar.py", "build_coverage.py"]
TRACKED = ("annual", "quarterly", "presentation", "solvency", "liabilities")
TYPE_HE = {"annual": "דוח שנתי", "quarterly": "דוח רבעוני", "presentation": "מצגת", "solvency": "דוח סולבנסי", "liabilities": "מצבת התחייבויות"}


def has_duckdb():
    try:
        import duckdb  # noqa: F401
        return True
    except ImportError:
        return False


def llm_hook(filing, cfg):
    """The point where the owner-approved extraction would run. Off: records the estimate and the reason, calls nothing."""
    llm = cfg.get("llm", {})
    est = (llm.get("est_tokens") or {}).get(filing["type"])
    if not llm.get("enabled") or not llm.get("approved_by") or not llm.get("budget_tokens_per_run"):
        return {"ran": False, "why": "כבוי: דורש אישור תקציב של הבעלים (config.json llm)", "est_tokens": est}
    # deliberately not implemented in wave 1: the extraction spec, queue and budget accounting land with the owner's approval
    return {"ran": False, "why": "מאושר אך טרם מומש בגל זה", "est_tokens": est}


def preview_skeleton(paths, tr, filings, log):
    """Dry run: read the new instances into memory (no file written) and show what kpi.json would gain."""
    reg = read_json(paths.xbrl_facts, {"reports": {}})
    reg = {**reg, "reports": dict(reg.get("reports", {}))}
    got = 0
    for f in filings:
        if f["type"] not in pl.PERIODIC or not f.get("xbrl"):
            continue
        try:
            raw = tr.get_bytes(FILES + f["xbrl"])
        except Blocked:
            raise
        except Exception as e:  # noqa: BLE001
            f["preview_error"] = str(e)[:160]
            continue
        inst = fx.instance(raw.decode("utf-8", errors="replace"))
        if inst:
            reg["reports"][str(f["rid"])] = {"c": f["company"], "dt": f["type"], "p": f["period"], "pub": f["publish"][:10], **inst}
            got += 1
    kpi = read_json(paths.kpi)
    if not kpi or not got:
        return kpi, {"new": [], "replaced": [], "ext": 0, "verified": []}
    res = t0.merge(kpi, reg, log=lambda m: log("  (preview) " + m))
    res["verified"] = t0.verify(kpi, paths, log=lambda m: log("  (preview) " + m))
    return kpi, res


def run_script(paths, name, log):
    p = subprocess.run([PY, str(paths.root / "pipeline" / name)], cwd=paths.root, capture_output=True, text=True, timeout=3600)
    tail = (p.stdout.strip().splitlines() or [""])[-1][:200]
    log(f"  {name}: {'ok' if p.returncode == 0 else 'FAILED'} {tail}")
    return {"script": name, "ok": p.returncode == 0, "tail": tail if p.returncode == 0 else (p.stderr.strip().splitlines() or [""])[-1][:300]}


def gate(paths, log):
    p = subprocess.run([PY, str(paths.root / "pipeline" / "gate.py")], cwd=paths.root, capture_output=True, text=True, timeout=3600)
    qa = read_json(paths.data / "qa.json", {})
    fails = [c["id"] for c in qa.get("checks", []) if not c.get("ok") and c.get("level") == "fail"]
    log(f"gate: {'passed' if p.returncode == 0 else 'FAILED'}" + (f" ({', '.join(fails)})" if fails else ""))
    return {"ran": True, "ok": p.returncode == 0, "fails": fails, "built": qa.get("built")}


# ---------------------------------------------------------------------------------------------------------------------- status.json
def _latest_period(cells, periods, kinds):
    best = None
    for pi, *_ in cells:
        typ, end = periods[pi]
        if typ in kinds and (best is None or end > best):
            best = end
    return best


def published(paths, comp, kpi, lines, csm, cap):
    out = {}
    c = (kpi or {}).get("companies", {}).get(comp)
    if c and c.get("periods"):
        out["kpi"] = {"period": c["periods"][-1], "status": c["status"][-1], "rid": (c.get("rid") or [None])[-1]}
    if lines:
        row = lines["data"].get("total_assets", {}).get(comp) or lines["data"].get("np_attr", {}).get(comp)
        if row:
            e = _latest_period(row["cells"], lines["periods"], ("I", "Q", "FY"))
            if e:
                out["statements"] = e
    res = ((csm or {}).get("resolved") or {}).get(comp)
    if res:
        out["csm"] = max(res)
    sr = (((cap or {}).get("companies") or {}).get(comp) or {}).get("sr_w")
    if sr:
        ordk = lambda k: (int(k[:4]), 4 if k.endswith("FY") else int(k[5]))  # noqa: E731
        out["solvency"] = max(sr, key=ordk)
    return out


def build_status(paths, mode, poll_res, steps, gate_res, cfg, kpi=None, today=None):
    today = today or dt.date.today()
    kpi = kpi or read_json(paths.kpi, {})
    lines = read_json(paths.data / "lines.json")
    csm = read_json(paths.data / "csm" / "summary.json")
    cap = read_json(paths.data / "csm" / "capital.json")
    cal = {x["id"]: x for x in (read_json(paths.data / "calendar.json", {}) or {}).get("companies", [])}
    docs = pl.documents(paths)
    log = read_json(paths.filings, {"filings": []})
    by = {}
    for r in docs:
        if r["doc_type"] not in TRACKED:
            continue
        k = (r["company"], int(r["report_id"]))
        if k not in by:
            by[k] = {"rid": int(r["report_id"]), "type": r["doc_type"], "period": r["period"], "date": r["publish_date"][:10],
                     "title": " ".join(r["title"].split()), "xbrl": False}
        if r["file_type"] == "xbrl":
            by[k]["xbrl"] = True
    for f in (poll_res or {}).get("filings", []):  # a dry run's new filings are not in documents.csv: show them as seen
        if f.get("wanted"):
            by.setdefault((f["company"], f["rid"]), {"rid": f["rid"], "type": f["type"], "period": f["period"], "date": f["publish"][:10],
                                                     "title": f["title"], "xbrl": bool(f.get("xbrl")), "new": True})
    newset = {(f["company"], f["rid"]) for f in (poll_res or {}).get("filings", []) if f.get("wanted")}
    pdf_of, report_of = {}, {}  # report id -> PDF; (company, period) -> the first periodic report's PDF (a CSM figure names its report period)
    for r in sorted(docs, key=lambda r: r["publish_date"]):
        if r["file_type"] == "pdf1":
            pdf_of.setdefault(int(r["report_id"]), FILES + r["url"])
            if r["doc_type"] in pl.PERIODIC:
                report_of.setdefault((r["company"], r["period"]), (int(r["report_id"]), FILES + r["url"]))

    def resolve(cid, h):
        for it in (h or {}).get("items", []):
            for sr in it["src"]:
                if sr["k"] != "report" or sr.get("url"):
                    continue
                if sr.get("rid"):
                    sr["url"] = pdf_of.get(sr["rid"])
                elif (cid, sr.get("period")) in report_of:
                    sr["rid"], sr["url"] = report_of[(cid, sr["period"])]
        return h
    rows = []
    for co in pl.companies(paths):
        cid = co["id"]
        mine = sorted((v for (c, _), v in by.items() if c == cid), key=lambda v: (v["date"], v["rid"]), reverse=True)
        for v in mine:
            v["new"] = (cid, v["rid"]) in newset or v.get("new", False)
        # the report day of the latest period: its first filing (a translation or an amendment can follow weeks later), with XBRL if any
        per_ = [v for v in mine if v["type"] in pl.PERIODIC and v["period"]]
        top = max((v["period"] for v in per_), key=lambda p: (p[:4], p[4:].replace("FY", "Q4")), default=None)
        same = sorted((v for v in per_ if v["period"] == top), key=lambda v: (not v["xbrl"], v["date"], v["rid"]))
        periodic = same[0] if same else None
        c = (kpi.get("companies") or {}).get(cid) or {}
        unv = []
        for i, p in enumerate(c.get("periods", [])[-6:], start=max(0, len(c.get("periods", [])) - 6)):
            st = c["status"][i]
            e = (c.get("t0") or {}).get(p)
            if st in ("unverified", "withheld") or (e and "verified" not in e):
                unv.append({"period": p, "status": st, "rid": (c.get("rid") or [None] * (i + 1))[i], "t0": bool(e),
                            **({"conflict": e["conflict"]} if e and e.get("conflict") else {}), **({"how": e["how"]} if e else {})})
        h = None if cal.get(cid, {}).get("inactive") else resolve(cid, deltas.headline(cid, kpi, csm, cap))
        if h:
            h["push"]["title"] = f"{co.get('name_he', cid)} {deltas.PL(h['period'])}"
        nx = cal.get(cid, {}).get("next")
        rows.append({"id": cid, "name": co.get("name_he", cid), "kind": co.get("kind"), "maya_id": co.get("maya_id"),
                     "latest": periodic, "recent": mine[:4], "published": published(paths, cid, kpi, lines, csm, cap),
                     "unverified": unv, "deltas": h, "next": {k: nx.get(k) for k in ("period", "expected", "lo", "hi")} if nx and nx.get("expected") else None,
                     "inactive": bool(cal.get(cid, {}).get("inactive")),
                     "note": None if co.get("maya_id") else "לא מדווחת ב-MAYA (אין מזהה חברה בבורסה): אין דוחות לסקור"})
    return {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "mode": mode,
        "source": "MAYA (maya.tase.co.il), דוחות תקופתיים ו-XBRL (טופס ת930); הנתונים המודפסים מהדוחות כפי שחולצו",
        "poll": None if not poll_res else {"at": poll_res["at"], "mode": poll_res["mode"], "blocked": poll_res["blocked"],
                                           "seen": sum(c["seen"] for c in poll_res["companies"].values()),
                                           "new": sum(1 for f in poll_res["filings"] if f.get("wanted")), "errors": len(poll_res["errors"])},
        "steps": steps, "gate": gate_res, "llm": {"enabled": bool(cfg.get("llm", {}).get("enabled")), "approved_by": cfg.get("llm", {}).get("approved_by")},
        "push": {"enabled": bool(cfg.get("push", {}).get("enabled"))},
        "deploy": {"command": DEPLOY, "auto": False},
        "filings_logged": len(log.get("filings", [])),
        "companies": rows,
    }


# ------------------------------------------------------------------------------------------------------------------------------ run
def run(paths, tr=None, apply=False, do_poll=True, only=None, skip_gate=False, skip_build=False, status_out=None, today=None, log=print):
    cfg = read_json(paths.config, {}) or {}
    steps, kpi_preview = [], None
    poll_res = None
    if do_poll:
        poll_res = pl.poll(paths, tr, only=only, apply=apply, today=today, log=log)
        steps.append({"step": "poll", "ok": not poll_res["blocked"], "note": f"{poll_res['mode']}: {sum(1 for f in poll_res['filings'] if f.get('wanted'))} חדשים"})
    filings = [f for f in (poll_res or {}).get("filings", []) if f.get("wanted")]
    periodic = [f for f in filings if f["type"] in pl.PERIODIC and f.get("xbrl")]
    # 2. skeleton
    t0res = None
    if periodic and not apply:
        kpi_preview, t0res = preview_skeleton(paths, tr, periodic, log)
    elif apply and (periodic or not do_poll):
        if periodic:
            fx.registry(root=paths.root, quiet=True)
        if periodic and has_duckdb() and not skip_build:
            steps.append(run_script(paths, "fetch_xbrl.py", log) | {"step": "xbrl"})
            steps.append(run_script(paths, "build_kpi.py", log) | {"step": "kpi"})  # calls t0.run itself
            t0res = t0.run(paths, apply=True, today=today, log=log)  # idempotent: verify the T+0 periods against the printed figures
        else:
            t0res = t0.run(paths, apply=True, today=today, log=log)
    if t0res is not None:
        steps.append({"step": "skeleton", "ok": True, "new": t0res["new"], "replaced": t0res["replaced"], "ext": t0res["ext"],
                      "verified": [list(x) for x in t0res["verified"]], "applied": apply})
    # 3. extraction hook (off)
    for f in filings:
        f["llm"] = llm_hook(f, cfg)
    if filings:
        steps.append({"step": "extraction", "ok": True, "ran": 0, "skipped": len(filings),
                      "est_tokens": sum((f["llm"]["est_tokens"] or 0) for f in filings), "note": "כבוי עד אישור הבעלים"})
    # 4. rebuild
    todo = []
    if t0res and (t0res["new"] or t0res["replaced"] or t0res["ext"] or t0res["verified"]):
        todo += BUILDERS_KPI
    if filings:
        todo += [b for b in BUILDERS_DOCS if b not in todo]
    if todo:
        if apply and not skip_build:
            for b in todo:
                steps.append(run_script(paths, b, log) | {"step": "build"})
        else:
            steps.append({"step": "build", "ok": True, "planned": todo, "note": "dry run" if not apply else "skipped"})
    # 5. gate
    gate_res = {"ran": False, "ok": None, "fails": [], "note": "dry run" if not apply else "skipped"}
    if apply and not skip_gate and (todo or not do_poll):
        gate_res = gate(paths, log)
    # 6. status
    mode = "apply" if apply else "dry-run"
    status = build_status(paths, mode, poll_res, steps, gate_res, cfg, kpi=kpi_preview, today=today)
    out = Path(status_out) if status_out else (paths.status if apply else Path(tempfile.gettempdir()) / "fox-autopilot" / "status.json")
    write_json(out, status)
    if apply and filings:
        lg = read_json(paths.filings, {"filings": []})
        for e in lg["filings"]:
            f = next((x for x in filings if x["rid"] == e["rid"]), None)
            if f:
                e["llm"] = f["llm"]
                e["run"] = status["built"]
        write_json(paths.filings, lg, compact=False)
    log(f"status: {out}")
    status["_poll"] = poll_res  # for --json (the CI artifact): every new filing, wanted or not, with its classification
    # 7. deploy: printed, never run
    if apply and (todo or not do_poll):
        ok = gate_res.get("ok")
        log(("gate passed; to publish, a human runs:\n  " if ok else "gate did not pass (or was skipped); after fixing, a human runs:\n  ") + DEPLOY)
    return status


def main(argv=None):
    def extra(ap):
        ap.add_argument("--no-poll", action="store_true", help="skip the network poll: rebuild from what is on disk")
        ap.add_argument("--skip-gate", action="store_true")
        ap.add_argument("--skip-build", action="store_true")
        ap.add_argument("--status-out", help="where to write status.json")
    a = pl.args(argv, extra)
    paths = Paths(a.root)
    tr = None if a.no_poll else pl.transport(a)
    st = run(paths, tr, apply=a.apply, do_poll=not a.no_poll, only=[c for c in a.companies.split(",") if c] or None,
             skip_gate=a.skip_gate, skip_build=a.skip_build, status_out=a.status_out,
             today=dt.date.fromisoformat(a.today) if a.today else None)
    if a.json:
        write_json(a.json, {"status": {k: v for k, v in st.items() if k != "_poll"}, "poll": st.get("_poll")}, compact=False)
    blocked = (st.get("poll") or {}).get("blocked")
    return 2 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
