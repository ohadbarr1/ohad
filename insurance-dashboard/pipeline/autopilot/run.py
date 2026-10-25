"""Report-day run: permitted discovery -> fetch the specific new files -> XBRL skeleton -> (LLM hook, off) -> DAG -> gate -> status.json
-> macOS notification with the publish command. Never deploys, never pushes, never commits.

python3 pipeline/autopilot/run.py                     # dry run: data.gov.il probe + local pickup, plan printed; status to $TMPDIR
python3 pipeline/autopilot/run.py --apply             # do it (what the schedule runs, via tick.py): permitted channels only
python3 pipeline/autopilot/run.py --maya-once         # MANUAL, owner only: one MAYA pass at <= 1 request / 2 s, then the same run
python3 pipeline/autopilot/run.py --maya-once --dry-run   # the MAYA pass listing what is new, nothing written
python3 pipeline/autopilot/run.py --apply --no-poll   # no network at all: rebuild the status from what is on disk
options: --replay DIR / --record DIR (see poll.py; imply a MAYA pass), --companies a,b, --skip-gate, --skip-build, --status-out PATH,
         --json PATH, --no-regulator, --no-notify

Discovery (docs/AUTOPILOT.md). TASE offers no channel for automated consumption of filings that fox may use: no RSS (maya.tase.co.il/rss
answers 403), the DataHub's free products are funds/indices/securities only (announcements are a paid feed), and MAYA's robots.txt
disallows /api/ ("bulk extraction ... require[s] explicit authorization"). So:
  scheduled   data.gov.il CKAN (regulator months) + local pickup (XBRL instances already in data/sources/xbrl that the registry has
              not parsed, e.g. after a --maya-once). MAYA only if ops/autopilot.toml has maya_scheduled AND maya_permission_ref.
  manual      --maya-once: the owner's own one-shot pass over the existing poller, 2 s between requests; a 403/429 stops it.

Steps
  1. discover    regulator probe (regulator.py), MAYA pass (poll.py, manual), local pickup
  2. fetch       regulator: dag fetch_regulator + build_market + build_funds; MAYA: the PDFs/XBRL of the new filings (poll.py --apply)
  3. skeleton    each new quarterly/annual XBRL instance -> xbrl_facts.json -> kpi.json (t0.py), status "unverified" until the printed
                 figure of the same report agrees
  4. extraction  llm.py: claude -p under EXTRACT_SPEC.md, OFF unless ops/autopilot.toml [llm] says on; budget-capped
  5. rebuild     python3 pipeline/dag.py --only deploy (the deploy group plus every stale automatic step upstream of it)
  6. gate        pipeline/gate.py; its verdict goes into status.json
  7. status      web/public/data/autopilot/status.json (only when something happened: a no-op tick leaves the repo untouched)
  8. publish     printed and notified for a human, never run: commit, push, wait for fox-ci, ./deploy.sh
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
import conf  # noqa: E402
import deltas  # noqa: E402
import llm  # noqa: E402
import notify  # noqa: E402
import poll as pl  # noqa: E402
import regulator as rg  # noqa: E402
import schedule as sch  # noqa: E402
import t0  # noqa: E402
from common import FILES, Blocked, Paths, read_json, write_json  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fetch_xbrl as fx  # noqa: E402

PY = sys.executable or "/usr/bin/python3"
DEPLOY = "./deploy.sh --check-only && ./deploy.sh"
DAG_DEPLOY = ["pipeline/dag.py", "--only", "deploy"]
DAG_REGULATOR = ["pipeline/dag.py", "--only", "fetch_regulator,build_market,build_funds", "--manual"]
PUBLISH_PATHS = ["web/public/data", "data/registry", "pipeline/taxonomy"]
TRACKED = ("annual", "quarterly", "presentation", "solvency", "liabilities")
TYPE_HE = {"annual": "דוח שנתי", "quarterly": "דוח רבעוני", "presentation": "מצגת", "solvency": "דוח סולבנסי", "liabilities": "מצבת התחייבויות"}
RUNS_KEPT = 20
CHANNEL = {
    "maya_feed": None,
    "finding": "אין לבורסה ערוץ לצריכה אוטומטית של דיווחים שמותר ל-fox להשתמש בו: אין RSS, ה-DataHub החינמי אינו כולל דיווחים, "
               "ו-robots.txt של MAYA אוסר /api/ ודורש אישור מפורש לשליפה שיטתית. הבקשה לבורסה: docs/TASE_REQUEST.md",
    "checked": "2026-10-25",
}


def has_duckdb():
    try:
        import duckdb  # noqa: F401
        return True
    except ImportError:
        return False


def llm_hook(filing, cfg, paths=None, budget=None):
    """The extraction step for one filing (llm.py): off unless ops/autopilot.toml [llm] is on; budget-capped when on."""
    est = (((cfg.get("estimates") or {}).get("llm") or {}).get("est_tokens") or {}).get(filing["type"])
    if paths is None or budget is None or not conf.llm_on(cfg):
        return {"ran": False, "why": "כבוי: ops/autopilot.toml [llm] (enabled + approved_by)", "est_tokens": est}
    return llm.extract(filing, cfg, paths, budget, est=est)


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
        "source": "MAYA (maya.tase.co.il), דוחות תקופתיים ו-XBRL (טופס ת930); רשות שוק ההון (data.gov.il); הנתונים המודפסים מהדוחות כפי שחולצו",
        "poll": None if not poll_res else {"at": poll_res["at"], "mode": poll_res["mode"], "blocked": poll_res["blocked"],
                                           "seen": sum(c["seen"] for c in poll_res["companies"].values()),
                                           "new": sum(1 for f in poll_res["filings"] if f.get("wanted")), "errors": len(poll_res["errors"])},
        "steps": steps, "gate": gate_res,
        "llm": {"enabled": conf.llm_on(cfg), "approved_by": (cfg.get("llm") or {}).get("approved_by") or None},
        "push": {"enabled": bool((cfg.get("estimates") or {}).get("push", {}).get("enabled"))},
        "deploy": {"command": DEPLOY, "auto": False},
        "filings_logged": len(log.get("filings", [])),
        "companies": rows,
    }


# ------------------------------------------------------------------------------------------------------------------------------ run
def run_dag(paths, argv, log, step="build"):
    """python3 pipeline/dag.py ... in the checkout; the last lines of its output go into the step record."""
    p = subprocess.run([PY, *argv], cwd=paths.root, capture_output=True, text=True, timeout=5400)
    out = (p.stdout + p.stderr).strip().splitlines()
    tail = " | ".join(x.strip() for x in out[-3:])[:300]
    log(f"  {' '.join(argv[1:])}: {'ok' if p.returncode == 0 else 'FAILED'} {tail}")
    return {"step": step, "script": " ".join(argv), "ok": p.returncode == 0, "tail": tail}


def git(paths, *args):
    try:
        p = subprocess.run(["git", *args], cwd=paths.root, capture_output=True, text=True, timeout=60)
        return p.stdout if p.returncode == 0 else None
    except Exception:  # noqa: BLE001
        return None


def pending_publication(paths):
    """What the live site does not have yet: data files changed in this checkout, and local commits not on origin (None outside git)."""
    st = git(paths, "status", "--porcelain", "--", *PUBLISH_PATHS)
    if st is None:
        return None
    files = sorted({ln[3:].strip().split(" -> ")[-1] for ln in st.splitlines() if ln.strip()})
    ahead = (git(paths, "rev-list", "--count", "@{u}..HEAD") or "").strip()
    return {"files": files[:60], "count": len(files), "ahead": int(ahead) if ahead.isdigit() else None,
            "head": (git(paths, "rev-parse", "--short", "HEAD") or "").strip() or None}


def publish_commands(paths, landed, cfg=None):
    """The exact commands a human runs to publish (deploy.sh refuses a dirty, unpushed or CI-red HEAD). In this checkout's own tree the
    folder shown is the configured one (ops/autopilot.toml [repo] path: where the schedule runs)."""
    home = str(Path.home())
    root = str(paths.root)
    if cfg and Path(root).resolve() == conf.ROOT.resolve():
        root = (cfg.get("repo") or {}).get("path") or root
    root = "~" + root[len(home):] if root.startswith(home) else root
    msg = "Autopilot: " + ("; ".join(landed)[:120] if landed else "data refresh")
    return [f"cd {root}", f"git add {' '.join(PUBLISH_PATHS)} && git commit -m {json.dumps(msg, ensure_ascii=False)}",
            "git push", "gh run list --workflow fox-ci --limit 1   # wait until it is green: deploy.sh refuses a red or running CI", DEPLOY]


def pickup(paths):
    """Quarterly/annual XBRL instances listed in documents.csv and present locally that xbrl_facts.json has not parsed yet."""
    reg = read_json(paths.xbrl_facts, {"reports": {}}) or {"reports": {}}
    have = set(reg.get("reports", {}))
    out = []
    for r in pl.documents(paths):
        if r["file_type"] == "xbrl" and r["doc_type"] in pl.PERIODIC and r["report_id"] not in have \
                and (paths.xbrl / f"{r['company']}_{r['report_id']}.xbrl").exists():
            out.append({"company": r["company"], "rid": int(r["report_id"]), "period": r["period"], "type": r["doc_type"]})
    return out


def _name(paths, cid):
    try:
        return next((c.get("name_he") or cid for c in pl.companies(paths) if c["id"] == cid), cid)
    except Exception:  # noqa: BLE001
        return cid


def run(paths, tr=None, apply=False, do_poll=True, only=None, skip_gate=False, skip_build=False, status_out=None, today=None, log=print,
        regulator=False, http=None, cfg=None, trigger="manual", notify_on=None):
    """One run. do_poll: a MAYA pass over `tr` (manual --maya-once, a replay, or the schedule with TASE's permission). regulator: the
    data.gov.il probe over `http`. trigger: schedule | manual | maya-once (a scheduled no-op run writes nothing)."""
    cfg = cfg if cfg is not None else conf.load()
    cfg = {**cfg, "estimates": read_json(paths.config, {}) or {}}
    notify_on = bool((cfg.get("notify") or {}).get("enabled")) if notify_on is None else notify_on
    today = today or pl.today_il()
    steps, kpi_preview, landed, problems = [], None, [], []
    poll_res, reg_res = None, None
    # 1. discover ------------------------------------------------------------------------------------------------------------
    if regulator:
        reg_res = rg.probe(http or rg.Http(), paths.data, log=log)
        new_m = [d for d in reg_res["datasets"] if d["new"]]
        steps.append({"step": "regulator", "ok": not reg_res["errors"],
                      "note": ("חודש חדש: " + ", ".join(f"{d['id']} {rg.month_label(d['upstream'])}" for d in new_m)) if new_m
                      else ("לא נבדק: " + reg_res["errors"][0]["error"][:80]) if reg_res["errors"] and not any(d.get("upstream") for d in reg_res["datasets"])
                      else "ללא חודש חדש"})
        if reg_res["errors"]:
            problems.append("data.gov.il: " + "; ".join(e["id"] for e in reg_res["errors"]))
    if do_poll:
        poll_res = pl.poll(paths, tr, only=only, apply=apply, today=today, log=log)
        steps.append({"step": "poll", "ok": not poll_res["blocked"], "note": f"{poll_res['mode']}: {sum(1 for f in poll_res['filings'] if f.get('wanted'))} חדשים"})
        if poll_res["blocked"]:
            problems.append("MAYA חסמה: " + str(poll_res["blocked"])[:80])
    filings = [f for f in (poll_res or {}).get("filings", []) if f.get("wanted")]
    periodic = [f for f in filings if f["type"] in pl.PERIODIC and f.get("xbrl")]
    picked = pickup(paths) if not periodic else []
    if picked:
        steps.append({"step": "pickup", "ok": True, "note": f"{len(picked)} מופעי XBRL מקומיים שטרם נקלטו"})
    # 2. fetch (regulator) ---------------------------------------------------------------------------------------------------
    reg_new = bool(reg_res and reg_res["new"])
    if reg_new and apply and not skip_build:
        r = run_dag(paths, DAG_REGULATOR, log, step="regulator-fetch")
        steps.append(r)
        if r["ok"]:
            landed += [f"רשות שוק ההון {rg.month_label(d['upstream'])} ({d['id']})" for d in reg_res["datasets"] if d["new"]]
        else:
            problems.append("שליפת נתוני הרשות נכשלה")
    elif reg_new:
        steps.append({"step": "regulator-fetch", "ok": True, "planned": [" ".join(DAG_REGULATOR)], "note": "dry run" if not apply else "skipped"})
    # 3. skeleton ------------------------------------------------------------------------------------------------------------
    t0res = None
    if periodic and not apply:
        kpi_preview, t0res = preview_skeleton(paths, tr, periodic, log)
    elif apply and (periodic or picked or not (do_poll or regulator)):
        if periodic or picked:
            fx.registry(root=paths.root, quiet=True)
        if (periodic or picked) and has_duckdb() and not skip_build:
            steps.append(run_script(paths, "fetch_xbrl.py", log) | {"step": "xbrl"})
            steps.append(run_script(paths, "build_kpi.py", log) | {"step": "kpi"})  # calls t0.run itself
        t0res = t0.run(paths, apply=True, today=today, log=log)  # idempotent: verify the T+0 periods against the printed figures
    if t0res is not None:
        steps.append({"step": "skeleton", "ok": True, "new": t0res["new"], "replaced": t0res["replaced"], "ext": t0res["ext"],
                      "verified": [list(x) for x in t0res["verified"]], "applied": apply})
        if apply:
            landed += [f"{_name(paths, c)} {deltas.PL(p)} · שלד XBRL (לא מאומת)" for c, p, *_ in t0res["new"]]
            landed += [f"{_name(paths, c)} {deltas.PL(p)} · אומת מול הדוח" for c, p, *_ in t0res["verified"]]
    if apply and not (poll_res or {}).get("blocked"):
        for f in filings:
            if f["type"] not in pl.PERIODIC or not f.get("xbrl"):
                per = deltas.PL(f["period"]) if f.get("period") else ""
                landed.append(f"{_name(paths, f['company'])} · {TYPE_HE.get(f['type'], f['type'])} {per}".strip())
    # 4. extraction hook -----------------------------------------------------------------------------------------------------
    budget = llm.Budget(paths, cfg) if conf.llm_on(cfg) and apply else None
    for f in filings:
        f["llm"] = llm_hook(f, cfg, paths if apply else None, budget)
    if filings:
        ran = [f for f in filings if f["llm"].get("ran")]
        steps.append({"step": "extraction", "ok": all(f["llm"].get("ok") for f in ran), "ran": len(ran), "skipped": len(filings) - len(ran),
                      "tokens": sum(f["llm"].get("tokens") or 0 for f in ran),
                      "est_tokens": sum((f["llm"].get("est_tokens") or 0) for f in filings),
                      "note": "כבוי עד אישור הבעלים" if not conf.llm_on(cfg) else f"{len(ran)} חולצו · לא מאומת"})
    # 5. rebuild -------------------------------------------------------------------------------------------------------------
    changed = bool(reg_new or filings or (t0res and (t0res["new"] or t0res["replaced"] or t0res["ext"] or t0res["verified"])))
    if changed or (apply and not (do_poll or regulator)):
        if apply and not skip_build:
            r = run_dag(paths, DAG_DEPLOY, log)
            steps.append(r)
            if not r["ok"]:
                problems.append("הבנייה (dag.py) נכשלה")
        else:
            steps.append({"step": "build", "ok": True, "planned": [" ".join(DAG_DEPLOY)], "note": "dry run" if not apply else "skipped"})
    # 6. gate ----------------------------------------------------------------------------------------------------------------
    gate_res = {"ran": False, "ok": None, "fails": [], "note": "dry run" if not apply else "skipped"}
    if apply and not skip_gate and (changed or not (do_poll or regulator)):
        gate_res = gate(paths, log)
        if not gate_res["ok"]:
            problems.append("שער האיכות נכשל: " + ", ".join(gate_res["fails"][:4]))
    # 7. status --------------------------------------------------------------------------------------------------------------
    mode = "apply" if apply else "dry-run"
    status = build_status(paths, mode, poll_res, steps, gate_res, cfg, kpi=kpi_preview, today=today)
    prev = read_json(paths.status, {}) or {}
    if status["poll"] is None and prev.get("poll"):
        status["poll"] = {**prev["poll"], "carried": True}  # the last MAYA pass stays on record with its own date (no new request)
    substantive = bool(landed or problems or gate_res["ran"] or trigger != "schedule")
    entry = {"at": status["built"], "trigger": trigger, "mode": mode, "landed": landed, "problems": problems,
             "gate": gate_res.get("ok") if gate_res["ran"] else None, "maya": bool(do_poll), "regulator": bool(regulator)}
    pend = pending_publication(paths)
    status.update(
        schedule=sch.summary(cfg, read_json(paths.data / "calendar.json", {}), today),
        discovery={"regulator": bool(cfg["discovery"].get("regulator")), "maya_scheduled": conf.maya_scheduled(cfg),
                   "maya_permission_ref": cfg["discovery"].get("maya_permission_ref") or None, "maya_manual": "python3 pipeline/autopilot/run.py --maya-once",
                   "maya_interval_seconds": max(2.0, float(cfg["discovery"].get("maya_interval_seconds") or 2.0)), **CHANNEL},
        regulator=reg_res if reg_res else prev.get("regulator"),
        runs=([entry] + [r for r in prev.get("runs", []) if r.get("at") != entry["at"]])[:RUNS_KEPT] if substantive and apply else prev.get("runs", []),
        publish={"pending": pend, "commands": publish_commands(paths, landed or [x for r in prev.get("runs", [])[:3] for x in r.get("landed", [])], cfg),
                 "auto": False, "note": "deploy.sh מפרסם רק commit נקי, דחוף, ש-fox-ci עבר עליו"},
        llm_budget=(budget or llm.Budget(paths, cfg)).summary() | {"enabled": conf.llm_on(cfg)},
        extracted_pending=llm.pending(paths),
    )
    if status_out:
        out = Path(status_out)
    elif apply and substantive:
        out = paths.status
    elif apply:
        out = None  # a scheduled tick that found nothing: the repo stays untouched (tick.py keeps its own heartbeat)
    else:
        out = Path(tempfile.gettempdir()) / "fox-autopilot" / "status.json"
    if out:
        write_json(out, status)
        log(f"status: {out}")
    if apply and filings:
        lg = read_json(paths.filings, {"filings": []})
        for e in lg["filings"]:
            f = next((x for x in filings if x["rid"] == e["rid"]), None)
            if f:
                e["llm"] = f["llm"]
                e["run"] = status["built"]
        write_json(paths.filings, lg, compact=False)
    status["_poll"] = poll_res  # for --json (the CI artifact): every new filing, wanted or not, with its classification
    status["_landed"], status["_problems"], status["_written"] = landed, problems, str(out) if out else None
    # 8. publish: printed and notified, never run ----------------------------------------------------------------------------
    if apply and (landed or problems):
        ok = gate_res.get("ok")
        cmds = status["publish"]["commands"]
        log(("gate passed; to publish, a human runs:\n  " if ok else "gate did not pass (or was skipped); after fixing, a human runs:\n  ")
            + "\n  ".join(cmds))
        if notify_on:
            title = "fox · " + ("נחת: " + landed[0] if landed else "דרושה בדיקה")
            body = ("; ".join(landed[1:3]) + " · " if len(landed) > 1 else "") + ("; ".join(problems) + " · " if problems else "") \
                + ("שער עבר · לפרסום: ./deploy.sh (אחרי commit, push ו-CI ירוק)" if ok else "השער לא עבר: python3 pipeline/gate.py")
            status["_notified"] = notify.show(title, body, subtitle=f"{len(landed)} עדכונים" if landed else None)
    return status


def main(argv=None):
    def extra(ap):
        ap.add_argument("--no-poll", action="store_true", help="no network at all: rebuild from what is on disk")
        ap.add_argument("--maya-once", action="store_true", help="MANUAL: one MAYA pass at <= 1 request / 2 s, then the run (implies --apply)")
        ap.add_argument("--dry-run", action="store_true", help="with --maya-once: list what is new, write nothing")
        ap.add_argument("--no-regulator", action="store_true", help="skip the data.gov.il probe")
        ap.add_argument("--no-notify", action="store_true")
        ap.add_argument("--skip-gate", action="store_true")
        ap.add_argument("--skip-build", action="store_true")
        ap.add_argument("--status-out", help="where to write status.json")
        ap.add_argument("--trigger", default=None, help=argparse_hidden())
    a = pl.args(argv, extra)
    cfg = conf.load()
    paths = Paths(a.root)
    apply = (a.apply or a.maya_once) and not a.dry_run
    maya = bool(a.maya_once or a.replay or a.record) and not a.no_poll
    if a.maya_once:
        a.interval = max(2.0, float(cfg["discovery"].get("maya_interval_seconds") or 2.0), a.interval)  # <= 1 request / 2 s
    elif not maya and conf.maya_scheduled(cfg) and not a.no_poll:
        maya, a.interval = True, max(2.0, float(cfg["discovery"]["maya_interval_seconds"]))  # TASE's written permission on record
    tr = pl.transport(a) if maya else None
    st = run(paths, tr, apply=apply, do_poll=maya, only=[c for c in a.companies.split(",") if c] or None,
             skip_gate=a.skip_gate, skip_build=a.skip_build, status_out=a.status_out,
             today=dt.date.fromisoformat(a.today) if a.today else None,
             regulator=not (a.no_regulator or a.no_poll or a.replay) and bool(cfg["discovery"].get("regulator")),
             cfg=cfg, trigger=a.trigger or ("maya-once" if a.maya_once else "manual"), notify_on=False if a.no_notify else None)
    if a.json:
        write_json(a.json, {"status": {k: v for k, v in st.items() if not k.startswith("_")}, "poll": st.get("_poll")}, compact=False)
    blocked = (st.get("poll") or {}).get("blocked")
    return 2 if blocked else 0


def argparse_hidden():
    import argparse  # noqa: PLC0415
    return argparse.SUPPRESS


if __name__ == "__main__":
    sys.exit(main())
