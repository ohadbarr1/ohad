"""The arithmetic of the F2 funds analytics, standard library only (pipeline/build_fund_stats.py computes with it, pipeline/tests/
test_fund_stats.py pins it on series with known answers). Returns are monthly percent (1.5 = 1.5%); results are percent unless stated.

Determinism: only + − × ÷, sqrt and math.fsum (no sum(), whose 3.12 compensation changes the last digit; no log/exp, which the platform's
libm may round differently), so the files rebuild byte-equal on 3.9 and 3.12, macOS and Linux. The one power (annualising, monthly rf) is
the same ** the F1 builder already uses.
"""
import math

Z90 = 1.6448536269514722  # the standard normal 95th percentile: a two-sided 90% interval


# ------------------------------------------------------------------------------------------------ basics
def mean(xs):
    return math.fsum(xs) / len(xs)


def stdev(xs):
    """sample standard deviation (n − 1); None below two points"""
    n = len(xs)
    if n < 2:
        return None
    m = mean(xs)
    return math.sqrt(math.fsum((x - m) ** 2 for x in xs) / (n - 1))


def median(xs):
    v = sorted(x for x in xs if x is not None)
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def growth(xs):
    """the wealth multiple of a run of monthly percent returns (sequential products); None if any is missing"""
    if not xs or any(x is None for x in xs):
        return None
    f = 1.0
    for x in xs:
        f *= 1 + x / 100
    return f


def compound(xs):
    g = growth(xs)
    return None if g is None else (g - 1) * 100


def annualise_growth(g, months):
    """a wealth multiple over `months` months -> percent a year"""
    if g is None or g <= 0:
        return None
    return (g ** (12 / months) - 1) * 100


def monthly_rf(annual_pct):
    """an annual yield in percent -> the equivalent monthly percent return: (1 + y)^(1/12) − 1"""
    return None if annual_pct is None else ((1 + annual_pct / 100) ** (1 / 12) - 1) * 100


# ------------------------------------------------------------------------------------------------ risk
def vol_ann(xs):
    """annualised volatility: sample stdev of the monthly returns × √12"""
    s = stdev(xs)
    return None if s is None else s * math.sqrt(12)


def drawdown(xs):
    """over a run of monthly returns starting from wealth 1 (the start of the first month counts as a peak):
    {max: the deepest fall from a running peak, percent ≤ 0; cur: the fall at the last month; len: months from that peak to the trough;
     rec: months from the trough until wealth first regains the peak (None if not regained by the last month); peak, trough: 0-based month
     index of the peak (−1 = before the first month) and of the trough}. None if any return is missing."""
    if not xs or any(x is None for x in xs):
        return None
    w, peak, ipk = 1.0, 1.0, -1
    best = {"max": 0.0, "peak": -1, "trough": -1}
    for i, x in enumerate(xs):
        w *= 1 + x / 100
        if w > peak:
            peak, ipk = w, i
        dd = (w / peak - 1) * 100
        if dd < best["max"]:
            best = {"max": dd, "peak": ipk, "trough": i, "level": peak}
    cur = (w / peak - 1) * 100
    out = {"max": best["max"], "cur": cur, "peak": best["peak"], "trough": best["trough"], "len": None, "rec": None}
    if best["trough"] >= 0:
        out["len"] = best["trough"] - best["peak"]
        w2 = 1.0
        lvl = best["level"]
        for i, x in enumerate(xs):
            w2 *= 1 + x / 100
            if i > best["trough"] and w2 >= lvl:
                out["rec"] = i - best["trough"]
                break
    return out


def sharpe_ann(xs, rf):
    """annualised Sharpe: mean monthly excess return ÷ its sample stdev × √12 (rf: monthly percent, same length)"""
    ex = [a - b for a, b in zip(xs, rf)]
    s = stdev(ex)
    return None if not s else mean(ex) / s * math.sqrt(12)


def sortino_ann(xs, rf):
    """annualised Sortino: mean monthly excess return ÷ downside deviation × √12; downside deviation = √(Σ min(0, excess)² ÷ n) over all
    n months (target = the risk-free rate). None when no month falls below the target"""
    ex = [a - b for a, b in zip(xs, rf)]
    dd = math.sqrt(math.fsum(min(0.0, e) ** 2 for e in ex) / len(ex))
    return None if not dd else mean(ex) / dd * math.sqrt(12)


