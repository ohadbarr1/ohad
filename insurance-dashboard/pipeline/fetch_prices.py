"""Closing prices, market value, registered shares and ex-dividend days from the Tel Aviv Stock Exchange (TASE), for listed groups.

python3 pipeline/fetch_prices.py            -> data/raw/tase/<security>.json  and  web/public/data/companies/<id>.price.json
python3 pipeline/fetch_prices.py --build    -> rebuild the price files from the raw files only (no network)

Source: the public end-of-day data behind market.tase.co.il (free, no key). Prices are in agorot, as quoted on TASE.
The security of each company is its main listed share, found in the exchange's entity list by the MAYA company id
(data/registry/companies.json, "maya_id"). A price is an input of the valuation pages only; nothing else on the site uses it.

Dividends are not published in this feed as amounts: an ex-dividend day carries the exchange's base-price adjustment, and the
dividend per share is read as the previous close less the adjusted base price of the ex-day (the rule TASE sets it by).
Those amounts are marked as derived in the output ("div_derived").
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "companies"
RAW = ROOT / "data" / "raw" / "tase"
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
        if len(got) < 30 or page > 40:
            return items
        page += 1
        time.sleep(0.6)


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


def main() -> None:
    companies = json.loads((ROOT / "data" / "registry" / "companies.json").read_text(encoding="utf-8"))
    RAW.mkdir(parents=True, exist_ok=True)
    if "--build" not in sys.argv:
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


if __name__ == "__main__":
    main()
