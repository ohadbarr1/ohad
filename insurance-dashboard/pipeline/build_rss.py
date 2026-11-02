"""Static RSS 2.0 and Atom feeds of the delta feed (module M2), rebuilt with the data: pull-based alerts with no server.

python3 pipeline/build_rss.py            write the feeds, the first-seen ledger and the two small files the site reads
python3 pipeline/build_rss.py --check    rebuild in memory from feed.json + the ledger and compare (check_feed.py runs it: gate `feed`)

Feeds (each as .xml = RSS 2.0, served application/rss+xml, and .atom = Atom 1.0, served application/atom+xml; firebase.json):
  /feed.xml               every event, newest received first (the last MAX_ALL)
  /feed/<company>.xml     one company's events (a company of feed.json `cos` with at least one event; `market` = the regulator's months
                          and the market-wide events)
  /feed/months.xml        a new month of the regulator's fund data landed (type regmonth)
  /feed/funds.xml         a track's average management fee moved by 0.05 points (5bp) or more month on month (type fee: tracks of NIS 1bn
                          or more, build_feed.FEE_MIN / FEE_ASSETS). Default-fund tender changes are not in feed.json, so not here.

Received date. pubDate is the day fox first published the event, from the append-only ledger data/ledger/feed_seen.json
{id: [date, kind]}: kind r = the build that first carried the event (or, for the regulator's latest month, the day the file was fetched);
kind b = backfill: the event existed when the ledger began (LEDGER_SINCE), its own date stands in (MAYA publication day, the regulator's
fetch day, or the data month's last day). A new id gets the feed's build day (feed.json `built`: the build that first carried it). An id never changes date.
guid = tag:fox-research-il.web.app,2026:feed/<event id> (event ids are stable across rebuilds: build_feed.py), never a permalink.

Also written: web/public/data/news.json (the slim feed behind a fund's news line, lib/news.ts), web/public/data/feed_seen.json (the ledger, for the /feed page's "התקבל" column) and web/public/data/alerts.json (the latest
regulator month and when it was received, for the browser's "new month" notification; the list of feeds). Standard library only.
"""
import argparse
import datetime as dt
import json
from decimal import ROUND_HALF_UP, Decimal
import sys
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "web" / "public"
DATA = PUB / "data"
LEDGER = ROOT / "data" / "ledger" / "feed_seen.json"
SITE = "https://fox-research-il.web.app"
TAG = "tag:fox-research-il.web.app,2026:feed/"
MAX_ALL, MAX_ONE = 200, 120
TYPE_SHORT = {"filing": "דוח", "restate": "הצגה מחדש", "regmonth": "חודש רשות", "flow": "צבירה נטו", "target": "יעד", "solv": "כושר פירעון",
              "fee": "דמי ניהול", "est": "אומדנים", "pos": "עמדות", "fragility": "שבריריות"}
DOC_HE = {"annual": "דוח שנתי", "quarterly": "דוח רבעוני", "presentation": "מצגת", "solvency": "דוח כושר פירעון"}
DS_HE = {"gemel": "גמל-נט", "pensia": "פנסיה-נט", "insurance": "ביטוח-נט"}
DK_HE = {"pub": "פורסם במאיה", "fetched": "התקבל מהרשות", "month": "חודש הנתונים"}
UNIT_HE = {"m": 'מיליוני ש"ח', "dm": 'מיליוני ש"ח', "bn": 'מיליארד ש"ח', "dbn": 'מיליארד ש"ח', "pp": "נק׳ אחוז"}
MINUS = "−"
PKG = {"gemel": "gemelnet", "pensia": "pensia-net", "insurance": "insurance"}   # the CKAN packages (market.json meta.packages)
SPECIAL = {"months": ("regmonth",), "funds": ("fee",)}
NEWS_TYPES = {"fee", "restate", "merger", "tender", "service", "regdec"}   # lib/news.ts: a track's own fee, its manager's company-level events
NEWS_DAYS = 200                                                             # the page keeps the last 90 days from its own today


