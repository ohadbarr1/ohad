"""Macro inputs an IFRS 17 reader needs: Bank of Israel policy rate, CPI, and 10-year government zero-coupon yields and inflation expectations.

python3 pipeline/fetch_macro.py  -> data/raw/macro/<name>_<yyyymmdd>.(csv|json) and <name>_latest.(csv|json), plus fetch_log.json

Sources (free, no key):
  BoI SDMX (edge.boi.gov.il), dataflow BR   : MNT_RIB_BOI_D, the BoI interest rate, daily
  BoI public API GetInterest                 : current rate and the date of the next decision
  CBS price-index API (api.cbs.gov.il)       : CPI, general index (code 120010); tried first
  BoI SDMX, dataflow PRI                     : CP / CP_PCH / CP_PCHYTY, the CBS CPI as republished by the BoI (DATA_SOURCE=CBS); used when the CBS API is unreachable
  BoI SDMX, dataflow ZCM                     : 10Y nominal and real zero-coupon yields (monthly average), 10Y and 1Y inflation expectations
The full zero-coupon curve is lane 2D's file (web/public/data/macro/boi_curve.json, pipeline/fetch_boi.py); it is not fetched here.
A failed fetch is logged and the previous raw file stays; nothing is typed by hand.
"""
from __future__ import annotations

import json
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "macro"
SDMX = "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS"
START = "2019-01-01"
SOURCES = {
    "boi_rate": (f"{SDMX}/BR/1.0/MNT_RIB_BOI_D?startperiod={START}&format=csv", "csv"),
    "boi_next": ("https://www.boi.org.il/PublicApi/GetInterest", "json"),
    "cbs_cpi": ("https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&startPeriod=01-2019", "json"),
    "boi_cpi": (f"{SDMX}/PRI/1.0/CP+CP_PCH+CP_PCHYTY?startperiod={START}&format=csv", "csv"),
    "boi_zcm": (f"{SDMX}/ZCM/1.0/ZC_TSB_ZND_10Y_MA+ZC_TSB_ZRD_10Y_MA+EXP_EXB_ZD_10Y_MA+EXP_EXP_01Y_BI_MA?startperiod={START}&format=csv", "csv"),
}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (fox research pipeline)", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    today = date.today()
    log = {"fetched": today.isoformat(), "results": {}}
    for name, (url, ext) in SOURCES.items():
        try:
            body = get(url)
            if not body.strip():
                raise RuntimeError("empty response")
            (RAW / f"{name}_{today:%Y%m%d}.{ext}").write_bytes(body)
            (RAW / f"{name}_latest.{ext}").write_bytes(body)
            log["results"][name] = {"ok": True, "url": url, "bytes": len(body), "retrieved": today.isoformat()}
            print(name, "ok", len(body))
        except Exception as e:  # noqa: BLE001 - a failed source is reported, never filled in
            log["results"][name] = {"ok": False, "url": url, "error": str(e)[:200]}
            print(name, "FAILED", e)
        time.sleep(0.5)
    prev = RAW / "fetch_log.json"
    if prev.exists():  # keep the date of the last good fetch of a source that failed this time
        old = json.loads(prev.read_text(encoding="utf-8")).get("results", {})
        for k, v in log["results"].items():
            if not v["ok"] and old.get(k, {}).get("ok"):
                v["last_ok"] = old[k].get("retrieved") or old[k].get("last_ok")
    prev.write_text(json.dumps(log, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
