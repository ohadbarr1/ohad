"""Attribution math (module A4): split the change of a ratio between two states into additive driver contributions that sum EXACTLY
to the total. Standard library only, no I/O: pipeline/build_attribution.py feeds it reported facts, and a driver graph (module A1,
pipeline/build_drivers.py) can feed it the same way later, by handing in more factors or finer components.

The model of one state (a company in a period):

    value = (C * k - M) * q            C = sum of pre-tax components c_i (NIS m)      k = net profit / profit before tax (tax rate mode)
          = (C - T - M) * q                                                            T = profit before tax - net profit  (amount mode)
                                       M = profit to non-controlling interests          q = annualisation / average equity  (1 for a NIS bridge)

Method (stated on every bridge as METHOD):
  1. Shapley value over the factor groups {C, k or T, M, q}: each factor's contribution is its marginal effect averaged over every order
     in which the factors can move from the first state to the second (2^(n-1) coalitions, weights |S|!(n-|S|-1)!/n!). The contributions
     sum to value(second) - value(first) exactly (efficiency); no order is privileged, so the result does not depend on the listing.
  2. value is linear in C, so C's Shapley contribution is (sum of delta c_i) x W_C with W_C the Shapley-weighted slope; each component
     gets delta c_i x W_C. Exact.
  3. A component that is a product of reported parts (fee income = fee yield x managed assets, managed assets = total x mix share) is
     split by the midpoint rule, which is the two-factor Shapley value and exact: d(y*A) = dy*avg(A) + avg(y)*dA, and
     dA_p = dA*avg(w_p) + avg(A)*dw_p.
  The residual (total minus the sum of the contributions) is computed and carried; with this method it is zero up to float rounding.
"""
from itertools import combinations
from math import factorial, fsum

METHOD = ("Shapley על קבוצות הגורמים {רכיבי הרווח לפני מס, מס, זכויות שאינן מקנות שליטה, בסיס ההון}: תרומת כל גורם היא השפעתו השולית "
          "בממוצע על כל סדרי השינוי האפשריים, ולכן הסדר אינו משנה והתרומות מסתכמות בדיוק לשינוי. רכיב שהוא מכפלה (דמי ניהול = שיעור × נכסים "
          "× תמהיל) מפוצל בכלל נקודת האמצע (Shapley של שני גורמים), גם הוא מדויק.")


def shapley(names, x0, x1, f):
    """Shapley contributions of the factor groups `names` moving from x0 to x1 (dicts name -> value) for the function f(dict) -> float.
    Returns {name: contribution}; sum == f(x1) - f(x0) up to float rounding."""
    n = len(names)
    w = [factorial(s) * factorial(n - s - 1) / factorial(n) for s in range(n)]
    out = {}
    for i in names:
        rest = [j for j in names if j != i]
        parts = []
        for s in range(n):
            for S in combinations(rest, s):
                at = {j: (x1[j] if j in S else x0[j]) for j in names}
                hi = dict(at, **{i: x1[i]})
                lo = dict(at, **{i: x0[i]})
                parts.append(w[s] * (f(hi) - f(lo)))
        out[i] = fsum(parts)
    return out


def slope(names, x0, x1, f, lin):
    """The Shapley-weighted slope of f in the factor `lin` (f must be linear in it): contribution(lin) = (x1[lin] - x0[lin]) * slope."""
    n = len(names)
    w = [factorial(s) * factorial(n - s - 1) / factorial(n) for s in range(n)]
    rest = [j for j in names if j != lin]
    parts = []
    for s in range(n):
        for S in combinations(rest, s):
            at = {j: (x1[j] if j in S else x0[j]) for j in names}
            parts.append(w[s] * (f(dict(at, **{lin: 1.0})) - f(dict(at, **{lin: 0.0}))))
    return fsum(parts)


