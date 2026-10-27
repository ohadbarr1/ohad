"""A5 · the war room's estimator: weighted least squares on a panel with any number of absorbed fixed effects, cluster-robust errors.
Standard library only (no numpy): the regressors are few (about a dozen), the rows a few tens of thousands.

    fit(y, X, w, fes, cluster, names) -> {b, se, t, V, n, k, r2, clusters}
      y        list of floats (n)
      X        list of rows, each a list of k floats
      w        list of weights (n), > 0
      fes      list of fixed-effect groupings, each a list of n hashable keys; absorbed by weighted alternating projections
               (Gauss-Seidel demeaning to convergence, the method of reghdfe / fixest)
      cluster  list of n keys: the one-way cluster-robust (sandwich) variance with the small-sample factor G/(G-1) x (n-1)/(n-k)
    lincom(fit, a) -> (value, se): a linear combination a'b and its standard error (the sum of distributed-lag coefficients)
"""
from math import fsum  # correctly rounded: the same result on Python 3.9 (local) and 3.12 (CI), whose sum() compensates
import math
from collections import defaultdict


def demean(cols, w, fes, tol=1e-10, it=500):
    """every column with the weighted group means of each fixed effect removed, repeated until no column moves by more than tol"""
    cols = [list(c) for c in cols]
    idx = []
    for fe in fes:
        m = {}
        idx.append([m.setdefault(k, len(m)) for k in fe])
    for _ in range(it):
        moved = 0.0
        for ix in idx:
            G = max(ix) + 1 if ix else 0
            sw = [0.0] * G
            for i, g in enumerate(ix):
                sw[g] += w[i]
            for c in cols:
                s = [0.0] * G
                for i, g in enumerate(ix):
                    s[g] += w[i] * c[i]
                for i, g in enumerate(ix):
                    d = s[g] / sw[g]
                    if d:
                        c[i] -= d
                        if abs(d) > moved:
                            moved = abs(d)
        if moved < tol:
            break
    return cols


def solve(A, B):
    """A x = B for a small dense symmetric system (Gauss-Jordan with partial pivoting); B is a list of right-hand columns"""
    n = len(A)
    M = [list(A[i]) + [b[i] for b in B] for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-14:
            raise ValueError("singular design: a regressor is collinear with the fixed effects")
        M[c], M[p] = M[p], M[c]
        pv = M[c][c]
        M[c] = [x / pv for x in M[c]]
        for r in range(n):
            if r != c and M[r][c]:
                f = M[r][c]
                M[r] = [x - f * y for x, y in zip(M[r], M[c])]
    return [[M[i][n + j] for i in range(n)] for j in range(len(B))]


def fit(y, X, w, fes, cluster, names):
    n, k = len(y), len(X[0])
    cols = demean([y] + [[r[j] for r in X] for j in range(k)], w, fes)
    yd, Xd = cols[0], cols[1:]
    XtX = [[fsum(w[i] * Xd[a][i] * Xd[b][i] for i in range(n)) for b in range(k)] for a in range(k)]
    Xty = [fsum(w[i] * Xd[a][i] * yd[i] for i in range(n)) for a in range(k)]
    inv = solve(XtX, [[1.0 if i == j else 0.0 for i in range(k)] for j in range(k)])  # columns of the inverse
    Inv = [[inv[j][i] for j in range(k)] for i in range(k)]
    b = [fsum(Inv[a][c] * Xty[c] for c in range(k)) for a in range(k)]
    e = [yd[i] - fsum(b[a] * Xd[a][i] for a in range(k)) for i in range(n)]
    sc = defaultdict(lambda: [0.0] * k)
    for i in range(n):
        s = sc[cluster[i]]
        we = w[i] * e[i]
        for a in range(k):
            s[a] += Xd[a][i] * we
    G = len(sc)
    meat = [[0.0] * k for _ in range(k)]
    for s in sc.values():
        for a in range(k):
            if s[a]:
                for c in range(k):
                    meat[a][c] += s[a] * s[c]
    q = G / (G - 1) * (n - 1) / (n - k) if G > 1 and n > k else 1.0
    IM = [[fsum(Inv[a][m] * meat[m][c] for m in range(k)) for c in range(k)] for a in range(k)]
    V = [[q * fsum(IM[a][m] * Inv[m][c] for m in range(k)) for c in range(k)] for a in range(k)]
    se = [math.sqrt(max(V[a][a], 0.0)) for a in range(k)]
    ybar = fsum(w[i] * yd[i] for i in range(n)) / fsum(w)
    sst = fsum(w[i] * (yd[i] - ybar) ** 2 for i in range(n))
    sse = fsum(w[i] * e[i] ** 2 for i in range(n))
    return {"names": names, "b": b, "se": se, "t": [b[a] / se[a] if se[a] else 0.0 for a in range(k)], "V": V, "n": n, "k": k,
            "r2": 1 - sse / sst if sst else 0.0, "clusters": G}


def lincom(f, a):
    v = fsum(x * y for x, y in zip(a, f["b"]))
    var = fsum(a[i] * f["V"][i][j] * a[j] for i in range(len(a)) for j in range(len(a)))
    return v, math.sqrt(max(var, 0.0))


def ols1(y, x):
    """simple regression y = a + b x: (a, b, se_b, r2, n)"""
    n = len(y)
    if n < 3:
        return None
    mx, my = fsum(x) / n, fsum(y) / n
    sxx = fsum((v - mx) ** 2 for v in x)
    if sxx <= 0:
        return None
    b = fsum((u - mx) * (v - my) for u, v in zip(x, y)) / sxx
    a = my - b * mx
    sse = fsum((v - a - b * u) ** 2 for u, v in zip(x, y))
    sst = fsum((v - my) ** 2 for v in y)
    se = math.sqrt(sse / (n - 2) / sxx) if n > 2 else float("nan")
    return a, b, se, (1 - sse / sst) if sst else 0.0, n
