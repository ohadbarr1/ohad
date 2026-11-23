"""Closing prices, market value, registered shares and ex-dividend days from the Tel Aviv Stock Exchange (TASE), for listed groups.

python3 pipeline/fetch_prices.py            -> data/tase/<security>.json  and  web/public/data/companies/<id>.price.json
python3 pipeline/fetch_prices.py --build    -> rebuild the price files from the raw files only (no network)
python3 pipeline/fetch_prices.py --hist     -> also the long daily history since 2019 (data/tase/<security>.hist.json), ~20 min
python3 pipeline/fetch_prices.py --update   -> incremental: only the days since the last close on disk (about one request per security,
                                               ~30 s; what the autopilot runs after each trading day). Days that leave the 15-month
                                               recent window move into the long history, so the series stays continuous.

The long history feeds web/public/data/mkt.json: per company the close and market value at each quarter end, dividends per share by
ex-day, and a weekly total-return index (dividends reinvested at the ex-day close). The peer table reads the quarter ends as the
market metrics mkt:* (build_registry.py), so P/E, P/B and dividend yield are formulas over printed figures and TASE closes.

Source: the public end-of-day data behind market.tase.co.il (free, no key). Prices are in agorot, as quoted on TASE.
The security of each company is its main listed share, found in the exchange's entity list by the MAYA company id
(data/registry/companies.json, "maya_id"). A price is an input of the valuation pages and of the peer comparison (multiples, total
return); it is never a headline.

Dividends are not published in this feed as amounts: an ex-dividend day carries the exchange's base-price adjustment, and the
dividend per share is read as the previous close less the adjusted base price of the ex-day (the rule TASE sets it by).
Those amounts are marked as derived in the output ("div_derived").
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "companies"
# local disk, not the synced drive: the scheduled autopilot (launchd) may not write into ~/Library/CloudStorage (macOS privacy
# protection), and these files are regenerable (--hist). FOX_TASE_RAW points elsewhere; the old drive folder seeds a fresh checkout.
RAW = Path(os.environ.get("FOX_TASE_RAW") or ROOT / "data" / "tase")
OLD_RAW = ROOT / "data" / "raw" / "tase"
API = "https://api.tase.co.il/api"
PAGE = "https://market.tase.co.il/he/market_data/security/{sec}/major_data"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "Referer": "https://market.tase.co.il/", "Origin": "https://market.tase.co.il", "Accept": "application/json", "Content-Type": "application/json",
}
MONTHS = 15  # the last-twelve-months dividend by ex-date and a year of weekly closes
# a listed line that is not the group's common equity is never used as its price
SKIP = {"hachshara": "listed line 1156025 is a 3 M NIS instrument, not the group's common equity", "idi": "no listed share", "infinity": "", "globalnet": ""}


def call(path: str, body: dict | None = None):
    req = urllib.request.Request(f"{API}/{path}", data=json.dumps(body).encode() if body is not None else None, headers=HEADERS, method="POST" if body is not None else "GET")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - network: retry, then give up loudly
            if attempt == 2:
                raise RuntimeError(f"TASE {path}: {e}") from e
            time.sleep(2 + attempt * 3)


def securities(companies: list[dict]) -> dict[str, dict]:
    """MAYA company id -> main listed share, from the exchange's entity list."""
    ents = call("content/searchentities?lang=0")
    out = {}
    for c in companies:
        mid = str(c.get("maya_id") or "")
        if not mid or c["id"] in SKIP:
            continue
        hit = next((e for e in ents if e.get("Id") == mid and e.get("Type") == 5 and e.get("SubId")), None)
        if hit:
            out[c["id"]] = {"security": hit["SubId"], "name": hit["Name"], "maya_id": mid}
    return out


def history(sec: str, d_from: date, d_to: date) -> list[dict]:
    items, page = [], 1
    while True:
        r = call("security/historyeod", {"dFrom": d_from.isoformat(), "dTo": d_to.isoformat(), "oId": sec, "pageNum": page, "pType": "8", "TotalRec": 1, "lang": "0"})
        got = r.get("Items") or []
        items += got
        if len(got) < 30 or page > 120:
            return items
        page += 1
        time.sleep(0.6)


HIST_FROM = date(2019, 1, 1)
KEEP = ("TradeDate", "CloseRate", "BaseRate", "MarketValue", "RegisteredCapital", "ExeDesc")


def iso(d: str) -> str:
    return datetime.strptime(d, "%d/%m/%Y").date().isoformat()


