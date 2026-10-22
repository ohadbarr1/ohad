"""Gate: every regulator aggregate the site shows must equal the tracks its source sheet lists.

Rebuilds each row of market.json (period x product x group) from web/public/data/prov/reg and compares
assets, deposits, withdrawals, transfers and the fee and return weights. Exit 1 on any difference."""
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
TOL = 1e-3  # NIS million; the components are stored to four decimals


def main():
    m = json.loads((DATA / "market.json").read_text(encoding="utf-8"))
    periods, groups = m["periods"], m["groups"]
    got = defaultdict(lambda: [0.0] * 8)  # assets, dep, wd, tr, fee_num, fee_den, y_num, y_den
    tracks = 0
    files = [(gi, f) for gi, _ in enumerate(groups) for f in sorted((DATA / "prov" / "reg" / str(gi)).glob("*.json"))]
    with ThreadPoolExecutor(32) as pool:  # a network drive answers one file at a time slowly: read them in parallel
        loaded = list(pool.map(lambda x: (x[0], json.loads(x[1].read_text(encoding="utf-8"))), files))
    for gi, c in loaded:
        if True:
            for i, fu in enumerate(c["funds"]):
                for k, p in enumerate(c["months"]):
                    a = c["a"][i][k]
                    if a is None:
                        continue
                    tracks += 1
                    o = got[(p, fu[3], gi)]
                    o[0] += a
                    o[1] += c["dep"][i][k] or 0
                    o[2] += c["wd"][i][k] or 0
                    o[3] += c["tr"][i][k] or 0
                    fee, y, prev = c["fee"][i][k], c["y"][i][k], c["prev"][i][k]
                    if fee is not None:
                        o[4] += a * fee
                        o[5] += a
                    if y is not None and prev is not None and prev > 0:
                        o[6] += prev * y
                        o[7] += prev
    bad, seen = [], set()
    names = ["assets", "dep", "wd", "tr", "fee_num", "fee_den", "y_num", "y_den"]
    for r in m["rows"]:
        key = (periods[r[0]], r[1], r[2])
        seen.add(key)
        want = [r[3], r[4], r[5], r[6], r[8], r[9], r[10], r[11]]
        have = got.get(key)
        if have is None:
            bad.append((key, "no components"))
            continue
        for n, w, h in zip(names, want, have):
            if abs(w - h) > TOL + abs(w) * 1e-6:
                bad.append((key, f"{n}: site {w:.4f} vs tracks {h:.4f}"))
    extra = [k for k in got if k not in seen and k[0] >= periods[0]]
    print(f"{len(m['rows']):,} aggregates, {tracks:,} track-months, {len(bad)} differences, {len(extra)} component cells with no aggregate")
    for k, why in bad[:20]:
        print("  ", k[0], m["products"][k[1]]["key"], groups[k[2]], why)
    return 1 if bad or extra else 0


if __name__ == "__main__":
    sys.exit(main())