def product_split(parts0, parts1, other0, other1):
    """A component c = sum_p y_p * A * w_p + other, in two states. parts*: {p: (y_p, A_p)} with A = sum_p A_p and w_p = A_p / A.
    Returns {'yield', 'volume', 'mix', 'other'} whose sum is c1 - c0 exactly (midpoint rule)."""
    keys = sorted(set(parts0) | set(parts1))
    A0 = fsum(parts0.get(p, (0.0, 0.0))[1] for p in keys)
    A1 = fsum(parts1.get(p, (0.0, 0.0))[1] for p in keys)
    Am = (A0 + A1) / 2
    yv, vol, mix = [], [], []
    for p in keys:
        y0, a0 = parts0.get(p, (0.0, 0.0))
        y1, a1 = parts1.get(p, (0.0, 0.0))
        if a0 == 0 and p not in parts0:  # a segment that starts reporting: its yield is the other side's (no yield effect)
            y0 = y1
        if a1 == 0 and p not in parts1:
            y1 = y0
        w0 = a0 / A0 if A0 else 0.0
        w1 = a1 / A1 if A1 else 0.0
        ym = (y0 + y1) / 2
        yv.append((y1 - y0) * (a0 + a1) / 2)
        vol.append(ym * (A1 - A0) * (w0 + w1) / 2)
        mix.append(ym * Am * (w1 - w0))
    return {"yield": fsum(yv), "volume": fsum(vol), "mix": fsum(mix), "other": other1 - other0}


def model_value(x):
    """value of one state: x = {C, k|T, M, q}; rate mode when 'k' is present."""
    if "k" in x:
        return (x["C"] * x["k"] - x["M"]) * x.get("q", 1.0)
    return (x["C"] - x["T"] - x["M"]) * x.get("q", 1.0)


def bridge(s0, s1, rate=True, with_q=True):
    """Decompose model_value(s1) - model_value(s0). s0/s1: {'comps': {key: value NIS m}, 'splits': {key: (parts, other)}, 'pbt', 'np',
    'np_attr', 'q'} (q = annualisation / average equity, or 1). Returns (from, to, {driver: contribution}, residual).

    Driver keys: every component key (or, for a split component, key + '.yield' / '.volume' / '.mix' / '.other'), 'tax', 'minority',
    and 'equity' when with_q."""
    def factors(s):
        x = {"C": fsum(s["comps"].values()), "M": s["np"] - s["np_attr"], "q": s["q"] if with_q else 1.0}
        if rate:
            x["k"] = s["np"] / s["pbt"]
        else:
            x["T"] = s["pbt"] - s["np"]
        return x
    x0, x1 = factors(s0), factors(s1)
    names = ["C", "k" if rate else "T", "M"] + (["q"] if with_q else [])
    phi = shapley(names, x0, x1, model_value)
    wc = slope(names, x0, x1, model_value, "C")
    out = {}
    for key in s1["comps"]:
        d = s1["comps"][key] - s0["comps"].get(key, 0.0)
        sp0, sp1 = s0.get("splits", {}).get(key), s1.get("splits", {}).get(key)
        if sp0 and sp1:
            parts = product_split(sp0[0], sp1[0], sp0[1], sp1[1])
            for sub, v in parts.items():
                out[f"{key}.{sub}"] = v * wc
        else:
            out[key] = d * wc
    out["tax"] = phi["k" if rate else "T"]
    out["minority"] = phi["M"]
    if with_q:
        out["equity"] = phi["q"]
    v0, v1 = model_value(x0), model_value(x1)
    residual = (v1 - v0) - fsum(out.values())
    # the per-component split of C is exact only when C's own Shapley value equals (sum of deltas) x slope: assert it
    assert abs(phi["C"] - (x1["C"] - x0["C"]) * wc) <= 1e-9 * max(1.0, abs(phi["C"])), "value is not linear in C"
    return v0, v1, out, residual


def rate_ok(s):
    """the tax-rate form needs a positive profit before tax and an effective rate in [0, 60%] on the state"""
    return s["pbt"] > 0 and 0 <= (s["pbt"] - s["np"]) / s["pbt"] <= 0.6