# ---------------------------------------------------------------------------------------------------------------- text, as the site shows it
def nf(v, d):
    """toLocaleString('en-US'): half away from zero (Intl's halfExpand), not Python's half-to-even"""
    q = Decimal(repr(v)).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    t = f"{q:,.{d}f}"
    if t.startswith("-") and not t.strip("-0.,"):
        return t[1:]                      # a figure that rounds to zero carries no sign
    return t.replace("-", MINUS)


def plus(v, d):
    return "+" if Decimal(repr(v)).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP) > 0 else ""


def fmt_fig(f):
    """lib/feed.ts fmtFig"""
    v, u = f["v"], f["u"]
    if u == "pct":
        return f"{nf(v, 2 if abs(v) < 5 else 1)}%"
    if u == "dpct":
        return f"{plus(v, 1)}{nf(v, 1)}%"
    if u in ("pp", "dbn"):
        return f"{plus(v, 2)}{nf(v, 2)}"
    if u == "bn":
        return nf(v, 2)
    if u == "m":
        return nf(v, 1 if abs(v) < 1000 else 0)
    if u == "dm":
        return f"{plus(v, 1)}{nf(v, 1 if abs(v) < 1000 else 0)}"
    if u == "r":
        return nf(v, 2)
    return nf(v, 0)


def per_label(p):
    if not p:
        return ""
    if p.endswith("FY"):
        return f"FY'{p[2:4]}"
    if len(p) == 6 and p[4] == "Q":
        return f"{p[4:]}'{p[2:4]}"
    if len(p) == 6 and p.isdigit():
        return f"{p[4:]}/{p[2:4]}"
    return p


def dlab(iso):
    return f"{iso[8:10]}.{iso[5:7]}.{iso[2:4]}"


def doc_name(F, rid):
    d = F["docs"].get(str(rid))
    if not d:
        return f"דוח {rid}"
    return f"{F['cos'].get(d[0], d[0])}, {DOC_HE.get(d[1], 'דוח')}{' ' + per_label(d[2]) if d[2] else ''}"


def event_source(F, e):
    """(text, url or None): lib/feed.ts eventSource"""
    s = e["src"]
    if s["k"] == "doc":
        d = F["docs"].get(str(s["rid"]))
        pg = s.get("pg")
        url = F["files"] + d[4] + (f"#page={pg}" if pg else "") if d else None
        return doc_name(F, s["rid"]) + (f" · עמ׳ {pg}" if pg else ""), url
    if s["k"] == "reg":
        return f"רשות שוק ההון, גמל-נט / פנסיה-נט / ביטוח-נט (data.gov.il) · {per_label(str(s['ym']))}", None
    if s["k"] == "fund":
        pkg = PKG.get(s["ds"])
        return (f"רשות שוק ההון, {DS_HE.get(s['ds'], s['ds'])} · קופה {s['id']} · {per_label(str(s['ym']))}",
                f"https://data.gov.il/dataset/{pkg}" if pkg else None)
    if s["k"] == "pos":
        return f"ספר העמדות של fox · r{s['rev']}", None
    if s["k"] == "frag":
        return "מוניטור השבריריות של fox", None
    return "fox", None


def row_text(r):
    unit = UNIT_HE.get(r["a"]["u"], "")
    ab = r.get("ab") or []
    if r.get("rng"):
        return f"{r['l']}: {fmt_fig(r['a'])} עד {fmt_fig(r['b'])}{' ' + unit if unit else ''}"
    s = f"{r['l']}: {fmt_fig(r['a'])}{' ' + unit if unit else ''}{f' ({ab[0]})' if ab else ''}"
    if r.get("b"):
        s += f", לעומת {fmt_fig(r['b'])}{f' ({ab[1]})' if len(ab) > 1 else ''}"
    if r.get("d"):
        s += f"; שינוי {fmt_fig(r['d'])}"
        if r.get("dp"):
            s += f" ({fmt_fig(r['dp'])})"
    if r.get("note"):
        s += f". {r['note']}"
    return s


