"""Report-day poller: ask MAYA, for each listed company, what it filed since the last report id the autopilot saw.

python3 pipeline/autopilot/poll.py                    # dry run: list what is new and what would be fetched; writes nothing
python3 pipeline/autopilot/poll.py --apply            # fetch the PDFs and XBRL instances into the source layout, append the registry
python3 pipeline/autopilot/poll.py --replay DIR       # recorded responses instead of the network (tests, CI smoke)
python3 pipeline/autopilot/poll.py --record DIR       # live, and keep every response in DIR in the replay layout
options: --companies phoenix,harel  --types annual,quarterly,presentation,liabilities,solvency  --json out.json  --interval 1.0

State: data/registry/autopilot_state.json {companies: {id: {last_id, last_publish, checked}}}; seeded from documents.csv the first time.
A filing is new when its MAYA report id is above last_id and not already in documents.csv. Each one is classified with the same rules
as pipeline/fetch_maya.py (doc type from the title, period from the title or the filing window); a quarterly/annual report's period is
then taken from its own XBRL instance when one is attached (the instance states its dates; a title can be wrong).
--apply writes: data/sources/pdf/<company>/<period>/<rid>_<type>[_n].pdf and data/sources/xbrl/<company>_<rid>.xbrl (the layout
fetch_maya.py and fetch_xbrl.py use), one documents.csv row per attachment, the warehouse documents table when duckdb is importable,
data/registry/autopilot_filings.json (the autopilot's log) and the state. The raw list responses are cached under
data/raw/maya_autopilot/<date>/ (small JSON). A 403/429 stops the poll: the result says blocked, nothing is retried around it.
"""
import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import API, FILES, Blocked, Live, Paths, Recorder, Replay, fm, read_json, write_json  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fetch_xbrl  # noqa: E402

TYPES = ("annual", "quarterly", "presentation", "liabilities", "solvency")
PERIODIC = ("annual", "quarterly")
OVERLAP_DAYS = 3  # the list window starts this many days before the last filing seen (ids decide what is new; the overlap only guards clocks)
COLS = ["report_id", "company", "publish_date", "doc_type", "period", "title", "file_type", "size_kb", "pages", "url", "local_path", "sha256"]


def today_il():
    """The date in Israel (MAYA's calendar); a runner on UTC would otherwise ask for yesterday after 21:00/22:00 local."""
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("Asia/Jerusalem")).date()
    except Exception:  # noqa: BLE001
        return dt.date.today()


def companies(paths, only=None):
    reg = json.loads(paths.companies.read_text(encoding="utf-8"))
    reg = reg if isinstance(reg, list) else reg.get("companies", [])
    return [c for c in reg if not only or c["id"] in only]


