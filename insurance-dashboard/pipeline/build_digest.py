"""The weekly digest of the delta feed: the last 7 days of web/public/data/feed.json as a self-contained Hebrew RTL email body.

python3 pipeline/build_digest.py [--asof YYYY-MM-DD] [--days 7] [--out DIR]
    writes DIR/digest.html (inline styles only, tables for layout: what mail clients render) and DIR/digest.txt (the plain-text part);
    DIR defaults to data/digest/ (untracked). Standard library only; reads feed.json only.

Nothing is sent from here: no sender, no address list, no service. Every figure carries its source the way the feed does: a page of a
MAYA filing (linked to the PDF at that page), the regulator's month (data.gov.il), a track's month, or the formula over its inputs.
"""
import argparse
import datetime as dt
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "web" / "public" / "data" / "feed.json"
SITE = "https://fox-research-il.web.app"
MINUS = "−"
UNIT = {"m": "מ׳ ש״ח", "bn": "מיליארד ש״ח", "pct": "%", "pp": "נק׳", "dm": "מ׳ ש״ח", "dbn": "מיליארד ש״ח", "dpct": "%", "n": ""}
DS_HE = {"gemel": "גמל-נט", "pensia": "פנסיה-נט", "insurance": "ביטוח-נט"}
DK_HE = {"pub": "פרסום", "fetched": "התקבל", "month": "חודש נתונים"}
DOC_HE = {"annual": "דוח שנתי", "quarterly": "דוח רבעוני", "presentation": "מצגת", "solvency": "דוח כושר פירעון"}
C = {"fg": "#1d2430", "muted": "#5d6675", "line": "#e3e6eb", "head": "#f4f5f7", "pos": "#1f7a4a", "neg": "#b3261e", "accent": "#b4541a"}


def nf(v, d):
    t = f"{v:,.{d}f}"
    if set(t.lstrip("-")) <= set("0.,"):
        return t.lstrip("-")
    return t.replace("-", MINUS)


def fmt(f):
    v, u = f["v"], f["u"]
    if u in ("pct",):
        return nf(v, 2 if abs(v) < 5 else 1) + "%"
    if u == "dpct":
        return ("+" if round(v, 1) > 0 else "") + nf(v, 1) + "%"
    if u == "pp":
        return ("+" if round(v, 2) > 0 else "") + nf(v, 2) + " נק׳"
    if u in ("bn", "dbn"):
        s = nf(v, 2 if abs(v) < 100 else 1)
        return ("+" + s if u == "dbn" and round(v, 2) > 0 else s)
    if u in ("m", "dm"):
        s = nf(v, 1 if abs(v) < 1000 else 0)
        return ("+" + s if u == "dm" and round(v, 1) > 0 else s)
    return nf(v, 0)


def date_he(d):
    return f"{d[8:10]}.{d[5:7]}.{d[2:4]}"


def ym_he(ym):
    return f"{ym % 100:02d}/{str(ym // 100)[2:]}"


def src_of(F, s):
    """(text, href) of a figure's source"""
    k = s["k"]
    if k == "pg":
        d = F["docs"].get(str(s["rid"]))
        name = f"{F['cos'].get(d[0], d[0])}, {DOC_HE.get(d[1], 'דוח')} {per_he(d[2])}" if d and d[1] else f"דוח {s['rid']}"
        href = (F["files"] + d[4] + (f"#page={s['pg']}" if s.get("pg") else "")) if d else None
        return f"{name}, עמ׳ {s['pg']}" + (" (נגזר: FY פחות 9M)" if s.get("der") == 1 else " (נגזר מרכיבים מודפסים)" if s.get("der") == 2 else ""), href
    if k == "reg":
        return f"רשות שוק ההון, {ym_he(s['ym'])}", None
    if k == "fund":
        return f"{DS_HE.get(s['ds'], s['ds'])}, קופה {s['id']}, {ym_he(s['ym'])}", None
    if k == "calc":
        return s["fx"], None
    return s.get("fx", ""), None


def per_he(p):
    if not p:
        return ""
    return f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}" if len(p) == 6 else p


def tone(f):
    if f["u"] not in ("dm", "dbn", "dpct", "pp"):
        return C["fg"]
    return C["pos"] if f["v"] > 0 else C["neg"] if f["v"] < 0 else C["fg"]


def esc(s):
    return html.escape(s or "", quote=True)


def cell_fig(F, f):
    text, href = src_of(F, f["s"])
    num = f'<span dir="ltr" style="unicode-bidi:isolate;font-variant-numeric:tabular-nums;color:{tone(f)}">{esc(fmt(f))}</span>'
    inner = num
    if href:
        return f'<a href="{esc(href)}" title="{esc(text)}" style="color:{C["fg"]};text-decoration:none;border-bottom:1px dotted {C["muted"]}">{inner}</a>'
    return f'<span title="{esc(text)}">{inner}</span>'


