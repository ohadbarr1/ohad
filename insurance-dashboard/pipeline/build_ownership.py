"""Who owns whom: data/raw/maya_holders/ (pipeline/fetch_holders.py) -> web/public/data/ownership/<id>.json + ownership/index.json.

  python3 pipeline/build_ownership.py        # no network

Per listed company: today's holders from MAYA (holder, type, channel, % capital and vote, balance date, remark), the split interested /
institutional / public, the mutual funds and ETFs holding the share by manager, and the quarterly holdings reports (form ת077) as a history:
each holder's % capital per quarter end, the controlling holders' total, the public float, QoQ changes, each point with its report id and URL.
index.json: one row per company and the cross-holdings matrix of the 17 groups (which group's insurers, provident funds and mutual funds hold
shares of which other group), every cell with its parts, date and source.

Rules (no figure is invented):
- A holder is put in one of the 17 groups only by its name (GROUP_RX below); everything else keeps its own name.
- A matrix cell is the interested-party list when the holder group is an interested party of the company (all its channels, MAYA's date per
  line); otherwise the mutual funds and ETFs of that group's fund managers holding the share (latest monthly report): marked "funds only",
  because provident, pension and insurance holdings below the 5% threshold are not disclosed per company.
- % of capital from fund holdings = units held / issued and paid-up capital of the security (MAYA details), marked derived.
- "ציבור" in the history = 100 − the form's own total of interested parties' holdings (section A, % capital).
"""
from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = Path(os.environ.get("FOX_HOLDERS_RAW") or ROOT / "data" / "raw" / "maya_holders")
REGISTRY = ROOT / "data" / "registry" / "companies.json"
OUT = ROOT / "web" / "public" / "data" / "ownership"
MAYA_CO = "https://maya.tase.co.il/he/companies/{}"
MAYA_REPORT = "https://maya.tase.co.il/he/reports/{}"
MAYA_FUNDS = "https://maya.tase.co.il/he/funds/mutual-funds/assets/{}"

DISCLAIMER_IP = ("יתכנו הבדלים בין הנתונים המתפרסמים על ידי הבורסה לבין הנתונים המתפרסמים על ידי החברה, הנובעים בעיקר מתדירות שונה של עדכון "
                 "הנתונים. החל מיום 1.2.2026 מוצגות החזקות בעלי עניין במניות ובניירות ערך המירים למניות בלבד, ללא תעודות התחייבות שאינן ניתנות "
                 "להמרה. מידע על החזקות בעלי עניין בתעודות התחייבות שאינן ניתנות להמרה ניתן למצוא בדיווחי החברות")
DISCLAIMER_FUNDS = ("הבורסה אינה מתחייבת לכך שהנתונים יהיו עדכניים תמיד, וכן היא אינה אחראית לליקוי, טעות, שגיאה או אי דיוק שנפלו בנתונים המוצגים. "
                    "הנתונים לוקטו על ידי הבורסה מתוך הדוחות החודשיים המוגשים על ידי מנהלי הקרנות, על פי דין. הנתונים כאמור לא נבדקו ולא בוקרו על "
                    "ידי הבורסה והם מוצגים כפי שהם פורסמו על ידי מנהלי הקרנות.")
TERMS = "https://www.tase.co.il/he/content/about/terms_of_service"