def title_of(F, e):
    name = F["cos"].get(e["c"], e["c"])
    t = f"{TYPE_SHORT.get(e['t'], e['t'])}: {e['h']}" if e["c"] == "market" else f"{name} · {TYPE_SHORT.get(e['t'], e['t'])}: {e['h']}"
    r = (e.get("rows") or [None])[0]
    if r and r.get("b") and not r.get("rng") and r["a"]["u"] == "pct":
        t += f" ({fmt_fig(r['b'])} → {fmt_fig(r['a'])})"
    return t


def body_html(F, e, seen):
    """the item's description: every figure with its period, then its source, then the two dates (HTML, escaped into the XML)"""
    text, url = event_source(F, e)
    lines = [escape(row_text(r)) for r in e.get("rows") or []]
    src = f'מקור: <a href={quoteattr(url)}>{escape(text)}</a>' if url else f"מקור: {escape(text)}"
    lines.append(src)
    d, kind = seen
    when = f"התקבל ב-fox: {dlab(d)}" if kind == "r" else f"{DK_HE[e['dk']]}: {dlab(e['d']) if e['dk'] != 'month' else per_label(e['per'])}"
    lines.append(f"{when} · תקופה: {escape(per_label(e['per']))} · כל מספר נפתח בעמוד המקור ב-fox: <a href={quoteattr(SITE + e['to'])}>{escape(SITE + e['to'])}</a>")
    return '<div dir="rtl">' + "".join(f"<p>{x}</p>" for x in lines) + "</div>"


# ---------------------------------------------------------------------------------------------------------------- dates
def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("Asia/Jerusalem")
    except Exception:  # noqa: BLE001  (no tz database: Israel standard time)
        return dt.timezone(dt.timedelta(hours=2))


TZ = _tz()
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def midnight(iso):
    return dt.datetime.fromisoformat(iso[:10]).replace(tzinfo=TZ)


