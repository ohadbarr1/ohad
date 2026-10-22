"""Bank of Israel zero-coupon curves for the site.

python3 pipeline/build_boi_curve.py -> web/public/data/macro/boi_curve.json
Reads the newest data/raw/boi/zcm_*.csv written by fetch_boi.py. Keeps the government zero-coupon yields (ZC_TSB_*):
nominal (ZND) and CPI-linked real (ZRD), every tenor BoI publishes, every month. Values are BoI's own (percent a year),
a monthly average of daily estimates (TIME_COLLECT = A); nothing is interpolated or filled.
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "boi"
OUT = ROOT / "web" / "public" / "data" / "macro" / "boi_curve.json"
CODE = re.compile(r"^ZC_TSB_Z([NR])D_(\d+)Y_MA$")


def main():
    meta = json.loads((RAW / "zcm_latest.json").read_text(encoding="utf-8"))
    src = RAW / meta["file"]
    vals = {"nominal": {}, "real": {}}
    codes = {"nominal": {}, "real": {}}
    collect = set()
    with src.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            m = CODE.match(r["SERIES_CODE"])
            if not m or r["FREQ"] != "M" or not r["OBS_VALUE"]:
                continue
            kind = "nominal" if m.group(1) == "N" else "real"
            t = int(m.group(2))
            vals[kind].setdefault(t, {})[r["TIME_PERIOD"]] = round(float(r["OBS_VALUE"]), 4)
            codes[kind][t] = r["SERIES_CODE"]
            collect.add(r["TIME_COLLECT"])
    months = sorted({p for k in vals.values() for s in k.values() for p in s})
    tenors = sorted({t for k in vals.values() for t in k})
    out = {
        "source": "בנק ישראל, סטטיסטיקה: ציפיות לאינפלציה ועקום אפס (ZCM)",
        "url": meta["url"],
        "retrieved": meta["retrieved"][:10],
        "basis": "monthly average" if collect == {"A"} else f"time collection {sorted(collect)}",
        "unit": "percent a year",
        "issuer": "government bonds (zero-coupon, estimated by BoI)",
        "months": months,
        "tenors": tenors,
        "codes": {k: {str(t): c for t, c in sorted(v.items())} for k, v in codes.items()},
        # one array per tenor, aligned to `months`; null where BoI publishes no value for that tenor and month
        "nominal": {str(t): [vals["nominal"].get(t, {}).get(p) for p in months] for t in tenors if t in vals["nominal"]},
        "real": {str(t): [vals["real"].get(t, {}).get(p) for p in months] for t in tenors if t in vals["real"]},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(months)} months {months[0]}..{months[-1]}, tenors {tenors}, {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