def beta(xs, bs):
    """OLS slope of the track on the benchmark: cov(x, b) ÷ var(b), sample moments"""
    if len(xs) < 3:
        return None
    mx, mb = mean(xs), mean(bs)
    vb = math.fsum((b - mb) ** 2 for b in bs)
    if not vb:
        return None
    return math.fsum((x - mx) * (b - mb) for x, b in zip(xs, bs)) / vb


def te_ann(xs, bs):
    """annualised tracking error: sample stdev of (track − benchmark) × √12"""
    return vol_ann([x - b for x, b in zip(xs, bs)])


def capture(xs, bs, up=True):
    """up (down) capture ratio, percent: the track's geometric mean monthly return over the months the benchmark rose (fell) ÷ the
    benchmark's over the same months × 100 (the Morningstar definition). None when there are no such months"""
    ix = [i for i, b in enumerate(bs) if (b > 0 if up else b < 0)]
    if not ix:
        return None
    gx, gb = growth([xs[i] for i in ix]), growth([bs[i] for i in ix])
    rx, rb = gx ** (1 / len(ix)) - 1, gb ** (1 / len(ix)) - 1
    return None if not rb else rx / rb * 100


# ------------------------------------------------------------------------------------------------ persistence
def quartiles(pairs):
    """[(key, value)] -> {key: 1..4}, 1 = the highest quarter: rank by value descending (ties by key), quartile = ⌊4 × (rank − 1) ÷ n⌋ + 1"""
    xs = sorted(pairs, key=lambda kv: (-kv[1], kv[0]))
    n = len(xs)
    return {k: 4 * i // n + 1 for i, (k, _) in enumerate(xs)}


def spearman(a, b):
    """Spearman rank correlation of two equal-length lists (average ranks for ties); None below three points or with no variation"""
    n = len(a)
    if n < 3:
        return None
    ra, rb = _ranks(a), _ranks(b)
    ma, mb = mean(ra), mean(rb)
    va = math.fsum((x - ma) ** 2 for x in ra)
    vb = math.fsum((x - mb) ** 2 for x in rb)
    if not va or not vb:
        return None
    return math.fsum((x - ma) * (y - mb) for x, y in zip(ra, rb)) / math.sqrt(va * vb)


def _ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for t in range(i, j + 1):
            r[order[t]] = (i + j) / 2 + 1
        i = j + 1
    return r


def wilson(k, n, z=Z90):
    """Wilson score interval for a binomial share k/n, percent; (None, None) when n = 0"""
    if not n:
        return None, None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h) * 100, (c + h) * 100


class Rng:
    """a tiny deterministic generator (64-bit LCG, Knuth's MMIX constants) so the bootstrap draws are the same on every Python"""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def below(self, n):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 33) % n


def block_bootstrap(units, block, reps=2000, seed=1, lo=5.0, hi=95.0):
    """circular block bootstrap of a ratio Σ num ÷ Σ den over a time-ordered list of (num, den) units (one per start month): draw
    ⌈m ÷ block⌉ blocks of `block` consecutive units (wrapping from the last unit to the first, so every unit is equally likely) with
    replacement, recompute the ratio; returns the (lo, hi) percentiles, percent. Blocks of the window length carry the overlap of
    consecutive start months (their forward windows share months)."""
    m = len(units)
    if not m or not math.fsum(d for _, d in units):
        return None, None
    L = max(1, min(block, m))
    nb = -(-m // L)
    r = Rng(seed)
    stats = []
    for _ in range(reps):
        num = den = 0
        for _ in range(nb):
            s = r.below(m)
            for j in range(L):
                u = units[(s + j) % m]
                num += u[0]
                den += u[1]
        if den:
            stats.append(num / den * 100)
    stats.sort()
    if not stats:
        return None, None

    def pct(q):
        i = q / 100 * (len(stats) - 1)
        a = int(math.floor(i))
        b = min(a + 1, len(stats) - 1)
        return stats[a] + (stats[b] - stats[a]) * (i - a)
    return pct(lo), pct(hi)