def build(raw: dict) -> dict | None:
    seen, rows = set(), []
    for x in sorted(({**x, "d": iso(x["TradeDate"])} for x in raw["items"] if x.get("CloseRate")), key=lambda x: x["d"]):
        if x["d"] not in seen:
            seen.add(x["d"]); rows.append(x)
    if not rows:
        return None
    last = rows[-1]
    weeks: dict[tuple, dict] = {}
    for x in rows:  # the last trading day of each ISO week
        weeks[date.fromisoformat(x["d"]).isocalendar()[:2]] = x
    divs = []
    for prev, x in zip(rows, rows[1:]):
        if "דיבידנד" in (x.get("ExeDesc") or "") and x.get("BaseRate"):
            amt = round(float(prev["CloseRate"]) - float(x["BaseRate"]), 2)
            if amt > 0:
                divs.append([x["d"], amt])
    sec = raw["security"]
    return {
        "ticker": sec, "name": raw["name"], "source": "TASE · הבורסה לניירות ערך", "url": PAGE.format(sec=sec), "fetched": raw["fetched"],
        "unit": "agorot", "asof": last["d"], "last": float(last["CloseRate"]),
        # market value as the exchange prints it (NIS thousands -> millions) and the registered capital it is computed on
        "mcap": round(float(last["MarketValue"]) / 1000, 1) if last.get("MarketValue") else None, "shares": last.get("RegisteredCapital"),
        "dates": [w["d"] for w in weeks.values()], "close": [float(w["CloseRate"]) for w in weeks.values()],
        "dividends": divs, "div_derived": True,
    }


def divs_of(rows: list[dict]) -> list[list]:
    out = []
    for prev, x in zip(rows, rows[1:]):
        if "דיבידנד" in (x.get("ExeDesc") or "") and x.get("BaseRate"):
            amt = round(float(prev["CloseRate"]) - float(x["BaseRate"]), 2)
            if amt > 0:
                out.append([x["d"], amt])
    return out


def market_history(secs: dict) -> dict:
    """mkt.json: quarter-end close and market value, dividends per share by ex-day, weekly total-return index; one entry per listed company."""
    ents = {}
    for cid, s in secs.items():
        rows: dict[str, dict] = {}
        for f in (RAW / f"{s['security']}.hist.json", RAW / f"{s['security']}.json"):  # the recent file overrides the long one
            if f.exists():
                for x in json.loads(f.read_text(encoding="utf-8"))["items"]:
                    if x.get("CloseRate"):
                        rows[iso(x["TradeDate"])] = x
        if not rows:
            continue
        days = [{**rows[d], "d": d} for d in sorted(rows)]
        divs = divs_of(days)
        dmap = {d: a for d, a in divs}
        # quarter ends: the last trading day on or before each calendar quarter end
        q = {}
        for x in days:
            y, m = int(x["d"][:4]), int(x["d"][5:7])
            key = f"{y}Q{(m - 1) // 3 + 1}"
            q[key] = x  # rows are sorted, so the last one of the quarter stays
        last_d = days[-1]["d"]
        qend = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "Q4": "12-31"}
        qout = {}
        for k, x in q.items():
            end = f"{k[:4]}-{qend[k[4:]]}"
            if end > last_d:
                continue  # the running quarter is not a quarter end yet
            mv = round(float(x["MarketValue"]) / 1000, 1) if x.get("MarketValue") else None
            qout[k] = [float(x["CloseRate"]), mv, x["d"], x.get("RegisteredCapital")]
        # weekly total-return index: dividend reinvested at the ex-day close
        tr, weeks, daily = 1.0, {}, []
        prev = None
        for x in days:
            c = float(x["CloseRate"])
            if prev is not None:
                tr *= (c + dmap.get(x["d"], 0.0)) / prev
            prev = c
            weeks[date.fromisoformat(x["d"]).isocalendar()[:2]] = [x["d"], c, round(tr, 5)]
            if x["d"] >= (date.fromisoformat(last_d) - timedelta(days=400)).isoformat():
                daily.append([x["d"], round(tr, 5)])  # exact window ends for 3M / YTD / 12M
        ents[cid] = {"ticker": s["security"], "name": s["name"], "url": PAGE.format(sec=s["security"]), "q": qout, "div": divs, "w": list(weeks.values()), "dl": daily,
                     "first": days[0]["d"], "last": last_d}
    return ents


def merge_update(recent: list[dict], new: list[dict], hist: list[dict], today: date) -> tuple[list[dict], list[dict]]:
    """(recent, hist) after an incremental fetch: new rows override the same trading day, the recent file keeps MONTHS of days (newest
    first, as the feed returns them) and the days older than that move into the long history (slim rows), replacing the same day there."""
    rows = {iso(x["TradeDate"]): x for x in recent}
    rows.update({iso(x["TradeDate"]): x for x in new})
    cut = (today - timedelta(days=MONTHS * 31)).isoformat()
    keep = [rows[d] for d in sorted(rows, reverse=True) if d >= cut]
    old = {iso(x["TradeDate"]): x for x in hist}
    old.update({d: {k: rows[d].get(k) for k in KEEP} for d in rows if d < cut})
    return keep, [old[d] for d in sorted(old)]


