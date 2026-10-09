"""CSM roll-forward tie-out shared by the verifier and the site export.

Filers print movement rows with different sign conventions (as a change in the liability, or as income and expense).
`solve` finds the signs under which opening + movements = closing. A unique answer means the table was copied whole.
"""
from itertools import product


def solve(opening, closing, moves, tol=None):
    """moves: list of numbers as printed. Returns (signs, how) where how is 'as printed', 'signs normalised', 'ambiguous' or None."""
    tol = tol if tol is not None else max(2.0, abs(closing) * 0.0005)
    if abs(opening + sum(moves) - closing) <= tol:
        return [1] * len(moves), "as printed"
    if len(moves) > 12:
        return None, None
    hits = [s for s in product((1, -1), repeat=len(moves)) if abs(opening + sum(a * b for a, b in zip(s, moves)) - closing) <= tol]
    # rows printed as zero can take either sign: collapse those duplicates
    uniq = {tuple(1 if m == 0 else x for x, m in zip(s, moves)) for s in hits}
    if len(uniq) == 1:
        return list(next(iter(uniq))), "signs normalised"
    return None, "ambiguous" if uniq else None