# holder name -> one of the 17 groups. Anchored at the start of the name: "מנור נורית" is not Menora, "המבורגר" is not Harel.
GROUP_RX: list[tuple[str, str]] = [
    ("phoenix", r"^(ה)?פניקס|^אקסלנס"),
    ("harel", r"^הראל"),
    ("migdal", r"^מגדל"),
    ("clal", r"^כלל(\b|[- ])"),
    ("menora", r"^מנורה"),
    ("hachshara", r"^הכשרה"),
    ("ayalon", r"^איילון"),
    ("idi", r"^ביטוח ישיר|^ישיר "),
    ("meitav", r"^מיטב"),
    ("altshuler", r"^אלטשולר"),
    ("more_gemel", r"^מור (גמל|קופות|פנסיה)"),
    ("more", r"^מור([- ]|$)"),
    ("analyst", r"^אנליסט"),
    ("yelin", r"^ילין"),
    ("infinity", r"^אינפיניטי"),
    ("globalnet", r"^גלובלנט"),
    ("ibi", r"^אי\.? ?בי\.? ?אי|^ibi\b"),
]
# how a group holds: from MAYA's short names ("הפניקס-ק.גמל") and the form's holder types
CHANNEL_RX: list[tuple[str, str]] = [
    ("nostro", r"נוסטרו"),
    ("participating", r"משתתפ"),
    ("mm", r"ע\.?\s?שוק|עושה שוק"),
    ("pension", r"פנסי"),
    ("gemel", r"ק\.?\s?גמל|קופות גמל|גמל"),
    ("mutual", r"ק\.?\s?נאמ|קרנות נאמנות|להשקעות משותפות|\(קרנות\)"),
    ("etf", r"קרנות סל|\bסל\b|etf"),
]
CHANNEL_HE = {"nostro": "נוסטרו", "participating": "משתתפות ברווחים", "mm": "עושה שוק", "pension": "פנסיה", "gemel": "גמל", "mutual": "קרנות נאמנות",
              "etf": "קרנות סל", "funds": "קרנות נאמנות וסל", "other": "אחר"}


def norm(s: str) -> str:
    s = (s or "").replace("״", '"').replace("׳", "'").replace("–", "-")
    return re.sub(r"\s+", " ", s).strip()


def group_of(name: str) -> str | None:
    n = norm(name).lower()
    for gid, rx in GROUP_RX:
        if re.search(rx, n):
            return gid
    return None


def channel_of(*texts: str) -> str:
    t = " ".join(norm(x).lower() for x in texts if x)
    for ch, rx in CHANNEL_RX:
        if re.search(rx, t):
            return ch
    return "other"


def slug(s: str) -> str:
    return re.sub(r"[^\w]", "", norm(s))[:24]


