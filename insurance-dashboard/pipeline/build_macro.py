"""Build web/public/data/macro/macro.json from the raw files of pipeline/fetch_macro.py.

Every series carries its source, URL and retrieval date. Values are as published (BoI / CBS); the only figures computed here
are CPI since the previous December (index levels on one base) and the dates the BoI rate changed (from the daily series).
"""
from __future__ import annotations

import csv
import io
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "macro"
OUT = ROOT / "web" / "public" / "data" / "macro" / "macro.json"
KEEP = 48  # months of history shipped for the sparklines


def rows(name: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO((RAW / f"{name}_latest.csv").read_text(encoding="utf-8-sig"))))


def main() -> None:
    log = json.loads((RAW / "fetch_log.json").read_text(encoding="utf-8"))["results"]
    def meta(name: str) -> dict:
        r = log[name]
        return {"url": r["url"], "retrieved": r.get("retrieved") or r.get("last_ok"), "stale": not r["ok"]}
    out: dict = {"generated": date.today().isoformat(), "series": {}}

    # BoI rate: daily series -> the days it changed, and the value at each month end
    rate = sorted(((r["TIME_PERIOD"], float(r["OBS_VALUE"])) for r in rows("boi_rate") if r["SERIES_CODE"] == "MNT_RIB_BOI_D" and r["OBS_VALUE"]))
    changes, monthly = [], {}
    for i, (d, v) in enumerate(rate):
        if i == 0 or v != rate[i - 1][1]:
            changes.append([d, v])
        monthly[d[:7]] = v
    nxt = json.loads((RAW / "boi_next_latest.json").read_text(encoding="utf-8"))
    out["series"]["rate"] = {
        "label": "ריבית בנק ישראל", "unit": "%", "source": "בנק ישראל", **meta("boi_rate"), "code": "MNT_RIB_BOI_D",
        "last": rate[-1], "changes": changes[-12:], "months": sorted(monthly.items())[-KEEP:],
        "next": (nxt.get("nextInterestDate") or "")[:10] or None, "next_url": log["boi_next"]["url"], "next_rate": nxt.get("currentInterest"),
    }

    # CPI: the CBS API when it answered, else the CBS index as the BoI republishes it
    cpi = None
    if log["cbs_cpi"]["ok"] and (RAW / "cbs_cpi_latest.json").exists():
        d = json.loads((RAW / "cbs_cpi_latest.json").read_text(encoding="utf-8"))
        pts = sorted(({"m": f"{x['year']}-{x['month']:02d}", "idx": x["currBase"]["value"], "base": x["currBase"]["baseDesc"], "mom": x.get("percent"), "yoy": x.get("percentYear")} for x in d["month"][0]["date"]), key=lambda p: p["m"])
        cpi = {"label": "מדד המחירים לצרכן, כללי", "unit": "%", "source": 'הלמ"ס', **meta("cbs_cpi"), "code": "120010", "points": pts}
    elif log["boi_cpi"]["ok"] or (RAW / "boi_cpi_latest.csv").exists():
        by: dict[str, dict] = {}
        for r in rows("boi_cpi"):
            if not r["OBS_VALUE"]:
                continue
            p = by.setdefault(r["TIME_PERIOD"], {"m": r["TIME_PERIOD"], "base": r["UNIT_MEASURE"]})
            p[{"CP": "idx", "CP_PCH": "mom", "CP_PCHYTY": "yoy"}[r["SERIES_CODE"]]] = float(r["OBS_VALUE"])
        cpi = {"label": "מדד המחירים לצרכן, כללי", "unit": "%", "source": 'הלמ"ס, דרך בנק ישראל', **meta("boi_cpi"), "code": "PRI/CP", "points": sorted(by.values(), key=lambda p: p["m"])}
    if cpi:
        pts = cpi["points"]
        last = pts[-1]
        dec = next((p for p in pts if p["m"] == f"{int(last['m'][:4]) - 1}-12"), None)
        if dec and dec.get("base") == last.get("base") and dec.get("idx") and last.get("idx"):
            cpi["ytd"] = {"from": dec["m"], "to": last["m"], "idx_from": dec["idx"], "idx_to": last["idx"], "v": round((last["idx"] / dec["idx"] - 1) * 100, 2)}
        cpi["points"] = pts[-KEEP:]
        out["series"]["cpi"] = cpi

    # ZCM: monthly averages as the BoI publishes them
    names = {
        "ZC_TSB_ZND_10Y_MA": ("nom10", "תשואה נומינלית, אפס 10 שנים"),
        "ZC_TSB_ZRD_10Y_MA": ("real10", "תשואה ריאלית, אפס 10 שנים"),
        "EXP_EXB_ZD_10Y_MA": ("be10", "ציפיות אינפלציה, 10 שנים"),
        "EXP_EXP_01Y_BI_MA": ("exp1", "ציפיות אינפלציה, שנה"),
    }
    z: dict[str, list] = {}
    for r in rows("boi_zcm"):
        if r["SERIES_CODE"] in names and r["OBS_VALUE"]:
            z.setdefault(r["SERIES_CODE"], []).append([r["TIME_PERIOD"], round(float(r["OBS_VALUE"]), 4)])
    for code, (key, label) in names.items():
        if code in z:
            out["series"][key] = {"label": label, "unit": "%", "basis": "ממוצע חודשי", "source": "בנק ישראל (ZCM)", **meta("boi_zcm"), "code": code, "months": sorted(z[code])[-KEEP:]}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    s = out["series"]
    print("rate", s["rate"]["last"], "next", s["rate"]["next"], "| cpi", s.get("cpi", {}).get("points", [{}])[-1], s.get("cpi", {}).get("ytd"),
          "|", {k: s[k]["months"][-1] for k in ("nom10", "real10", "be10", "exp1") if k in s}, "|", OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
