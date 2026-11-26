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


def pick(prints, when, own=lambda c: False):
    """prints: candidate cells of one figure; when(c): the report that printed it (sortable); own(c): printed by the period's own report.
    Returns (chosen, first): the latest print when it restated the first plausibly, else the first print (then chosen is first)."""
    first = min(prints, key=lambda c: (when(c), not own(c)))
    top = max(when(c) for c in prints)
    last = next(c for c in prints if when(c) == top)  # within one report, the first of its prints (the order the extraction kept)
    if last is first or not restated(first["v"], last["v"]) or not plausible(first["v"], last["v"]):
        return first, first  # no restatement (a reprint within rounding keeps the first print's report and page), or not the same figure
    return last, first