def read(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def qkey(asof: str) -> str | None:
    """'30/09/2026' -> '2026Q3' (quarter ends only; a form as of another day is kept on the quarter it falls in)."""
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", asof or "")
    if not m:
        return None
    mo, y = int(m.group(2)), int(m.group(3))
    return f"{y}Q{(mo - 1) // 3 + 1}"


def iso(asof: str) -> str | None:
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", asof or "")
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


def r2(v):
    return None if v is None else round(float(v), 2)


def form_type(t: str, holder: str, entity: str, controllers: list[str]) -> str:
    """controlling / interested / institutional / officer / treasury, from the type the filer chose and the controlling-holders list."""
    t = t or ""
    if "התאגיד המדווח" in t or "בשליטת התאגיד" in t:
        return "treasury"
    key = re.sub(r"[^\w]", "", norm(holder))[:10]
    if key and any(key in re.sub(r"[^\w]", "", norm(c)) for c in controllers):
        return "controlling"
    if "שליטה" in t:
        return "controlling"
    if re.search(r"קופות גמל|קרנות|נוסטרו|משתתף|עושה שוק|פנסי|ביטוח|מוסדי|בנק|חיתום", t):
        return "institutional"
    if "נושא משרה" in t or "דירקטור" in t or 'מנכ"ל' in t:
        return "officer"
    return "interested"


def build_company(c: dict) -> dict | None:
    mid = c["maya_id"]
    det, ip, dist = (read(RAW / f"{k}_{mid}.json") for k in ("details", "ip", "dist"))
    if not det:
        return None
    d = det["data"]
    sec = d.get("mainSecurityId")
    main = next((s for s in d.get("secrities") or [] if s.get("securityId") == sec), None)
    issued = (main or {}).get("issuedPaidUp")
    listed = bool(main) and not d.get("isNonListed")
    out: dict = {
        "id": c["id"], "name": c["name_he"], "entity": norm(d.get("longName") or d.get("name") or ""), "maya_id": mid, "security": sec,
        "parent_note": {"yelin": "אטראו שוקי הון, המחזיקה 50% בילין לפידות"}.get(c["id"]), "listed": listed,
        "maya_url": MAYA_CO.format(mid), "indices": d.get("indices") or [],
        "retrieved": det["retrieved"],
    }

    # ---- today: interested parties (MAYA) + split
    dd = (dist or {}).get("data") or {}
    inst_names = {norm(x["key"]) for x in dd.get("institutional") or []}
    ctrl_total = next((x["value"] for x in dd.get("controllersInterest") or [] if "סך בעלי שליטה" in x["key"]), None)
    split = {norm(x["key"]): x["value"] for x in dd.get("general") or []}
    out["split"] = {
        "interested": split.get("החזקות בעלי עניין"), "institutional": split.get("החזקות מוסדיים וקרנות גידור"), "public": split.get("החזקות ציבור"),
        "controlling": ctrl_total, "asof": dd.get("interestedPartiesValidationDate"), "controlling_asof": dd.get("controllerHolderValidationDate"),
        "src": f"https://maya.tase.co.il/api/v1/interested-parties/distribution/by_company?companyId={mid}",
    }
    holders = []
    for x in ((ip or {}).get("data") or {}).get("interestedParties") or []:
        name = norm(x.get("interestedPartyName"))
        is_main = x.get("securityId") == sec
        g = group_of(name)
        holders.append({
            "name": name, "group": g if g != c["id"] else g, "self": g == c["id"],
            "type": "institutional" if name in inst_names else "interested",
            "channel": channel_of(name, x.get("remark") or "") if (name in inst_names or g) else None,
            "security": norm(x.get("securityName")), "main": is_main, "balance": x.get("balance"),
            "cap": r2(x.get("capital")), "vote": r2(x.get("voting")), "date": (x.get("balanceDate") or "")[:10] or None,
            "remark": norm(x.get("remark")) or None,
        })
    # the controlling holders: names on the latest holdings form first, then the largest non-institutional holders up to MAYA's controlling total
    forms = sorted((p for p in (read(f) for f in (RAW / "t077").glob("*.json")) if p and p.get("maya_id") == mid),
                   key=lambda p: (iso(p.get("asof")) or "", p.get("published") or ""))
    last_form = forms[-1] if forms else None
    ctrl_keys = [re.sub(r"[^\w]", "", norm(x))[:8] for x in (last_form or {}).get("controllers", [])]
    if ctrl_total:
        acc = 0.0
        for h in holders:
            k = re.sub(r"[^\w]", "", h["name"])[:8]
            if h["type"] == "interested" and h["main"] and k and any(k in ck or ck in k for ck in ctrl_keys if ck):
                h["type"] = "controlling"; acc += h["cap"] or 0
        for h in sorted((h for h in holders if h["type"] == "interested" and h["main"]), key=lambda h: -(h["cap"] or 0)):
            if acc + (h["cap"] or 0) <= ctrl_total + 0.1 and (h["cap"] or 0) > 0:
                h["type"] = "controlling"; acc += h["cap"] or 0
    for h in holders:
        if h["main"] and h["name"] and re.sub(r"[^\w]", "", h["name"])[:6] == re.sub(r"[^\w]", "", out["entity"])[:6] and not h["cap"]:
            h["type"] = "treasury"
    out["holders"] = holders
    out["holders_src"] = f"https://maya.tase.co.il/api/v1/interested-parties/by_company?companyId={mid}"

    # ---- mutual funds and ETFs holding the share, by manager
    fh = read(RAW / f"funds_{sec}.json") if sec else None
    mgrs = (read(RAW / "fund_managers.json") or {}).get("data", {})
    if fh and issued:
        by = defaultdict(lambda: {"qty": 0.0, "nis": 0.0, "n": 0})
        month = None
        for r in fh["data"]:
            mgr = norm(mgrs.get(str(r["fundId"])) or "") or None
            k = mgr or "?"
            by[k]["qty"] += r.get("quantity") or 0
            by[k]["nis"] += r.get("nisValue") or 0
            by[k]["n"] += 1
            month = max(month or "", (r.get("reportDate") or "")[:10])
        rows = [{"manager": k if k != "?" else None, "group": group_of(k) if k != "?" else None, "funds": v["n"],
                 "qty": round(v["qty"]), "pct": round(v["qty"] / issued * 100, 3), "nis_m": round(v["nis"] / 1e6, 1)} for k, v in by.items()]
        rows.sort(key=lambda r: -r["pct"])
        out["funds"] = {"month": month or None, "issued": issued, "n": len(fh["data"]), "total_pct": round(sum(r["pct"] for r in rows), 2),
                        "by_manager": rows, "src": MAYA_FUNDS.format(sec), "api": fh["url"], "retrieved": fh["retrieved"],
                        "unmapped": sum(1 for r in fh["data"] if str(r["fundId"]) not in mgrs)}
    else:
        out["funds"] = None

    # ---- history: the quarterly holdings forms
    byq: dict[str, dict] = {}
    for p in forms:
        q = qkey(p.get("asof"))
        if q and (q not in byq or (p.get("published") or "") >= (byq[q].get("published") or "")):
            byq[q] = p  # a corrected form for the same quarter replaces the first
    quarters = sorted(byq)
    reports = []
    series: dict[str, dict] = {}
    for qi, q in enumerate(quarters):
        p = byq[q]
        types = [form_type(dt.get("type"), dt.get("name"), p.get("entity", ""), p.get("controllers") or []) for dt in p.get("details") or []]
        dmap = {}
        for dt, ty in zip(p.get("details") or [], types):
            dmap.setdefault(norm(dt["name"]), (ty, dt.get("type")))
        tot = (p.get("total_a") or {}).get("cap")
        sum_a = sum((r.get("cap") or 0) for r in p["rows"] if r["sec"] == "a")
        reports.append({"q": q, "asof": iso(p.get("asof")), "rid": p["report_id"], "url": p["url"], "file": p.get("file"), "published": p.get("published"),
                        "controlling": r2(p.get("controllers_total")), "total": r2(tot if tot is not None else sum_a),
                        "public": r2(100 - (tot if tot is not None else sum_a))})
        for r in p["rows"]:
            if r["sec"] != "a" or not r.get("cap"):
                continue
            ty, raw_t = dmap.get(norm(r["name"]), ("interested", ""))
            if ty == "treasury":
                continue
            g = group_of(r["name"])
            # the controlling holders are one block (the family, the partnership and its partners); a group of the 17 keeps its own key
            key = f"g:{g}" if g and g != c["id"] else "ctl" if ty == "controlling" else "n:" + slug(r["name"])
            s = series.setdefault(key, {"key": key, "name": None, "group": g if g != c["id"] else None, "self": g == c["id"], "type": ty, "parts": {}, "pts": [None] * len(quarters)})
            s["pts"][qi] = r2((s["pts"][qi] or 0) + r["cap"])
            s["parts"].setdefault(qi, []).append({"name": norm(r["name"]), "cap": r2(r["cap"]), "vote": r2(r["vote"]), "type": raw_t, "channel": channel_of(r["name"], raw_t)})
            if ty == "controlling":
                s["type"] = "controlling"
            if key == "ctl":
                s["name"] = "בעלי השליטה"
            elif s["name"] is None or not g:
                s["name"] = norm(r["name"])
    for s in series.values():
        if s["group"]:
            s["name"] = None  # the page names a group by its registry name
        s["parts"] = {quarters[i]: v for i, v in s["parts"].items()}
        last = next((v for v in reversed(s["pts"]) if v is not None), None)
        s["last"] = last
    ordered = sorted(series.values(), key=lambda s: (-(s["pts"][-1] or 0), -max((v or 0) for v in s["pts"])))
    # QoQ: the last two quarters
    changes = []
    if len(quarters) >= 2:
        for s in ordered:
            a, b = s["pts"][-2], s["pts"][-1]
            if (a or 0) == (b or 0):
                continue
            changes.append({"key": s["key"], "name": s["name"], "group": s["group"], "from": a, "to": b, "d": r2((b or 0) - (a or 0))})
        changes.sort(key=lambda x: -abs(x["d"] or 0))
    out["history"] = {"quarters": quarters, "reports": reports, "series": ordered, "changes": changes,
                      "form": "ת077 · דוח מיידי על מצבת החזקות בעלי עניין ונושאי משרה בכירה"}
    return out


def main() -> None:
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    names = {c["id"]: c["name_he"] for c in reg}
    OUT.mkdir(parents=True, exist_ok=True)
    cos = []
    for c in reg:
        if not c.get("maya_id"):
            continue
        o = build_company(c)
        if not o or not (o["holders"] or o["history"]["quarters"] or o["funds"]):
            continue
        (OUT / f"{c['id']}.json").write_text(json.dumps(o, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        cos.append(o)

    # ---- cross-holdings matrix: holder group (row) x held company (column)
    cells = []
    for o in cos:
        ip_groups: dict[str, list] = defaultdict(list)
        for h in o["holders"]:
            if h["group"] and h["main"] and h["type"] in ("institutional", "interested", "controlling"):
                ip_groups[h["group"]].append(h)
        for g, hs in ip_groups.items():
            cells.append({"h": g, "c": o["id"], "pct": r2(sum(h["cap"] or 0 for h in hs)), "basis": "ip", "self": g == o["id"],
                          "date": max((h["date"] or "") for h in hs) or None, "src": MAYA_CO.format(o["maya_id"]),
                          "parts": [{"name": h["name"], "channel": h["channel"], "cap": h["cap"], "date": h["date"]} for h in sorted(hs, key=lambda h: -(h["cap"] or 0))]})
        f = o.get("funds")
        if f:
            fg: dict[str, list] = defaultdict(list)
            for r in f["by_manager"]:
                if r["group"] and r["group"] not in ip_groups:
                    fg[r["group"]].append(r)
            for g, rs in fg.items():
                cells.append({"h": g, "c": o["id"], "pct": round(sum(r["pct"] for r in rs), 3), "basis": "funds", "self": g == o["id"],
                              "date": f["month"], "src": f["src"],
                              "parts": [{"name": r["manager"], "channel": "funds", "cap": r["pct"], "funds": r["funds"], "nis_m": r["nis_m"]} for r in rs]})
    held = [o["id"] for o in cos if o["listed"]]
    holders = sorted({x["h"] for x in cells}, key=lambda g: [c["id"] for c in reg].index(g) if g in names else 99)
    index = {
        "built": date.today().isoformat(),
        "source": "MAYA, אתר הדיווחים של הבורסה לניירות ערך בתל אביב: בעלי עניין, התפלגות החזקות, דוחות מצבת החזקות (ת077), החזקות קרנות נאמנות וסל",
        "disclaimers": {"ip": DISCLAIMER_IP, "funds": DISCLAIMER_FUNDS, "terms": TERMS},
        "names": {k: names[k] for k in names},
        "companies": [{
            "id": o["id"], "entity": o["entity"], "listed": o["listed"], "asof": o["split"]["asof"], "parent_note": o["parent_note"],
            "controlling": o["split"]["controlling"], "institutional": o["split"]["institutional"], "public": o["split"]["public"], "interested": o["split"]["interested"],
            "top": next(({"name": h["name"], "cap": h["cap"], "type": h["type"]} for h in sorted(o["holders"], key=lambda h: -(h["cap"] or 0)) if h["main"]), None),
            "funds_pct": (o["funds"] or {}).get("total_pct"), "funds_month": (o["funds"] or {}).get("month"),
            "quarters": len(o["history"]["quarters"]), "last_q": (o["history"]["quarters"] or [None])[-1],
        } for o in cos],
        "matrix": {"rows": holders, "cols": held, "cells": cells},
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"ownership: {len(cos)} companies, {len(cells)} matrix cells, {sum(len(o['history']['quarters']) for o in cos)} company-quarters")


if __name__ == "__main__":
    main()
