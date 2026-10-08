"""Download Gemel-Net, Pensia-Net and Insurance-Net from data.gov.il (Capital Market Authority).

Usage: python3 pipeline/fetch_regulator.py            # all datasets
Writes data/raw/<dataset>.parquet (one file per dataset, all years concatenated, raw columns).
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

API = "https://data.gov.il/api/3/action"
UA = {"User-Agent": "Mozilla/5.0"}
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
DATASETS = {"gemel": "gemelnet", "pensia": "pensia-net", "insurance": "insurance"}
PAGE = 30000


def get(url, retries=4):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if i == retries - 1:
                raise
            time.sleep(2 ** (i + 1))
            print("retry", url[:90], e, file=sys.stderr)


def resources(package):
    pkg = get(f"{API}/package_show?id={package}")["result"]
    # the data tables are the CSV resources with a live datastore; skip the format-change XLSX
    return [r for r in pkg["resources"] if r["format"] == "CSV" and r.get("datastore_active")]


def download(resource_id):
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"resource_id": resource_id, "limit": PAGE, "offset": offset})
        res = get(f"{API}/datastore_search?{q}")["result"]
        rows += res["records"]
        offset += PAGE
        if offset >= res["total"]:
            return pd.DataFrame(rows)


TEXT = {"FUND_NAME", "PARENT_COMPANY_NAME", "FUND_CLASSIFICATION", "CONTROLLING_CORPORATION", "MANAGING_CORPORATION",
        "INCEPTION_DATE", "TARGET_POPULATION", "SPECIALIZATION", "SUB_SPECIALIZATION", "CURRENT_DATE", "_resource"}


def normalise_types(df, key):
    """Text columns stay text (INCEPTION_DATE mixes Excel serials and date strings across years);
    every other column is numeric. Values that do not parse are set to null and reported."""
    for col in df.columns:
        if col in TEXT:
            df[col] = df[col].astype("string")
        elif df[col].dtype == object:
            num = pd.to_numeric(df[col], errors="coerce")
            bad = df.loc[num.isna() & df[col].notna() & (df[col].astype(str).str.strip() != ""), col]
            if len(bad):
                print(f"{key}.{col}: {len(bad):,} non-numeric values set to null, e.g. {bad.astype(str).unique()[:5].tolist()}")
            df[col] = num
    return df


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    for key, package in DATASETS.items():
        frames = []
        for r in resources(package):
            df = download(r["id"])
            df["_resource"] = r["name"]
            print(f"{key}: {r['name']}: {len(df):,} rows")
            frames.append(df)
        out = pd.concat(frames, ignore_index=True)
        out = normalise_types(out, key)
        out.to_parquet(RAW / f"{key}.parquet", index=False)
        print(f"{key}: total {len(out):,} -> {RAW / (key + '.parquet')}")


if __name__ == "__main__":
    main()