def render(F, asof, days):
    start = (asof - dt.timedelta(days=days - 1)).isoformat()
    end = asof.isoformat()
    ev = [e for e in F["events"] if start <= e["d"] <= end]
    types = F["types"]
    th = f'style="text-align:right;font-weight:600;color:{C["muted"]};font-size:12px;padding:4px 8px;border-bottom:1px solid {C["line"]}"'
    td = f'style="text-align:right;font-size:13px;padding:4px 8px;border-bottom:1px solid {C["line"]};vertical-align:top"'
    out = [f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f'<title>fox · מה השתנה · {date_he(start)} עד {date_he(end)}</title></head>'
           f'<body style="margin:0;padding:0;background:#ffffff;direction:rtl">'
           f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="direction:rtl;font-family:Heebo,Arial,Helvetica,sans-serif;color:{C["fg"]}">'
           f'<tr><td align="center" style="padding:16px">'
           f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;direction:rtl">'
           f'<tr><td style="padding:0 0 8px 0;border-bottom:2px solid {C["accent"]}">'
           f'<div style="font-size:20px;font-weight:700">fox · מה השתנה</div>'
           f'<div style="font-size:13px;color:{C["muted"]}">{date_he(start)} עד {date_he(end)} · <span dir="ltr">{len(ev)}</span> שינויים · '
           f'ביטוח, פנסיה וגמל · כל מספר מקושר למקור</div></td></tr>']
    txt = [f"fox · מה השתנה · {date_he(start)} עד {date_he(end)} · {len(ev)} שינויים", ""]
    if not ev:
        last = F["events"][0]["d"] if F["events"] else None
        out.append(f'<tr><td style="padding:16px 0;font-size:14px">אין שינויים בטווח.'
                   + (f' השינוי האחרון בפיד: {date_he(last)}.' if last else "") + "</td></tr>")
        txt.append("אין שינויים בטווח." + (f" השינוי האחרון בפיד: {date_he(last)}." if last else ""))
    for t in types:
        xs = [e for e in ev if e["t"] == t]
        if not xs:
            continue
        out.append(f'<tr><td style="padding:14px 0 4px 0;font-size:15px;font-weight:700">{esc(types[t]["he"])} '
                   f'<span style="color:{C["muted"]};font-weight:400">· <span dir="ltr">{len(xs)}</span></span></td></tr>')
        txt.append(f"== {types[t]['he']} · {len(xs)}")
        for e in xs:
            co = F["cos"].get(e["c"], e["c"])
            link = SITE + e["to"]
            out.append(f'<tr><td style="padding:6px 0 2px 0;font-size:13px">'
                       f'<span style="color:{C["muted"]}">{date_he(e["d"])} · {esc(DK_HE[e["dk"]])}</span> · '
                       f'<b>{esc(co)}</b> · <a href="{esc(link)}" style="color:{C["accent"]}">{esc(e["h"])}</a></td></tr>')
            txt.append(f"{date_he(e['d'])} · {co} · {e['h']} · {link}")
            rows = e.get("rows") or []
            if rows:
                out.append(f'<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="direction:rtl;border-collapse:collapse">')
                out.append(f'<tr><th {th}>שורה</th><th {th}>נוכחי</th><th {th}>השוואה</th><th {th}>שינוי</th></tr>')
                for r in rows:
                    ab = r.get("ab") or []
                    a = cell_fig(F, r["a"]) + (f' <span style="color:{C["muted"]};font-size:11px">{esc(ab[0])}</span>' if ab else "")
                    b = (cell_fig(F, r["b"]) + (f' <span style="color:{C["muted"]};font-size:11px">{esc(ab[1])}</span>' if len(ab) > 1 else "")) if r.get("b") else ""
                    if r.get("rng"):
                        a, b = cell_fig(F, r["a"]) + " עד " + cell_fig(F, r["b"]), ""
                    dd = " ".join(cell_fig(F, r[k]) for k in ("d", "dp") if r.get(k))
                    note = f'<div style="color:{C["muted"]};font-size:11px">{esc(r["note"])}</div>' if r.get("note") else ""
                    unit = UNIT.get(r["a"]["u"], "") if r["a"]["u"] in ("m", "bn") else ""
                    note = (f' <span style="color:{C["muted"]};font-size:11px">{esc(unit)}</span>' if unit else "") + note
                    out.append(f'<tr><td {td}>{esc(r["l"])}{note}</td><td {td}>{a}</td><td {td}>{b}</td><td {td}>{dd}</td></tr>')
                    parts = [fmt(r["a"])] + ([fmt(r["b"])] if r.get("b") else []) + [fmt(r[k]) for k in ("d", "dp") if r.get(k)]
                    srcs = "; ".join(x for x in (src_of(F, r["a"]["s"])[0], src_of(F, r["b"]["s"])[0] if r.get("b") else "") if x)
                    txt.append(f"  {r['l']}: {' | '.join(parts)}  [{srcs}]")
                out.append("</table></td></tr>")
        txt.append("")
    out.append(f'<tr><td style="padding:16px 0 0 0;font-size:11px;color:{C["muted"]};border-top:1px solid {C["line"]}">'
               f'מקור: {esc(F["source"])} · תאריך: {esc(DK_HE["pub"])} = יום הפרסום במאיה; {esc(DK_HE["fetched"])} = היום שבו fox קיבלה את קובץ הרשות; '
               f'{esc(DK_HE["month"])} = סוף חודש הנתונים (יום הפרסום של הרשות אינו נשמר) · הנתונים הם ההדפסה העדכנית של כל מספר, עם עמוד המקור · '
               f'<a href="{SITE}/feed" style="color:{C["accent"]}">הפיד המלא</a></td></tr>'
               "</table></td></tr></table></body></html>")
    txt.append(f"מקור: {F['source']} · הפיד המלא: {SITE}/feed")
    return "".join(out), "\n".join(txt) + "\n", len(ev), start, end


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asof", help="last day of the window (default: today)")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--out", default=str(ROOT / "data" / "digest"))
    a = ap.parse_args()
    asof = dt.date.fromisoformat(a.asof) if a.asof else dt.date.today()
    F = json.loads(FEED.read_text(encoding="utf-8"))
    body, text, n, start, end = render(F, asof, a.days)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "digest.html").write_text(body, encoding="utf-8")
    (out / "digest.txt").write_text(text, encoding="utf-8")
    print(f"digest: {n} events {start} .. {end} -> {out / 'digest.html'} ({len(body.encode()) // 1024} KB), digest.txt")


if __name__ == "__main__":
    main()