def update(secs: dict, today: date) -> None:
    """--update: per security, the days since the last close on disk (less a 10-day overlap that picks up late corrections)."""
    for cid, s in secs.items():
        f, fh = RAW / f"{s['security']}.json", RAW / f"{s['security']}.hist.json"
        cur = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"items": []}
        days = [iso(x["TradeDate"]) for x in cur["items"]]
        d_from = date.fromisoformat(max(days)) - timedelta(days=10) if days else today - timedelta(days=MONTHS * 31)
        try:
            new = history(s["security"], d_from, today)
        except RuntimeError as e:
            print(cid, "FAILED", e)
            continue
        hist = json.loads(fh.read_text(encoding="utf-8")) if fh.exists() else {**s, "items": []}
        keep, hrows = merge_update(cur["items"], new, hist["items"], today)
        if keep == cur["items"]:
            print(cid, s["security"], "update", d_from.isoformat(), "-> no new trading day")
            continue  # the files (and their "fetched" stamp) stay as they are: a day without a close changes nothing downstream
        (RAW / f"{s['security']}.json").write_text(json.dumps({**s, "fetched": today.isoformat(), "url": f"{API}/security/historyeod", "items": keep},
                                                              ensure_ascii=False), encoding="utf-8")
        if len(hrows) != len(hist["items"]):
            fh.write_text(json.dumps({**hist, "fetched": hist.get("fetched") or today.isoformat(), "items": hrows}, ensure_ascii=False), encoding="utf-8")
        print(cid, s["security"], "update", d_from.isoformat(), "->", max(days + [iso(x["TradeDate"]) for x in new]) if days or new else "-", len(new), "rows")
        time.sleep(0.6)


def main() -> None:
    companies = json.loads((ROOT / "data" / "registry" / "companies.json").read_text(encoding="utf-8"))
    if not RAW.exists() and OLD_RAW.is_dir():
        try:
            shutil.copytree(OLD_RAW, RAW)
            print("seeded", RAW, "from", OLD_RAW)
        except OSError as e:
            print("could not seed from", OLD_RAW, e)
    RAW.mkdir(parents=True, exist_ok=True)
    if "--update" in sys.argv:
        secs = securities(companies)
        (RAW / "securities.json").write_text(json.dumps(secs, ensure_ascii=False, indent=1), encoding="utf-8")
        update(secs, date.today())
    elif "--build" not in sys.argv:
        secs = securities(companies)
        (RAW / "securities.json").write_text(json.dumps(secs, ensure_ascii=False, indent=1), encoding="utf-8")
        today = date.today()
        for cid, s in secs.items():
            try:
                items = history(s["security"], today - timedelta(days=MONTHS * 31), today)
            except RuntimeError as e:
                print(cid, "FAILED", e)
                continue
            raw = {**s, "fetched": today.isoformat(), "url": f"{API}/security/historyeod", "items": items}
            (RAW / f"{s['security']}.json").write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            print(cid, s["security"], s["name"], len(items), "days")
            time.sleep(1)
            if "--hist" in sys.argv:
                # the long history in yearly windows (the feed pages 30 rows at a time), slim rows only
                hist = []
                for y in range(HIST_FROM.year, today.year + 1):
                    a, b = date(y, 1, 1), min(date(y, 12, 31), today - timedelta(days=MONTHS * 31))
                    if a > b:
                        continue
                    try:
                        hist += [{k: x.get(k) for k in KEEP} for x in history(s["security"], a, b)]
                    except RuntimeError as e:
                        print(cid, y, "FAILED", e)
                    time.sleep(0.6)
                (RAW / f"{s['security']}.hist.json").write_text(json.dumps({**s, "fetched": today.isoformat(), "items": hist}, ensure_ascii=False), encoding="utf-8")
                print(cid, "history", len(hist), "days")
    secs = json.loads((RAW / "securities.json").read_text(encoding="utf-8"))
    for cid, s in secs.items():
        f = RAW / f"{s['security']}.json"
        if not f.exists():
            print(cid, "no raw file")
            continue
        out = build(json.loads(f.read_text(encoding="utf-8")))
        if not out:
            print(cid, "no closes")
            continue
        (OUT / f"{cid}.price.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        print(cid, out["ticker"], out["asof"], "last", out["last"], "mcap", out["mcap"], "divs", out["dividends"])
    ents = market_history(secs)
    if ents:
        mk = {"asof": max(e["last"] for e in ents.values()), "source": "TASE · הבורסה לניירות ערך", "unit": "agorot; market value in NIS millions",
              "note": "quarter end = last trading day on or before the calendar quarter end; dividend per share = previous close less the ex-day base price (derived); "
                      "total-return index reinvests the dividend at the ex-day close", "ents": ents}
        (OUT.parent / "mkt.json").write_text(json.dumps(mk, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print("mkt.json", len(ents), "companies", (OUT.parent / "mkt.json").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