def rfc822(iso):
    x = midnight(iso)
    off = x.utcoffset()
    h, m = divmod(int(off.total_seconds()) // 60, 60)
    return f"{DAYS[x.weekday()]}, {x.day:02d} {MONTHS[x.month - 1]} {x.year} 00:00:00 {'+' if h >= 0 else '-'}{abs(h):02d}{m:02d}"


def rfc3339(iso):
    return midnight(iso).isoformat()


# ---------------------------------------------------------------------------------------------------------------- the ledger
def seen_dates(F, ledger):
    """(ledger with every event of F, number of new ids). A new ledger backfills; afterwards a new id gets the feed's build day (the
    build that first carried it), so the files are a pure function of feed.json and the ledger."""
    today = F["built"]
    led = {"v": 1, "since": today, "note": "", "seen": {}} if ledger is None else json.loads(json.dumps(ledger))
    led["note"] = ("first day fox carried each feed event: [date, r] = received at that build (the regulator's latest month: the day its "
                   "file was fetched); [date, b] = the event predates the ledger (" + led["since"] + "), its own date stands in")
    fresh = ledger is None
    n = 0
    for e in F["events"]:
        if e["id"] in led["seen"]:
            continue
        n += 1
        if e["dk"] == "fetched":
            led["seen"][e["id"]] = [min(e["d"], today), "r"]
        elif fresh:
            led["seen"][e["id"]] = [e["d"], "b"]
        else:
            led["seen"][e["id"]] = [today, "r"]
    led["seen"] = dict(sorted(led["seen"].items()))
    return led, n


# ---------------------------------------------------------------------------------------------------------------- the feeds
def channels(F):
    """[(path stem, title, description, events)], every channel the site publishes"""
    ev = F["events"]
    cos = {c: n for c, n in F["cos"].items() if c not in SPECIAL and any(e["c"] == c for e in ev)}
    out = [("feed", "fox · מה השתנה", "כל שינוי שהנתונים של fox נושאים: דוחות כספיים במאיה, הצגות מחדש, חודשי נתוני רשות שוק ההון, דמי ניהול, "
            "יחסי כושר פירעון, יעדי הנהלה. כל מספר עם המקור שלו.", ev, MAX_ALL),
           ("feed/months", "fox · חודש חדש של הרשות", "חודש חדש של נתוני רשות שוק ההון (גמל-נט, פנסיה-נט, ביטוח-נט) נקלט ב-fox: נכסים "
            "וצבירה נטו מול החודש הקודם.", [e for e in ev if e["t"] in SPECIAL["months"]], MAX_ONE),
           ("feed/funds", "fox · שינויים בדמי ניהול", f"מסלול שדמי הניהול הממוצעים שלו זזו ב-{F['rules']['fee_min_pp']} נק׳ אחוז (5 נקודות בסיס) ומעלה "
            f"בחודש, במסלולים של {F['rules']['fee_assets_m']:,.0f} מיליוני ש\"ח ומעלה (נתוני הרשות). שינויים במכרזי קרנות ברירת המחדל אינם "
            "בפיד עדיין.", [e for e in ev if e["t"] in SPECIAL["funds"]], MAX_ONE)]
    for c, name in sorted(cos.items()):
        out.append((f"feed/{c}", f"fox · {name}", f"כל שינוי בנתונים של {name} ב-fox, עם המקור של כל מספר." if c != "market" else
                    "שינויים ברמת השוק: חודשי נתוני הרשות ומעברים בצבירה נטו.", [e for e in ev if e["c"] == c], MAX_ONE))
    return out


def order(events, led):
    return sorted(events, key=lambda e: (led["seen"][e["id"]][0], e["d"], e["id"]), reverse=True)


def rss(F, led, stem, title, desc, events, cap):
    items = order(events, led)[:cap]
    last = max((led["seen"][e["id"]][0] for e in items), default=F["built"])
    page = SITE + ("/feed" if stem == "feed" else "/feed?t=regmonth" if stem == "feed/months" else "/feed?t=fee" if stem == "feed/funds"
                   else f"/feed?co={stem.split('/')[1]}")
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', "<channel>",
           f"<title>{escape(title)}</title>", f"<link>{escape(page)}</link>", f"<description>{escape(desc)}</description>",
           "<language>he</language>", f"<lastBuildDate>{rfc822(last)}</lastBuildDate>", "<ttl>360</ttl>",
           f'<atom:link href={quoteattr(f"{SITE}/{stem}.xml")} rel="self" type="application/rss+xml"/>',
           "<generator>fox pipeline/build_rss.py</generator>",
           f"<image><url>{SITE}/icons/icon-192.png</url><title>{escape(title)}</title><link>{escape(page)}</link></image>"]
    for e in items:
        d = led["seen"][e["id"]]
        out += ["<item>", f"<title>{escape(title_of(F, e))}</title>", f"<link>{escape(SITE + e['to'])}</link>",
                f'<guid isPermaLink="false">{escape(TAG + e["id"])}</guid>', f"<pubDate>{rfc822(d[0])}</pubDate>",
                f"<category>{escape(F['types'][e['t']]['he'])}</category>", f"<category>{escape(F['cos'].get(e['c'], e['c']))}</category>",
                f"<description>{escape(body_html(F, e, d))}</description>", "</item>"]
    out += ["</channel>", "</rss>"]
    return "\n".join(out) + "\n"


def atom(F, led, stem, title, desc, events, cap):
    items = order(events, led)[:cap]
    last = max((led["seen"][e["id"]][0] for e in items), default=F["built"])
    page = SITE + ("/feed" if stem == "feed" else "/feed?t=regmonth" if stem == "feed/months" else "/feed?t=fee" if stem == "feed/funds"
                   else f"/feed?co={stem.split('/')[1]}")
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="he">',
           f"<title>{escape(title)}</title>", f"<subtitle>{escape(desc)}</subtitle>", f"<id>{escape(TAG + stem)}</id>",
           f"<updated>{rfc3339(last)}</updated>", f'<link rel="self" type="application/atom+xml" href={quoteattr(f"{SITE}/{stem}.atom")}/>',
           f'<link rel="alternate" type="text/html" href={quoteattr(page)}/>', "<author><name>fox</name><uri>" + SITE + "</uri></author>",
           f"<icon>{SITE}/icons/icon-192.png</icon>"]
    for e in items:
        d = led["seen"][e["id"]]
        out += ["<entry>", f"<title>{escape(title_of(F, e))}</title>", f"<id>{escape(TAG + e['id'])}</id>",
                f'<link rel="alternate" type="text/html" href={quoteattr(SITE + e["to"])}/>', f"<published>{rfc3339(d[0])}</published>",
                f"<updated>{rfc3339(d[0])}</updated>", f'<category term={quoteattr(e["t"])} label={quoteattr(F["types"][e["t"]]["he"])}/>',
                f'<content type="html">{escape(body_html(F, e, d))}</content>', "</entry>"]
    out.append("</feed>")
    return "\n".join(out) + "\n"


