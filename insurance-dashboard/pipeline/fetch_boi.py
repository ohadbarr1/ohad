"""Download the Bank of Israel zero-coupon yield curves (nominal and CPI-linked real) and inflation expectations.

Usage: /usr/bin/python3 pipeline/fetch_boi.py
Source: BoI statistics SDMX service, dataflow BOI.STATISTICS/ZCM ("ציפיות לאינפלציה ועקום 0"), CSV, free and public.
Writes data/raw/boi/zcm_<yyyymmdd>.csv (the file as served) and data/raw/boi/zcm_latest.json (URL, retrieval time, size).
Stdlib only.
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/ZCM/1.0?format=csv"
RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "boi"
UA = {"User-Agent": "Mozilla/5.0 (fox research; pipeline)", "Accept": "text/csv"}


def get(url, retries=4):
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            print("retry", e, file=sys.stderr)
            time.sleep(2 ** (i + 1))


def main():
    body = get(URL)
    head = body[:200].decode("utf-8", "replace")
    if not head.startswith("SERIES_CODE,"):
        sys.exit(f"unexpected response from BoI (not the SDMX CSV): {head[:120]!r}")
    now = datetime.now(timezone.utc)
    RAW.mkdir(parents=True, exist_ok=True)
    name = f"zcm_{now:%Y%m%d}.csv"
    (RAW / name).write_bytes(body)
    (RAW / "zcm_latest.json").write_text(json.dumps({"file": name, "url": URL, "retrieved": now.isoformat(timespec="seconds"), "bytes": len(body)}, indent=1), encoding="utf-8")
    lines = body.count(b"\n")
    print(f"{name}: {len(body):,} bytes, {lines:,} lines")


if __name__ == "__main__":
    main()
