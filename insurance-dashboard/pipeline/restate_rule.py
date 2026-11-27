"""The restatement rule of the IFRS 17 note families (series/<company>.json and the ifrs:* metrics of the peer registry): one value per
(company, metric, segment, basis, period), the LATEST print, as the statements' fact table shows it (docs/FACTS.md, policy `latest`).

A later report that reprints a period with another figure restated it; the site shows the restated figure and keeps the first print beside
it (series: rst / rfrom; registry: flag 8). The later print is taken only when it is plausibly the same figure: equal within rounding, or the
same sign and within 10%. IFRS 17 restatements of the insurers move a line by a few percent; a note or segment table reprinted further
apart is a regrouping, a basis the extraction did not tell apart, or another table, and then the first print stands.
"""

TOL = 0.5      # NIS millions: the reports print thousands or millions, so a gap of half a million or less is rounding
BAND = 0.10    # the widest restatement taken as the same figure


def restated(a, b):
    """two prints of one figure differ beyond rounding"""
    return abs(a - b) > TOL


def plausible(a, b):
    """the later print b is a restatement of the first print a, not another line"""
    if not restated(a, b):
        return True
    return bool(a and b) and a * b > 0 and abs(b / a - 1) <= BAND


def rkey(p):
    """a report period in publication order: 2025Q1 < 2025Q2 < 2025Q3 < 2025FY < 2026Q1. As plain strings "2025FY" sorts before
    "2025Q1", which made the annual report look older than the year's interim reports (a year-end balance reprinted in the annual
    report kept the Q1-Q3 comparative print)"""
    if isinstance(p, str) and len(p) == 6 and p[:4].isdigit() and p[4:] in ("Q1", "Q2", "Q3", "FY", "H1"):
        return (int(p[:4]), {"Q1": 1, "Q2": 2, "H1": 2, "Q3": 3, "FY": 4}[p[4:]])
    return p


def pick(prints, when, own=lambda c: False):
    """prints: candidate cells of one figure; when(c): the report that printed it (a report period, 2025FY, or any sortable key);
    own(c): printed by the period's own report.
    Returns (chosen, first): the latest print when it restated the first plausibly, else the first print (then chosen is first)."""
    w = lambda c: rkey(when(c))
    first = min(prints, key=lambda c: (w(c), not own(c)))
    top = max(w(c) for c in prints)
    last = next(c for c in prints if w(c) == top)  # within one report, the first of its prints (the order the extraction kept)
    if last is first or not restated(first["v"], last["v"]) or not plausible(first["v"], last["v"]):
        return first, first  # no restatement (a reprint within rounding keeps the first print's report and page), or not the same figure
    # the restated figure keeps the report and page that first printed IT: Harel 31.12.24 16,358 is the Q1'26 opening (p. 16), reprinted
    # in Q2'26 (p. 19) and Q3'26 (p. 22)
    same = [c for c in prints if w(c) > w(first) and not restated(c["v"], last["v"])]
    return min(same, key=lambda c: (w(c), not own(c))), first
