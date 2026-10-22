"""Roster changes in the regulator's fund files (W5-14): web/public/data/roster.json

A group's assets can grow because fund ids enter its part of the database (a fund house bought, a family reported for the first time,
a fund moved between groups), not because money came in. This file measures that, per group x family x month, so a YoY can say
"כולל קופות חדשות במאגר" and show the like-for-like figure beside it.

Input : web/public/data/market.json   regulator aggregates per month x product x group: assets and the number of funds (n)
        web/public/data/funds.json + funds/<k>.json   every fund in the latest month, with its monthly history
Per group x family, month m:
  A(m)   assets of the group's family (market.json, NIS millions)
  S(m)   assets of today's funds in that month (fund histories);  R(m) = A(m) - S(m) = funds no longer in the files
Windows ending in m (3 and 12 months): `in` = the assets in m of the funds whose first month with assets falls in the window
(they entered the files), `nin` their count; `out` = R(start) - R(m) when positive: what the funds gone from the files held at the
start of the window, less what those still alive in m hold (an estimate: a fund that leaves late in the window has had its flows).
The page uses net = max(0, in - out): a track split into a new id, with the old id closed, offsets itself; a group whose part of the
files grew with new ids that no closed id explains is flagged "כולל קופות חדשות במאגר", with the like-for-like change beside it.

python3 pipeline/build_roster.py
"""
import collections
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
FAM = {"pensia": "pension", "gemel": "gemel", "insurance": "insurance"}
WIN = (3, 12)
MIN_EV = 20.0  # NIS millions: entering funds listed by name (at entry or today)


def main():
    m = json.loads((DATA / "market.json").read_text(encoding="utf-8"))
    P, G = m["periods"], m["groups"]
    fam_of = [p["family"] for p in m["products"]]
    pi = {p: i for i, p in enumerate(P)}
    T = len(P)
    A = collections.defaultdict(lambda: [0.0] * T)
    for r in m["rows"]:
        k = (r[2], fam_of[r[1]])
        A[k][r[0]] += r[3] or 0
    S = collections.defaultdict(lambda: [0.0] * T)
    first = collections.defaultdict(list)  # (g, fam) -> [(entry month index, history by month index)]
    ev = []
    funds = json.loads((DATA / "funds.json").read_text(encoding="utf-8"))["funds"]
    for f in funds:
        if f["grp"] not in G:
            continue
        h = json.loads((DATA / "funds" / f"{f['k']}.json").read_text(encoding="utf-8"))
        k = (G.index(f["grp"]), FAM[f["fam"]])
        hist = {pi[p]: a for p, a in zip(h["p"], h["a"]) if p in pi and a is not None}
        for i, a in hist.items():
            S[k][i] += a
        if not hist:
            continue
        i0 = min(hist)
        if i0 == 0:
            continue  # in the files from the first month: not an entry
        first[k].append((i0, hist))
        if hist[i0] >= MIN_EV or hist[max(hist)] >= MIN_EV:
            ev.append([k[0], k[1], f["name"], P[i0], round(hist[i0], 1), round(hist[max(hist)], 1)])

    series, checks = {}, collections.Counter()
    for k in sorted(set(A) | set(S)):
        a, s = A[k], S[k]
        R = [a[i] - s[i] for i in range(T)]
        checks["resid_last_abs"] = max(checks["resid_last_abs"], round(abs(R[-1]), 1))
        out = {"a": [round(x, 1) for x in a]}
        for w in WIN:
            inn, nin, oo = {}, {}, {}
            for i in range(w, T):
                lo = i - w
                ents = [(i0, h) for i0, h in first[k] if lo < i0 <= i]
                if not ents:
                    continue
                v = sum(h.get(i, 0.0) for _, h in ents)
                # funds gone from the files since lo: what they held at lo, less what those still alive at i hold (an estimate)
                gone = max(0.0, R[lo] - R[i])
                inn[i], nin[i] = round(v, 1), len(ents)
                if gone > 0.05:
                    oo[i] = round(gone, 1)
            out[f"in{w}"], out[f"nin{w}"], out[f"out{w}"] = inn, nin, oo
        if any(out["a"]):
            series[f"{k[0]}|{k[1]}"] = out
    res = {"v": 1, "built": dt.date.today().isoformat(), "source": m["meta"].get("source") or "הרשות לשוק ההון, ביטוח וחיסכון",
           "months": P, "groups": G, "series": series, "ev": sorted(ev, key=lambda e: (e[3], e[0])), "checks": dict(checks)}
    (DATA / "roster.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"roster.json: {len(series)} series, {len(ev)} named entries, {(DATA / 'roster.json').stat().st_size // 1024} KB, checks {dict(checks)}")


if __name__ == "__main__":
    main()