def documents(paths):
    if not paths.documents.exists():
        return []
    with open(paths.documents, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def seed_state(paths):
    """First run: the newest report id per company already in the registry is the last one seen."""
    st = {}
    for r in documents(paths):
        c, rid = r["company"], int(r["report_id"])
        if c not in st or rid > st[c]["last_id"]:
            st[c] = {"last_id": rid, "last_publish": r["publish_date"][:19].replace(" ", "T"), "checked": None, "seeded": True}
    return {"version": 1, "updated": None, "companies": st}


def load_state(paths):
    return read_json(paths.state) or seed_state(paths)


def list_window(tr, maya_id, start, end):
    """All reports of one company in [start, end], every event family (liabilities schedules are not in the financial family)."""
    rows, offset = [], 0
    while True:
        body = {"companyId": maya_id, "fromDate": start, "toDate": end, "isPriority": False, "isTradeHalt": False, "offset": offset}
        page = tr.post_json(f"{API}/reports/companies", body)
        rows += page or []
        if len(page or []) < fm.PAGE or offset > 600:
            return rows
        offset += fm.PAGE


def classify(report):
    """company-agnostic classification of one MAYA report: doc type, period, attachments."""
    title = " ".join((report.get("title") or "").split())
    typ = fm.classify(title)
    per = fm.period_of(title, report["publishDate"], typ) if typ else None
    # a title with no year, quarter or date ("מצגת משקיעים בשפה האנגלית") gets its period from the filing window: a guess, said so
    explicit = bool(re.search(r"20[12]\d|רבעון|\bq[1-4]|[1-4]q\b|\d{1,2}[./]\d{1,2}[./]\d{2,4}|ראשון|שני|שלישי|חצי שנתי|שנתי|annual|half|quarter", title.lower()))
    att = report.get("attachments") or []
    pdfs = [a for a in att if str(a.get("fileType", "")).startswith("pdf")]
    xbrl = next((a for a in att if a.get("fileType") == "xbrl"), None)
    htm = next((a for a in att if a.get("fileType") == "htm"), None)
    return {"rid": int(report["id"]), "title": title, "publish": report["publishDate"][:19], "form": report.get("formId"),
            "type": typ, "period": per, "period_from": ("title" if explicit else "window") if typ else None,
            "pdf": [{"url": a["url"], "kb": a.get("fileSize"), "name": a.get("fileName"), "ft": a["fileType"]} for a in pdfs],
            "xbrl": xbrl["url"] if xbrl else None, "htm": htm["url"] if htm else None, "attachments": att}


def pdf_dest(paths, comp, per, rid, typ, url):
    part = re.search(r"-(\d+)\.pdf$", url)
    return paths.pdf / comp / per / f"{rid}_{typ}{'_' + part.group(1) if part and part.group(1) != '00' else ''}.pdf"


def liab_dest(paths, rid):
    """A liabilities schedule (form ת126) is an htm form, no PDF: cached where the debt-ladder lane reads it
    (pipeline/fetch_liabilities.py: data/raw/maya_liabilities/htm/<report_id>.htm.gz), so it is not fetched twice."""
    return paths.root / "data" / "raw" / "maya_liabilities" / "htm" / f"{rid}.htm.gz"


def xbrl_period(inst, typ):
    """YYYYQn / YYYYFY from the instance's own reporting date (as build_kpi.py reads it)."""
    end = dt.date.fromisoformat(inst["e"])
    q = 4 if typ == "annual" else end.month // 3
    return f"{end.year}FY" if q == 4 else f"{end.year}Q{q}"


def append_documents(paths, rows):
    """Append rows to documents.csv, idempotent on (report_id, url)."""
    have = {(r["report_id"], r["url"]) for r in documents(paths)}
    new = [r for r in rows if (str(r["report_id"]), r["url"]) not in have]
    if not new:
        return 0
    exists = paths.documents.exists()
    with open(paths.documents, "a", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        if not exists:
            w.writeheader()
        for r in new:
            w.writerow({k: r.get(k, "") for k in COLS})
    return len(new)


def upsert_warehouse(paths, rows, maya_ids):
    """The warehouse documents table too, when duckdb is importable (it is in CI and in the owner's venv; not under /usr/bin/python3)."""
    try:
        import duckdb  # noqa: F401
    except ImportError:
        return "skipped (duckdb not importable)"
    con = fm.connect(paths.warehouse)  # creates the documents table when the warehouse is new (a test's temp root, a fresh clone)
    for r in rows:
        con.execute("""insert into documents (report_id, company, maya_company_id, title, publish_date, form_id, financial_family, doc_type,
                period, file_type, file_name, size_kb, url, local_path, sha256, bytes, downloaded_at)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, case when ? is null then null else now() end)
            on conflict (report_id, url) do update set doc_type=excluded.doc_type, period=excluded.period,
                local_path=coalesce(excluded.local_path, documents.local_path), sha256=coalesce(excluded.sha256, documents.sha256)""",
                    [r["report_id"], r["company"], maya_ids.get(r["company"]), r["title"], r["publish_date"], r.get("form"),
                     r["doc_type"] in PERIODIC, r["doc_type"], r["period"], r["file_type"], r.get("file_name"), r.get("size_kb") or None,
                     r["url"], r.get("local_path") or None, r.get("sha256") or None, r.get("bytes"), r.get("local_path") or None])
    con.close()
    return f"{len(rows)} rows"


def poll(paths, tr, only=None, types=TYPES, apply=False, today=None, log=print):
    """One pass over the companies. Returns the result dict (what run.py consumes); writes only with apply=True."""
    today = today or today_il()
    state = load_state(paths)
    known = {int(r["report_id"]) for r in documents(paths)}
    res = {"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "mode": "apply" if apply else "dry-run", "today": today.isoformat(),
           "blocked": None, "errors": [], "companies": {}, "filings": [], "skipped": []}
    maya_ids = {}
    for c in companies(paths, only):
        cid, mid = c["id"], c.get("maya_id")
        if not mid:
            res["skipped"].append({"company": cid, "why": "no MAYA id (not a reporting entity on TASE)"})
            continue
        maya_ids[cid] = mid
        st = state["companies"].get(cid, {"last_id": 0, "last_publish": f"{today.year - 1}-01-01T00:00:00"})
        start = (dt.date.fromisoformat(st["last_publish"][:10]) - dt.timedelta(days=OVERLAP_DAYS)).isoformat()
        try:
            reports = list_window(tr, mid, start, today.isoformat())
        except Blocked as e:
            res["blocked"] = str(e)
            log(f"MAYA refused automated access ({e}); stopping the poll per the network rules")
            break
        except Exception as e:  # noqa: BLE001
            res["errors"].append({"company": cid, "error": str(e)[:200]})
            continue
        if apply and reports:
            write_json(paths.raw / today.isoformat() / f"{cid}.json", reports, compact=False)
        new = sorted((r for r in reports if int(r["id"]) > st["last_id"] and int(r["id"]) not in known), key=lambda r: int(r["id"]))
        filings = []
        for r in new:
            f = classify(r)
            f.update(company=cid, wanted=f["type"] in types)
            filings.append(f)
        res["companies"][cid] = {"window": [start, today.isoformat()], "seen": len(reports), "new": len(new), "wanted": sum(f["wanted"] for f in filings)}
        res["filings"] += filings
        top = max((int(r["id"]) for r in reports), default=st["last_id"])
        if top > st["last_id"]:
            last = max(reports, key=lambda r: int(r["id"]))
            st = {"last_id": top, "last_publish": last["publishDate"][:19]}
        st["checked"] = res["at"]
        state["companies"][cid] = st
        log(f"{cid}: {len(reports)} filings in {start}..{today}, {len(new)} new, {sum(f['wanted'] for f in filings)} to fetch")
    wanted = [f for f in res["filings"] if f["wanted"]]
    for f in wanted:
        f["actions"] = [f"pdf {pdf_dest(paths, f['company'], f['period'], f['rid'], f['type'], p['url']).relative_to(paths.root)}" for p in f["pdf"]]
        if f["xbrl"] and f["type"] in PERIODIC:
            f["actions"].append(f"xbrl data/sources/xbrl/{f['company']}_{f['rid']}.xbrl")
        if f["type"] == "liabilities" and f["htm"]:
            f["actions"].append(f"htm {liab_dest(paths, f['rid']).relative_to(paths.root)}")
    if apply and not res["blocked"]:
        fetch(paths, tr, wanted, res, maya_ids, log)
        state["updated"] = res["at"]
        write_json(paths.state, state, compact=False)
        log_filings(paths, res)
    elif not apply:
        for f in wanted:
            log(f"  would fetch {f['company']} {f['type']} {f['period']} rid {f['rid']}: {'; '.join(f['actions']) or 'no attachments'}")
    return res


def fetch(paths, tr, wanted, res, maya_ids, log):
    rows = []
    for f in wanted:
        comp, rid = f["company"], f["rid"]
        if f["xbrl"] and f["type"] in PERIODIC:
            try:
                raw = tr.get_bytes(FILES + f["xbrl"])
                dest = paths.xbrl / f"{comp}_{rid}.xbrl"
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(raw)
                inst = fetch_xbrl.instance(raw.decode("utf-8", errors="replace"))
                if inst:
                    per = xbrl_period(inst, f["type"])
                    if per != f["period"]:
                        f["period_title"], f["period"] = f["period"], per
                    f["period_from"] = "xbrl"
                    f["xbrl_local"] = str(dest.relative_to(paths.root))
            except Blocked as e:
                res["blocked"] = str(e)
                log(f"MAYA refused a file ({e}); stopping")
                break
            except Exception as e:  # noqa: BLE001
                res["errors"].append({"company": comp, "rid": rid, "error": f"xbrl: {str(e)[:160]}"})
        f["fetched"] = []
        if f["type"] == "liabilities" and f["htm"]:
            dest = liab_dest(paths, rid)
            try:
                if not dest.exists():
                    raw = tr.get_bytes(FILES + f["htm"])
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(gzip.compress(raw, 9))
                f["fetched"].append(str(dest.relative_to(paths.root)))
            except Blocked as e:
                res["blocked"] = str(e)
                break
            except Exception as e:  # noqa: BLE001
                res["errors"].append({"company": comp, "rid": rid, "error": f"htm: {str(e)[:160]}"})
        for p in f["pdf"]:
            dest = pdf_dest(paths, comp, f["period"], rid, f["type"], p["url"])
            try:
                raw = dest.read_bytes() if dest.exists() else tr.get_bytes(FILES + p["url"])
            except Blocked as e:
                res["blocked"] = str(e)
                break
            except Exception as e:  # noqa: BLE001
                res["errors"].append({"company": comp, "rid": rid, "error": f"pdf: {str(e)[:160]}"})
                continue
            if raw[:4] != b"%PDF":
                res["errors"].append({"company": comp, "rid": rid, "error": f"not a pdf: {p['url']}"})
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists():
                dest.write_bytes(raw)
            p["local"], p["sha256"], p["bytes"] = str(dest.relative_to(paths.root)), hashlib.sha256(raw).hexdigest(), len(raw)
            f["fetched"].append(p["local"])
        for a in f["attachments"]:
            pdf = next((p for p in f["pdf"] if p["url"] == a["url"]), None)
            rows.append({"report_id": rid, "company": comp, "publish_date": f["publish"].replace("T", " "), "doc_type": f["type"],
                         "period": f["period"], "title": f["title"], "file_type": a["fileType"], "size_kb": a.get("fileSize") or "",
                         "pages": "", "url": a["url"], "local_path": (pdf or {}).get("local", ""), "sha256": (pdf or {}).get("sha256", ""),
                         "bytes": (pdf or {}).get("bytes"), "form": f.get("form"), "file_name": a.get("fileName")})
        if res["blocked"]:
            break
    n = append_documents(paths, rows)
    res["registry"] = {"documents_csv": n, "warehouse": upsert_warehouse(paths, rows, maya_ids) if rows else "nothing new"}
    log(f"registry: {n} rows appended to documents.csv; warehouse {res['registry']['warehouse']}")


def log_filings(paths, res):
    """data/registry/autopilot_filings.json: every filing the autopilot fetched, newest last (run.py adds what it did with each)."""
    log = read_json(paths.filings, {"filings": []})
    seen = {(f["rid"]) for f in log["filings"]}
    for f in res["filings"]:
        if f["wanted"] and f["rid"] not in seen:
            log["filings"].append({k: f.get(k) for k in ("rid", "company", "type", "period", "period_from", "period_title", "title", "publish",
                                                         "form", "xbrl", "xbrl_local", "fetched")} | {"polled": res["at"]})
    write_json(paths.filings, log, compact=False)


def transport(a, log=print):
    if a.replay:
        return Replay(a.replay)
    if a.record:
        return Recorder(a.record, interval=a.interval, log=log)
    return Live(interval=a.interval, log=log)


def args(argv=None, extra=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write files, registry and state (default: dry run, writes nothing)")
    ap.add_argument("--companies", default="", help="comma-separated company ids (default: all with a MAYA id)")
    ap.add_argument("--types", default=",".join(TYPES))
    ap.add_argument("--replay", help="folder of recorded responses (no network)")
    ap.add_argument("--record", help="folder to record live responses into")
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between requests (min 0.5 = 2/s)")
    ap.add_argument("--root", help="insurance-dashboard folder (default: this checkout)")
    ap.add_argument("--today", help="YYYY-MM-DD (tests)")
    ap.add_argument("--json", help="write the result here")
    if extra:
        extra(ap)
    return ap.parse_args(argv)


def main(argv=None):
    a = args(argv)
    paths = Paths(a.root)
    res = poll(paths, transport(a), only=[c for c in a.companies.split(",") if c] or None, types=tuple(a.types.split(",")),
               apply=a.apply, today=dt.date.fromisoformat(a.today) if a.today else None)
    if a.json:
        write_json(a.json, res, compact=False)
    print(f"{res['mode']}: {sum(c['new'] for c in res['companies'].values())} new filings, {sum(f['wanted'] for f in res['filings'])} to fetch"
          + (f"; BLOCKED: {res['blocked']}" if res["blocked"] else "") + (f"; {len(res['errors'])} errors" if res["errors"] else ""))
    return 2 if res["blocked"] else 0


if __name__ == "__main__":
    sys.exit(main())
