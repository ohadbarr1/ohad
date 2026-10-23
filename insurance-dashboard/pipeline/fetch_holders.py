"""Who owns whom: holders of the listed groups among the 17, from MAYA (TASE's disclosure site). Network step of the monthly refresh.

  python3 pipeline/fetch_holders.py                 # all listed companies, resume from the cache
  python3 pipeline/fetch_holders.py harel phoenix   # some companies
  python3 pipeline/fetch_holders.py --refresh       # re-read the current snapshots (the parsed quarterly reports never change)
  python3 pipeline/fetch_holders.py --years 3       # how far back the quarterly holdings reports go (default 3)
  python3 pipeline/fetch_holders.py --no-funds      # skip the mutual-fund holdings (the slowest part)

Public endpoints used (all read by maya.tase.co.il's own pages, no login; probed 23.10.26):
  GET  /api/v1/companies/{id}/details                        securities (issued capital, main security), index memberships
  GET  /api/v1/interested-parties/by_company?companyId={id}  current interested parties: holder, security, balance, % capital, % vote, balance date, remark
  GET  /api/v1/interested-parties/distribution/by_company?companyId={id}
                                                              split interested / institutional / public, and the controlling holders' total
  POST /api/v1/reports/companies                              the company's filings (to find form ת077, the quarterly holdings report)
  GET  mayafiles.tase.co.il/rhtm/.../H{report}.htm            the ת077 form itself: holders, % capital and vote, holder type, controlling holders
  POST /api/v1/funds/assets/{security}  {pageNumber, pageSize} mutual funds and ETFs holding the share, latest monthly report (20 a page)
  POST /api/v1/funds/mutual  /  /funds/etf                    fund -> fund manager (to add the holdings up by manager)
Blocked or not used: /api/v1/companies (403), api.tase.co.il for these data (not needed).

Politeness: one request every PAUSE seconds (≤ 0.5/s), a User-Agent that names fox, every answer cached under data/raw/maya_holders/
(small JSON; the ת077 pages are parsed and only the parsed rows are kept). A 403 is the site's rate limiter: wait and retry twice, then stop
the run and say so; nothing here tries to get around a block.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "registry" / "companies.json"
RAW = ROOT / "data" / "raw" / "maya_holders"
API = "https://maya.tase.co.il/api/v1"
FILES = "https://mayafiles.tase.co.il/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 "
      "fox-research/1.0 (+https://fox-research-il.web.app)")
HEADERS = {"User-Agent": UA, "accept": "application/json", "content-type": "application/json", "origin": "https://maya.tase.co.il",
           "referer": "https://maya.tase.co.il/", "accept-language": "he-IL,he;q=0.9"}
PAUSE = 2.0
FORM_HOLDINGS = "ת077"     # דוח מיידי על מצבת החזקות בעלי עניין ונושאי משרה בכירה (quarterly, regulation 33(c)-(d))
FORMS_KEEP = {"ת077", "ת076", "ת078"}  # the status report, a change in holdings, became an interested party
# a listed parent files for a fund house in the registry: Yelin Lapidot's figures come from Atrao Capital Markets (50%); MAYA id 1307 is Atrao's
PARENT_NOTE = {"yelin": "אטראו שוקי הון, המחזיקה 50% בילין לפידות"}


class Blocked(RuntimeError):
    pass


_last = [0.0]


def _wait():
    d = time.time() - _last[0]
    if d < PAUSE:
        time.sleep(PAUSE - d)
    _last[0] = time.time()


def api(path: str, body: dict | None = None, *, with_headers: bool = False):
    """One call to MAYA's JSON API. 403 = the rate limiter: back off 90 s then 180 s, then stop the run (Blocked)."""
    data = json.dumps(body).encode() if body is not None else None
    for i in range(3):
        _wait()
        try:
            req = urllib.request.Request(f"{API}/{path}", data=data, headers=HEADERS, method="POST" if body is not None else "GET")
            with urllib.request.urlopen(req, timeout=90) as r:
                out = json.loads(r.read())
                return (out, dict(r.headers)) if with_headers else out
        except urllib.error.HTTPError as e:
            if e.code == 403:
                if i == 2:
                    raise Blocked(f"MAYA answered 403 three times for {path}: rate limited or blocked; stopping") from e
                wait = 90 * (i + 1)
                print(f"  403 on {path}: waiting {wait}s", file=sys.stderr, flush=True)
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            if i == 2:
                raise
            time.sleep(5 * (i + 1))
    raise RuntimeError("unreachable")


