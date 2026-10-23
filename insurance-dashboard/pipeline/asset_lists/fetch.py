"""Download the quarterly asset-list files found by probe.py (polite, resumable).

  python3 pipeline/asset_lists/fetch.py                       # every reachable manager, last 8 quarters, products gm/pn/in
  python3 pipeline/asset_lists/fetch.py meitav --quarters 4
  python3 pipeline/asset_lists/fetch.py --dry-run             # list what would be fetched

Each file lands in data/raw/asset_lists/<manager>/<quarter>/<product>.xlsx with <product>.meta.json (source URL, the page that
links it, retrieval date, bytes, sha256). A manager-quarter above 30 MB keeps its Excel files out of data/raw (Drive): they go to
~/.cache/fox/asset_lists/ and only the normalised output is kept. Already-fetched files (meta present) are skipped. Managers whose
status is blocked are never contacted.
"""
from __future__ import annotations
import argparse, hashlib, json, sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from asset_lists import net  # noqa: E402
from asset_lists.common import COVERAGE, MAX_RAW_MB, RAW, last_quarters, load_sources  # noqa: E402

TMP = Path.home() / ".cache" / "fox" / "asset_lists"


def where(mid: str, q: str) -> Path:
    """raw dir for a manager-quarter: data/raw unless it was moved to the local cache for size"""
    big = TMP / mid / q
    return big if (big / ".big").exists() else RAW / mid / q


def plan(cov: dict, managers: list[str], products: list[str], nq: int) -> list[dict]:
    out = []
    for mid in managers:
        rec = cov["managers"].get(mid)
        if not rec or rec["status"] in ("blocked", "js_only", "not_found") or not rec["files"]:
            continue
        latest = max(f["quarter"] for f in rec["files"])
        want = set(last_quarters(nq, latest))
        for f in rec["files"]:
            if f["product"] in products and f["quarter"] in want:
                out.append({"manager": mid, **f})
    return out


def fetch_one(job: dict) -> str:
    d = where(job["manager"], job["quarter"])
    meta_p = d / f"{job['product']}.meta.json"
    if meta_p.exists():
        return "cached"
    data, ctype, final = net.get(job["url"], binary=True, timeout=300)
    if data[:2] != b"PK":
        raise RuntimeError(f"not an xlsx ({ctype}, {len(data)} bytes)")
    meta = {"manager": job["manager"], "product": job["product"], "quarter": job["quarter"], "url": job["url"].split("#")[0],
            "file": job["url"].split("#")[-1].rsplit("/", 1)[-1], "page": job["page"], "final_url": final,
            "retrieved": date.today().isoformat(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    d.mkdir(parents=True, exist_ok=True)
    have = sum(p.stat().st_size for p in d.glob("*.xlsx"))
    if d.parent.parent == RAW and (have + len(data)) / 1e6 > MAX_RAW_MB:
        big = TMP / job["manager"] / job["quarter"]
        big.mkdir(parents=True, exist_ok=True)
        for p in list(d.iterdir()):
            p.rename(big / p.name)
        d.rmdir()
        (big / ".big").write_text("manager-quarter above 30 MB: Excel kept out of data/raw\n")
        d = big
    (d / f"{job['product']}.xlsx").write_bytes(data)
    (d / f"{job['product']}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return f"{len(data) / 1e6:.1f} MB"


TA35_URL = "https://en.wikipedia.org/wiki/TA-35_Index"


def fetch_ta35():
    """TA-35 composition as Wikipedia lists it (country, corporation, ticker, industry) -> data/raw/asset_lists/_ref/ta35_wikipedia.json.
    A reference list for the concentration metric only; the matching to issuers is pipeline/asset_lists/ta35_issuers.json."""
    import html as H, re
    txt, _, final = net.get(TA35_URL)
    tabs = re.findall(r'<table class="wikitable.*?</table>', txt, re.S)
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", tabs[0], re.S) if tabs else []:
        cells = [H.unescape(re.sub(r"<[^>]+>", "", c)).replace("\xa0[he]", "").strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) == 4 and cells[0] != "Country":
            rows.append({"country": cells[0], "name": cells[1], "ticker": cells[2], "industry": cells[3]})
    out = RAW / "_ref"
    out.mkdir(parents=True, exist_ok=True)
    (out / "ta35_wikipedia.json").write_text(json.dumps({"url": TA35_URL, "retrieved": date.today().isoformat(), "members": rows},
                                                       ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"TA-35: {len(rows)} members from {TA35_URL}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("managers", nargs="*")
    ap.add_argument("--quarters", type=int, default=8)
    ap.add_argument("--products", default=None, help="comma list, default sources.json fetch_products")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--ta35", action="store_true", help="also refresh the TA-35 reference list (Wikipedia)")
    a = ap.parse_args()
    if a.ta35:
        fetch_ta35()
    src = load_sources()
    cov = json.loads(COVERAGE.read_text(encoding="utf-8"))
    products = a.products.split(",") if a.products else src["fetch_products"]
    jobs = plan(cov, a.managers or list(cov["managers"]), products, a.quarters)
    print(f"{len(jobs)} files", flush=True)
    fails = 0
    for j in jobs:
        tag = f"{j['manager']:10} {j['quarter']} {j['product']}"
        if a.dry_run:
            print(tag, j["url"]); continue
        try:
            print(tag, fetch_one(j), flush=True)
        except net.Blocked as e:
            print(tag, "BLOCKED", e, "- stopping this host", flush=True); fails += 1
        except Exception as e:  # noqa: BLE001
            print(tag, "ERROR", type(e).__name__, e, flush=True); fails += 1
    print(f"done, {fails} failures", flush=True)


if __name__ == "__main__":
    main()