def build(F, ledger):
    """{relative path under web/public: text}, the new ledger, the number of new ids"""
    led, n_new = seen_dates(F, ledger)
    files = {}
    meta = []
    for stem, title, desc, evs, cap in channels(F):
        files[f"{stem}.xml"] = rss(F, led, stem, title, desc, evs, cap)
        files[f"{stem}.atom"] = atom(F, led, stem, title, desc, evs, cap)
        c = stem.split("/")[1] if "/" in stem else None
        meta.append({"p": f"/{stem}.xml", "a": f"/{stem}.atom", "t": title.replace("fox · ", ""), "n": len(evs), "c": c if c not in SPECIAL else None,
                     "k": "all" if stem == "feed" else c if c in SPECIAL else "co"})
    reg = [e for e in F["events"] if e["t"] == "regmonth"]
    last = max(reg, key=lambda e: e["per"]) if reg else None
    alerts = {"v": 1, "built": F["built"], "site": SITE, "since": led["since"],
              "reg": {"ym": int(last["per"]), "id": last["id"], "d": led["seen"][last["id"]][0], "kind": led["seen"][last["id"]][1]} if last else None,
              "feeds": meta,
              "note": "pull only: RSS / Atom readers and calendar apps fetch these files; fox sends no email and has no server"}
    files["data/alerts.json"] = json.dumps(alerts, ensure_ascii=False, separators=(",", ":"))
    # the slim feed behind a fund's news line (web/src/lib/news.ts): fee changes and company-level events of the last NEWS_DAYS days
    # before the build, first row only, the documents they cite, and their received dates. Loaded by a saver's card instead of feed.json.
    cut = (dt.date.fromisoformat(F["built"]) - dt.timedelta(days=NEWS_DAYS)).isoformat()
    nev = []
    for e in F["events"]:
        got = led["seen"][e["id"]]
        if e["t"] not in NEWS_TYPES or max(e["d"], got[0] if got[1] == "r" else e["d"]) < cut:
            continue
        nev.append({**{k: v for k, v in e.items() if k not in ("rows", "refs")}, "rows": (e.get("rows") or [])[:1]})
    rids = {str(e["src"]["rid"]) for e in nev if e["src"].get("k") == "doc"}
    news = {"v": 1, "built": F["built"], "files": F["files"], "cos": F["cos"], "days": NEWS_DAYS,
            "docs": {r: d for r, d in F["docs"].items() if r in rids}, "events": nev,
            "seen": {e["id"]: led["seen"][e["id"]] for e in nev}}
    files["data/news.json"] = json.dumps(news, ensure_ascii=False, separators=(",", ":"))
    pub_led = {"v": 1, "since": led["since"], "seen": {k: v for k, v in led["seen"].items() if any(e["id"] == k for e in F["events"])}}
    files["data/feed_seen.json"] = json.dumps(pub_led, ensure_ascii=False, separators=(",", ":"))
    return files, led, n_new


def ledger_text(led):
    """one event per line, so a diff of the ledger is one line per new event"""
    head = {k: v for k, v in led.items() if k != "seen"}
    rows = ",\n".join(f"{json.dumps(k, ensure_ascii=False)}:{json.dumps(v)}" for k, v in led["seen"].items())
    return json.dumps(head, ensure_ascii=False)[:-1] + ',"seen":{\n' + rows + "\n}}\n"


def load_inputs():
    F = json.loads((DATA / "feed.json").read_text(encoding="utf-8"))
    ledger = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else None
    return F, ledger