def fetch_file(url: str) -> bytes:
    for i in range(3):
        _wait()
        try:
            req = urllib.request.Request(FILES + url, headers={"User-Agent": UA, "referer": "https://maya.tase.co.il/"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 403 and i == 2:
                raise Blocked(f"mayafiles answered 403 three times for {url}; stopping") from e
            time.sleep(30 * (i + 1) if e.code == 403 else 5)
        except (urllib.error.URLError, TimeoutError):
            if i == 2:
                raise
            time.sleep(5 * (i + 1))
    raise RuntimeError("unreachable")


def save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def stamp(obj, url: str) -> dict:
    return {"url": url, "retrieved": date.today().isoformat(), "data": obj}


# ---------------------------------------------------------------- ת077 form parsing
_FIELD = re.compile(r'<(SPAN|TEXTAREA|INPUT|DIV|TD)\b([^>]*?)\bFieldAlias="([^"]+)"([^>]*)>(.*?)</\1>', re.S | re.I)
_ID = re.compile(r'\bid=["\']?(\w+)', re.I)


def _num(s: str) -> float | None:
    s = (s or "").replace(",", "").replace("%", "").strip()
    if not s or s.startswith("_"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _txt(s: str) -> str:
    t = html.unescape(re.sub(r"<[^>]+>", "", s or "")).replace("\r", " ").replace("\n", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return "" if re.fullmatch(r"_+", t) else t


def parse_t077(raw: bytes) -> dict:
    """The quarterly holdings form: the as-of date, section A (interested parties incl. directors and CEO) and section B (senior officers),
    each holder's type as filed ("סוג המחזיק"), the controlling holders and their total."""
    for enc in ("utf-8", "cp1255"):
        try:
            s = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    fields: dict[str, dict[int, str]] = {}
    single: dict[str, str] = {}
    for m in _FIELD.finditer(s):
        alias, attrs, val = m.group(3), m.group(2) + m.group(4), _txt(m.group(5))
        idm = _ID.search(attrs)
        rid = idm.group(1) if idm else ""
        rm = re.match(r"Row(\d+)", rid)
        if rm:
            fields.setdefault(alias, {})[int(rm.group(1))] = val
        else:
            single.setdefault(alias, val)
    col = lambda a: [fields.get(a, {}).get(i, "") for i in range(max(fields.get(a, {0: ""}).keys(), default=-1) + 1)] if a in fields else []
    asof = single.get("Tarich") or re.sub(r"^\D+", "", single.get("FormSubject", ""))
    rows = []
    for sec, (nm, secu, qty, cap, vote, capd, voted) in {
        "a": ("HaimMahzik2", "ShemVeSugNiarErech", "ItraHadasha", "ShiurAhzakaBehon", "ShiurAhzakaBekoahHazbaa", "ShiurAhzakaBedilulBehon", "ShiurAhzakaBedilulBekoahHazbaa"),
        "b": ("HaimMahzikBaelyEnyan", "ShemVeSugNiarErechBaelyEnyan", "ItraHadashaBaelyEnyan", "ShiurAhzakaBedilulBehonNosheMisra", "ShiurAhzakaBekoahHazbaaNosheMisra",
              "ShiurAhzakaBekoahHazbaaNosheMisra1", "ShiurAhzakaBedilulBekoahHazbaaNosheMisra"),
    }.items():
        names = col(nm)
        for i, n in enumerate(names):
            if not n:
                continue
            g = lambda a: fields.get(a, {}).get(i, "")
            rows.append({"sec": sec, "name": n, "security": g(secu), "qty": _num(g(qty)), "cap": _num(g(cap)), "vote": _num(g(vote)),
                         "cap_dil": _num(g(capd)), "vote_dil": _num(g(voted))})
    details = []
    for i, n in enumerate(col("ShemHamahzik")):
        g = lambda a: fields.get(a, {}).get(i, "")
        details.append({"name": n, "name_en": g("ShemMahzikAnglit"), "type": g("ErechTavla642"), "holder_owner": g("HolderOwner"),
                        "security_no": g("MisparNiarErech"), "prev": _num(g("ItraBeDivuachKodem")), "change": _num(g("GidulOKitun")), "remark": g("Harot")})
    controllers = [x for x in col("BaalShlitaBaTaagid") if x]
    return {
        "form": single.get("MisparTofes", ""), "asof": asof, "entity": single.get("ShemYeshutIvrit", ""),
        "rows": rows, "details": details, "controllers": controllers,
        "controllers_total": _num(single.get("ShiurAhzakaBehonBaalShlitaBaTaagid", "")),
        "controllers_other": single.get("BaalShlitaBaTaagidOtherText", "") or None,
        "total_a": {"cap": _num(single.get("ShiurAhzakaBehonBaelyEnyan", "")), "vote": _num(single.get("ShiurAhzakaBekoahHazbaaBaelyEnyan", ""))},
    }


# ---------------------------------------------------------------- fetch steps
def companies(only: list[str]) -> list[dict]:
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    out = [c for c in reg if c.get("maya_id")]
    return [c for c in out if not only or c["id"] in only]


def fresh(path: Path, days: int) -> bool:
    if not path.exists():
        return False
    try:
        got = read(path).get("retrieved")
        return bool(got) and (date.today() - date.fromisoformat(got)).days < days
    except Exception:  # noqa: BLE001
        return False


def snapshot(mid: int, refresh: bool) -> None:
    """details, interested parties and the distribution: the company's page on MAYA as of today."""
    for name, path in (("details", f"companies/{mid}/details"), ("ip", f"interested-parties/by_company?companyId={mid}"),
                       ("dist", f"interested-parties/distribution/by_company?companyId={mid}")):
        f = RAW / f"{name}_{mid}.json"
        if not refresh and fresh(f, 7):
            continue
        d = api(path)
        if name == "details":  # keep what the builder uses; the contact block is not needed
            d = {k: d.get(k) for k in ("companyId", "name", "longName", "isNonListed", "isBond", "isDual", "mainSecurityId", "marketValue",
                                        "securitiesValidityDate", "indices", "secrities", "corporateNo")}
        save(f, stamp(d, f"{API}/{path}"))


def report_list(mid: int, years: int, refresh: bool) -> list[dict]:
    """ת077/ת076/ת078 filings of the last `years` years. The list API pages by 30; windows of four months keep each call short."""
    f = RAW / f"reports_{mid}.json"
    have = read(f)
    if have and not refresh and fresh(f, 25):
        return have["data"]
    end = date.today()
    start = date(end.year - years, end.month, 1) - timedelta(days=100)  # one more quarter, for the first change
    if have and not refresh:  # resume: only the months after the last list
        start = max(start, date.fromisoformat(have["retrieved"]) - timedelta(days=40))
    keep = {r["id"]: r for r in (have["data"] if have else [])}
    lo = start
    while lo <= end:
        hi = min(end, lo + timedelta(days=120))
        off = 0
        while True:
            page = api("reports/companies", {"companyId": mid, "fromDate": lo.isoformat(), "toDate": hi.isoformat(),
                                             "isPriority": False, "isTradeHalt": False, "offset": off})
            for r in page:
                if (r.get("formId") or "") in FORMS_KEEP:
                    keep[r["id"]] = {"id": r["id"], "title": r["title"], "date": r["publishDate"][:10], "form": r["formId"],
                                     "files": [a["url"] for a in r.get("attachments") or [] if a.get("url")]}
            if len(page) < 30:
                break
            off += 30
        lo = hi + timedelta(days=1)
    rows = sorted(keep.values(), key=lambda r: r["date"], reverse=True)
    save(f, stamp(rows, f"{API}/reports/companies"))
    return rows


def holdings_reports(mid: int, reports: list[dict]) -> int:
    """Parse every ת077 not yet in the cache (they never change once filed)."""
    n = 0
    for r in reports:
        if r["form"] != FORM_HOLDINGS:
            continue
        f = RAW / "t077" / f"{r['id']}.json"
        if f.exists():
            continue
        htm = next((u for u in r["files"] if u.lower().endswith(".htm")), None)
        if not htm:
            continue
        p = parse_t077(fetch_file(htm))
        p.update({"report_id": r["id"], "published": r["date"], "title": r["title"], "maya_id": mid,
                  "url": f"https://maya.tase.co.il/he/reports/{r['id']}", "file": FILES + htm, "retrieved": date.today().isoformat()})
        save(f, p)
        n += 1
    return n


def fund_holdings(sec: int, refresh: bool) -> None:
    """Mutual funds and ETFs holding the share (latest monthly report), all pages."""
    f = RAW / f"funds_{sec}.json"
    if not refresh and fresh(f, 25):
        return
    rows, page = [], 1
    while True:
        d, h = api(f"funds/assets/{sec}", {"pageSize": 20, "pageNumber": page}, with_headers=True)
        rows += [{k: x.get(k) for k in ("fundId", "fundTypeId", "reportDate", "fundName", "assetTypeName", "quantity", "nisValue", "fundPercentage")} for x in d]
        total = int({k.lower(): v for k, v in h.items()}.get("x-total-count", len(rows)))
        if not d or len(rows) >= total:
            break
        page += 1
    save(f, stamp(rows, f"{API}/funds/assets/{sec}"))


def fund_managers(fund_ids: set[int], refresh: bool) -> None:
    """fund id -> manager name, from the fund lists (one pass over the lists, not one call per fund)."""
    f = RAW / "fund_managers.json"
    have = read(f)
    known = (have or {}).get("data", {})
    if not refresh and all(str(i) in known for i in fund_ids) and fresh(f, 60):
        return
    for kind in ("mutual", "etf"):
        page = 1
        while True:
            d, h = api(f"funds/{kind}", {"pageSize": 20, "pageNumber": page}, with_headers=True)
            for x in d:
                fid = x.get("fundId") or x.get("id")
                mgr = x.get("managerName") or x.get("fundManagerName") or x.get("manager")
                if fid and mgr:
                    known[str(fid)] = mgr.strip()
            total = int({k.lower(): v for k, v in h.items()}.get("x-total-count", 0) or 0)
            if not d or page * 20 >= total:
                break
            page += 1
    save(f, stamp(known, f"{API}/funds/mutual + /funds/etf"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("only", nargs="*")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--years", type=int, default=3)
    ap.add_argument("--no-funds", action="store_true")
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    fund_ids: set[int] = set()
    try:
        for c in companies(a.only):
            mid = c["maya_id"]
            print(f"{c['id']} ({mid})", flush=True)
            snapshot(mid, a.refresh)
            det = read(RAW / f"details_{mid}.json")["data"]
            if det.get("isNonListed") or not det.get("mainSecurityId"):
                print("  not listed: snapshot only", flush=True)
            reps = report_list(mid, a.years, a.refresh)
            n = holdings_reports(mid, reps)
            print(f"  {sum(r['form'] == FORM_HOLDINGS for r in reps)} holdings reports, {n} new", flush=True)
            sec = det.get("mainSecurityId")
            main_sec = next((s for s in det.get("secrities") or [] if s.get("securityId") == sec), None)
            if not a.no_funds and main_sec and main_sec.get("isHeldByFunds"):
                fund_holdings(sec, a.refresh)
                fund_ids |= {r["fundId"] for r in read(RAW / f"funds_{sec}.json")["data"]}
        if fund_ids:
            fund_managers(fund_ids, a.refresh)
    except Blocked as e:
        print(f"STOPPED: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