def check():
    """problems: [str]. The published feeds equal a rebuild from feed.json + the ledger, every event has its received date, every file
    is well-formed XML with the elements a reader needs, and no ledger date is later than the build."""
    import xml.etree.ElementTree as ET
    probs = []
    F, ledger = load_inputs()
    if ledger is None:
        return ["data/ledger/feed_seen.json missing: run pipeline/build_rss.py"]
    files, led, n_new = build(F, ledger)
    if n_new:
        probs.append(f"{n_new} feed event(s) without a received date in the ledger: run pipeline/build_rss.py")
    for rel, text in files.items():
        p = PUB / rel
        if not p.exists():
            probs.append(f"{rel}: missing")
            continue
        if p.read_text(encoding="utf-8") != text and not n_new:
            probs.append(f"{rel}: differs from a rebuild (run pipeline/build_rss.py)")
        if rel.endswith((".xml", ".atom")):
            probs += [f"{rel}: {x}" for x in validate(p.read_bytes(), rel.endswith(".atom"), ET)]
    stale = [k for k, v in led["seen"].items() if v[0] > F["built"] or v[1] not in ("r", "b")]
    if stale:
        probs.append(f"{len(stale)} ledger date(s) after the feed's build day, e.g. {stale[0]}")
    return probs


def validate(raw, is_atom, ET=None):
    """the elements a reader needs, on a parsed document; [] when it is well-formed and complete"""
    if ET is None:
        import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as x:
        return [f"not well-formed XML: {x}"]
    bad = []
    if is_atom:
        A = "{http://www.w3.org/2005/Atom}"
        if root.tag != A + "feed":
            return ["root is not an Atom <feed>"]
        for t in ("title", "id", "updated", "author"):
            if root.find(A + t) is None:
                bad.append(f"feed without <{t}>")
        ids = set()
        for i, en in enumerate(root.findall(A + "entry")):
            for t in ("title", "id", "updated", "link", "content"):
                if en.find(A + t) is None:
                    bad.append(f"entry {i} without <{t}>")
            k = en.findtext(A + "id")
            if k in ids:
                bad.append(f"entry id {k} twice")
            ids.add(k)
        return bad
    if root.tag != "rss" or root.get("version") != "2.0":
        return ["root is not <rss version=\"2.0\">"]
    ch = root.find("channel")
    if ch is None:
        return ["no <channel>"]
    for t in ("title", "link", "description"):
        if not (ch.findtext(t) or "").strip():
            bad.append(f"channel without <{t}>")
    guids = set()
    for i, it in enumerate(ch.findall("item")):
        for t in ("title", "link", "guid", "pubDate", "description"):
            if not (it.findtext(t) or "").strip():
                bad.append(f"item {i} without <{t}>")
        g = it.findtext("guid")
        if g in guids:
            bad.append(f"guid {g} twice")
        guids.add(g)
        if not (it.findtext("link") or "").startswith(SITE + "/"):
            bad.append(f"item {i}: link not on {SITE}")
        try:
            dt.datetime.strptime(it.findtext("pubDate") or "", "%a, %d %b %Y %H:%M:%S %z")
        except ValueError:
            bad.append(f"item {i}: pubDate not RFC 822")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        probs = check()
        for p in probs[:20]:
            print("FAIL", p)
        print("rss: ok" if not probs else f"rss: {len(probs)} problem(s)")
        sys.exit(1 if probs else 0)
    F, ledger = load_inputs()
    files, led, n_new = build(F, ledger)
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(ledger_text(led), encoding="utf-8")
    keep = set(files)
    for old in list((PUB / "feed").glob("*.xml")) + list((PUB / "feed").glob("*.atom")):
        if str(old.relative_to(PUB)) not in keep:
            old.unlink()
    for rel, text in files.items():
        p = PUB / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    print(f"{sum(r.endswith('.xml') for r in files)} RSS + {sum(r.endswith('.atom') for r in files)} Atom feeds; {len(led['seen'])} events in the ledger, {n_new} new")


if __name__ == "__main__":
    main()
