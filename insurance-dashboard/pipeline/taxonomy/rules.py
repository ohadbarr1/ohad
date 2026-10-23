"""Line taxonomy rules: how a printed line becomes a stable line id.

A line id names one economic line across companies and across the wording a company uses from report to report:

  core     curated here (CORE): a readable id ("pl.pbt", "bs.total_assets", "cf.cfo") matched by a pattern over the caption. The 29 roles
           of build_workbook.py (the cross-company lines of lines.json) are all core lines, under the same key.
  shared   not curated, but the same line printed by two or more companies: the companies' captions meet on one normalised caption
           (words sorted, bracketed alternatives, note marks, digits and spelling variants dropped) within the same statement and block.
           Id = "<statement>.<block>.<6 hex>" of the first normalised caption the line was registered under (kept in registry.json, so the
           id does not move when a later wording joins).
  own      a line only one company prints, or a caption that company prints twice in one block ("סך הכל", "אחרות"): it has an id, stable
           within the company, but no cross-company identity. This is the unmapped tail the coverage report lists.

Blocks keep apart the same caption in different places of one statement: the cash-flow statement prints "רכוש קבוע" as a depreciation
adjustment and as an investment; the balance sheet prints "אחרות" among assets and among liabilities.

The normaliser below is a frozen copy of build_workbook.py's `norm` (v1). It is deliberately not imported: an id must not move because a
builder's matching was tuned. Changing it is a taxonomy version change (registry.json `v`).
"""
import hashlib
import re

STMT_OF_SHEET = {"X.רווח_והפסד": "pl", "X.רווח_כולל": "oci", "X.מאזן": "bs", "X.תזרים_מזומנים": "cf"}
# the Phoenix workbook (from the company's own spreadsheet) prints the same primary statements for the parent (F) and the insurer (I)
SHEET_STMT_RE = [(re.compile(r"^[FI]\.D1_"), "bs"), (re.compile(r"^[FI]\.D2_"), "pl"), (re.compile(r"^[FI]\.D3_"), "oci"), (re.compile(r"^[FI]\.D5_"), "cf"),
                 (re.compile(r"^I\.A_סולו_מצב_כספי"), "bs"), (re.compile(r"^I\.A_סולו_רווח_והפסד"), "pl"), (re.compile(r"^I\.A_סולו_רווח_כולל"), "oci")]
STMT_HE = {"pl": "רווח והפסד", "oci": "רווח כולל", "bs": "מאזן", "cf": "תזרים מזומנים", "n": "ביאורים ומגזרים", "px": "גיליון החברה"}
BLOCK_HE = {"pl": "", "eps": "רווח למניה", "oci": "", "a": "נכסים", "le": "התחייבויות והון", "op": "פעילות שוטפת", "adj": "התאמות",
            "wc": "שינויים בסעיפי מאזן", "inv": "פעילות השקעה", "fin": "פעילות מימון", "cash": "יתרות מזומנים", "app": "נספחים", "x": ""}


def tnorm(t):
    """Normalised caption, frozen v1 (= build_workbook.norm of 23.10.26)."""
    t = re.sub(r"^\d+\S*\s+", "", (t or "").strip())
    t = re.sub(r"\)([^()]*)\(", r"(\1)", t)
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"[\"'״׳*().,:;\-–\d]", " ", t)
    t = re.sub(r"סה\s*כ|סך\s+ה?כו?ל", "סך", t)
    for a, b in (("הכול", "הכל"), ("עלייה", "עליה"), ("מיסים", "מסים"), ("פיננסיים", "פיננסים"), ("לשנה", "לתקופה"), ("השנה", "התקופה"), ("למניה", ""), ("בשח", "")):
        t = t.replace(a, b)
    key = " ".join(sorted(w.lstrip("ה") for w in t.split() if len(w.lstrip("ה")) > 1 and w not in ("של", "ש", "ח", "בת", "בנות")))
    return {"רווח": "לתקופה רווח", "נקי רווח": "לתקופה רווח", "לתקופה נקי רווח": "לתקופה רווח", "בעלים חברה": "בעלי חברה מניות"}.get(key, key)


def caption(t):
    """The caption as the curated patterns read it: quotes dropped, "סך הכל" / סה"כ reduced to "סך", spaces collapsed (as lines.json roles)."""
    t = re.sub(r"[\"'״׳*]", "", t or "")
    t = re.sub(r"\)([^()]*)\(", r"(\1)", t)
    return re.sub(r"\s+", " ", re.sub(r"סה\s*כ|סך\s+ה?כו?ל", "סך", t)).strip()


def h6(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:6]


# ---------- blocks ----------
TOTAL_ASSETS = re.compile(r"^סך (כל )?ה?נכסים$")


def blocks(stmt, rows):
    """Block of every row of one statement block (rows in printed order: dicts with label, header, unit). Returns a list of block codes."""
    out, state = [], {"bs": "a", "cf": "op"}.get(stmt, stmt)
    for r in rows:
        lab = caption(r["label"])
        if stmt == "pl":
            out.append("eps" if r["unit"] in ("nis", "shares") else "pl")
            continue
        if stmt == "oci":
            out.append("oci")
            continue
        if stmt == "bs":
            if r["header"]:
                if re.search(r"התחייבויות|^הון|ההון", lab):
                    state = "le"
                elif re.search(r"נכסים", lab) and state == "a":
                    state = "a"
            out.append(state)
            if TOTAL_ASSETS.match(lab):
                state = "le"
            continue
        if stmt == "cf":
            if r["header"]:
                if re.search(r"נספח", lab) and re.search(r"פעילות שוטפת", lab):
                    state = "adj"  # the appendix that reconciles profit to the operating cash flow
                elif re.search(r"נספח|פעולות שלא במזומן|פעילות שאינה במזומן", lab):
                    state = "app"
                elif re.search(r"התאמות|שאינן כרוכות|אינם כרוכים", lab):
                    state = "adj"
                elif re.search(r"שינויים? ב(סעיפי|נכסים|התחייבויות)", lab):
                    state = "wc"
                elif re.search(r"פעילות(י)? השקעה", lab):
                    state = "inv"
                elif re.search(r"פעילות(י)? מימון", lab):
                    state = "fin"
                elif re.search(r"פעילות שוטפת", lab):
                    state = "op"
                out.append(state)
                continue
            if re.search(r"^יתרת מזומנים|^(עלי[יה]+|ירידה)( נטו)?( \((עלי[יה]+|ירידה)\))?( נטו)? במזומנים|^השפעת ה?(תנודות|שינויים) בשערי? ה?חליפין", lab) and state != "app":
                out.append("cash")
                continue
            out.append(state)
            if re.search(r"^מזומנים,? ?נטו.*(מ|ל)פעילות מימון", lab):
                state = "cash"
            elif re.search(r"^מזומנים,? ?נטו.*(מ|ל)פעילות השקעה", lab):
                state = "fin"
            elif re.search(r"^מזומנים,? ?נטו.*(מ|ל)פעילות שוטפת", lab):
                state = "inv"
            continue
        out.append("x")
    return out


# ---------- core lines ----------
# (id, statement, block or None (any), pattern over caption(), nature, Hebrew name). The first match within a statement wins.
# nature: inc (income / inflow, printed as a positive), exp (expense / outflow: the company prints it positive or negative, see `o`),
# res (a result or a total that can be either sign), bal (a balance), ps (per share, NIS), cnt (a count of shares)
P = r"( \(הפסד\))?"
CORE = [
    # profit and loss: the 29 roles of lines.json first, under their keys
    ("pl.ins_rev", "pl", None, r"^הכנסות משירותי ביטוח$", "inc", "הכנסות משירותי ביטוח"),
    ("pl.ins_exp", "pl", None, r"^הוצאות משירותי ביטוח$", "exp", "הוצאות משירותי ביטוח"),
    ("pl.ins_res_gross", "pl", None, r"^(רווח|תוצאות)" + P + r" משירותי ביטוח לפני (ביטוחי|ביטוח) משנה", "res", "רווח משירותי ביטוח לפני ביטוח משנה"),
    ("pl.reins_exp", "pl", None, r"^הוצאות מביטוח משנה$|^הקצאת פרמיות ביטוח משנה", "exp", "הוצאות מביטוח משנה"),
    ("pl.reins_inc", "pl", None, r"^הכנסות מביטוח משנה$|^סכומים שהושבו מביטוח משנה", "inc", "הכנסות מביטוח משנה"),
    ("pl.ins_res", "pl", None, r"^(רווח|תוצאות)" + P + r" משירותי ביטוח$", "res", "רווח משירותי ביטוח"),
    ("pl.inv_ins_gains", "pl", None, r"^רווחים" + P + r" מהשקעות,? ?נטו,? מנכסים (ה)?מוחזקים כנגד חוזי ביטוח", "res", "רווחים מהשקעות מנכסים כנגד חוזי ביטוח וחוזי השקעה תלויי תשואה"),
    ("pl.ins_fin", "pl", None, r"^(הוצאות \(הכנסות\)|הכנסות \(הוצאות\)) מימון,? ?נטו,? הנובעות מחוזי ביטוח$", "res", "הוצאות מימון, נטו, הנובעות מחוזי ביטוח"),
    ("pl.reins_fin", "pl", None, r"^(הוצאות \(הכנסות\)|הכנסות \(הוצאות\)) מימון,? ?נטו,? הנובעות מחוזי ביטוח משנה", "res", "הכנסות מימון, נטו, הנובעות מחוזי ביטוח משנה"),
    ("pl.inv_other_gains", "pl", None, r"^רווחים" + P + r" אחרים מהשקעות,? ?נטו$", "res", "רווחים אחרים מהשקעות, נטו"),
    ("pl.inv_other_total", "pl", None, r"^סך רווחים" + P + r" מהשקעות אחרות,? ?נטו$", "res", "סך רווחים מהשקעות אחרות, נטו"),
    ("pl.inv_total", "pl", None, r"^סך רווחים" + P + r" מהשקעות,? ?נטו$", "res", "סך רווחים מהשקעות, נטו"),
    ("pl.inv_fin", "pl", None, r"^רווח" + P + r" מהשקעות ומימון,? ?נטו", "res", "רווח מהשקעות ומימון, נטו"),
    ("pl.ins_inv_res", "pl", None, r"^רווח" + P + r",? נטו מביטוח ומהשקעה", "res", "רווח, נטו, מביטוח ומהשקעה"),
    ("pl.interest_eir", "pl", None, r"^הכנסות ריבית שחושבו (תוך שימוש )?ב?שיטת הריבית האפקטיבית", "inc", "הכנסות ריבית בשיטת הריבית האפקטיבית"),
    ("pl.gpe", "pl", None, r"^פרמיות שהורווחו ברוטו", "inc", "פרמיות שהורווחו ברוטו (IFRS 4)"),
    ("pl.reins_premiums", "pl", None, r"^פרמיות שהורווחו על ידי מבטחי משנה", "exp", "פרמיות שהורווחו על ידי מבטחי משנה (IFRS 4)"),
    ("pl.npe", "pl", None, r"^פרמיות שהורווחו בשייר", "inc", "פרמיות שהורווחו בשייר (IFRS 4)"),
    ("pl.inv_gains_ifrs4", "pl", None, r"^רווחים" + P + r" מהשקעות,? ?נטו,? והכנסות מימון$", "res", "רווחים מהשקעות, נטו, והכנסות מימון (IFRS 4)"),
    ("pl.claims_gross", "pl", None, r"^תשלומים ושינוי בהתחייבויות.*ברוטו$", "exp", "תשלומים ושינוי בהתחייבויות, ברוטו (IFRS 4)"),
    ("pl.claims_reins", "pl", None, r"^חלקם של מבטחי (ה)?משנה בתשלומים", "inc", "חלקם של מבטחי המשנה בתשלומים (IFRS 4)"),
    ("pl.claims_net", "pl", None, r"^תשלומים ושינוי בהתחייבויות.*בשייר", "exp", "תשלומים ושינוי בהתחייבויות, בשייר (IFRS 4)"),
    ("pl.commissions", "pl", None, r"^עמלות,? ?(ו)?הוצאות (שיווק|רכישה)", "exp", "עמלות, הוצאות שיווק ורכישה (IFRS 4)"),
    ("pl.agency_fees", "pl", None, r"^הכנסות מעמלות מסוכנויות ביטוח", "inc", "הכנסות מעמלות מסוכנויות ביטוח"),
    ("pl.fee_income", "pl", None, r"^הכנסות מעמלות$", "inc", "הכנסות מעמלות"),
    ("pl.fees", "pl", None, r"^הכנסות מדמי ניהול", "inc", "הכנסות מדמי ניהול"),
    ("pl.ga", "pl", None, r"^הוצאות הנהלה וכלליות", "exp", "הוצאות הנהלה וכלליות"),
    ("pl.opex", "pl", None, r"^הוצאות תפעוליות אחרות", "exp", "הוצאות תפעוליות אחרות"),
    ("pl.other_inc", "pl", None, r"^הכנסות אחרות$", "inc", "הכנסות אחרות"),
    ("pl.other_exp", "pl", None, r"^הוצאות אחרות$", "exp", "הוצאות אחרות"),
    ("pl.other_net", "pl", None, r"^(הכנסות \(הוצאות\)|הוצאות \(הכנסות\)) אחרות", "res", "הכנסות (הוצאות) אחרות, נטו"),
    ("pl.fin_exp_other", "pl", None, r"^הוצאות מימון אחרות$", "exp", "הוצאות מימון אחרות"),
    ("pl.fin_exp", "pl", None, r"^הוצאות מימון$", "exp", "הוצאות מימון"),
    ("pl.fin_inc", "pl", None, r"^הכנסות מימון$", "inc", "הכנסות מימון"),
    ("pl.total_rev", "pl", None, r"^סך (כל )?ה?הכנסות$", "inc", "סך ההכנסות"),
    ("pl.total_exp", "pl", None, r"^סך (כל )?ה?הוצאות$", "exp", "סך ההוצאות"),
    ("pl.op_profit", "pl", None, r"^רווח" + P + r" (תפעולי|מפעולות)", "res", "רווח תפעולי"),
    ("pl.equity_inc", "pl", None, r"^חלק(ה|ו)? (של החברה )?ב?רווחי(ם)?" + P + r" (של )?(חברות|חברה) (מוחזקות|כלולות|כלולה)", "res", "חלק ברווחי חברות מוחזקות"),
    ("pl.pbt", "pl", None, r"^רווח" + P + r" לפני מי?סים על ה?הכנסה", "res", "רווח לפני מסים על ההכנסה"),
    ("pl.tax", "pl", None, r"^(הוצאות )?מי?סים על ה?הכנסה$|^(הוצאות )?\(?הטבת\)? ?מס", "exp", "מסים על ההכנסה"),
    ("pl.np", "pl", None, r"^(רווח|הפסד)( נקי)?" + P + r"( נקי)? לתקופה$|^רווח נקי" + P + r"$|^רווח" + P + r"$", "res", "רווח לתקופה"),
    ("pl.np_attr", "pl", None, r"^ל?בעלי(ם)? (ה)?(מניות )?של (ה)?חברה|^ל?בעלי(ם)? (ה)?(מניות )?של חברת (ה)?אם|^בעלי המניות$", "res", "רווח לבעלי המניות"),
    ("pl.np_nci", "pl", None, r"^ל?זכויות שאינן מקנות שליטה$", "res", "רווח לזכויות שאינן מקנות שליטה"),
    ("pl.ci_total", "pl", None, r"^סך (ה)?רווח" + P + r" כולל לתקופה$|^רווח" + P + r" כולל לתקופה$", "res", "רווח כולל לתקופה"),
    ("pl.eps", "pl", "eps", r"^רווח( נקי)?" + P + r" בסיסי( ומדולל)? למניה|^רווח מפעילויות נמשכות למניה|^רווח למניה רגילה|^בסיסי$|^בסיסי ומדולל$", "ps", "רווח בסיסי למניה"),
    ("pl.eps_diluted", "pl", "eps", r"^רווח( נקי)?" + P + r" מדולל למניה|^מדולל$", "ps", "רווח מדולל למניה"),
    # comprehensive income
    ("oci.np", "oci", None, r"^(רווח|הפסד)( נקי)?" + P + r"( נקי)? לתקופה$|^רווח נקי" + P + r"$|^רווח" + P + r"$", "res", "רווח לתקופה"),
    ("oci.total", "oci", None, r"^סך (ה)?רווח" + P + r" כולל לתקופה$|^רווח" + P + r" כולל לתקופה$|^סך (ה)?רווח" + P + r" (ה)?כולל$|^רווח כולל$", "res", "רווח כולל לתקופה"),
    ("oci.oci_net", "oci", None, r"^סך (ה)?רווח" + P + r" כולל אחר לתקופה,? ?נטו ממס$|^רווח" + P + r" כולל אחר לתקופה,? ?נטו ממס$", "res", "רווח כולל אחר, נטו ממס"),
    ("oci.ppe_reval", "oci", None, r"^הערכה מחדש בגין (שערוך )?רכוש קבוע", "res", "הערכה מחדש של רכוש קבוע"),
    ("oci.attr", "oci", None, r"^ל?בעלי(ם)? (ה)?(מניות )?של (ה)?חברה|^בעלי המניות$", "res", "רווח כולל לבעלי המניות"),
    ("oci.nci", "oci", None, r"^ל?זכויות שאינן מקנות שליטה$", "res", "רווח כולל לזכויות שאינן מקנות שליטה"),
    # balance sheet: assets
    ("bs.intangibles", "bs", "a", r"^נכסים בלתי מוחשיים", "bal", "נכסים בלתי מוחשיים"),
    ("bs.dac", "bs", "a", r"^הוצאות רכישה נדחות", "bal", "הוצאות רכישה נדחות"),
    ("bs.ppe", "bs", "a", r"^רכוש קבוע$", "bal", "רכוש קבוע"),
    ("bs.ins_assets", "bs", "a", r"^נכסי חוזי ביטוח$", "bal", "נכסי חוזי ביטוח"),
    ("bs.reins_contract_assets", "bs", "a", r"^נכסי חוזי ביטוח משנה$", "bal", "נכסי חוזי ביטוח משנה"),
    ("bs.reins_assets", "bs", "a", r"^נכסי ביטוח משנה$", "bal", "נכסי ביטוח משנה (IFRS 4)"),
    ("bs.cur_tax_assets", "bs", "a", r"^נכסי מסים שוטפים", "bal", "נכסי מסים שוטפים"),
    ("bs.def_tax_assets", "bs", "a", r"^נכסי מסים נדחים", "bal", "נכסי מסים נדחים"),
    ("bs.receivables", "bs", "a", r"^חייבים ויתרות חובה", "bal", "חייבים ויתרות חובה"),
    ("bs.re_yield", "bs", "a", r"^נדל.?ן להשקעה עבור חוזים תלויי תשואה", "bal", "נדל\"ן להשקעה עבור חוזים תלויי תשואה"),
    ("bs.re_other", "bs", "a", r"^נדל.?ן להשקעה ?-? ?אחר", "bal", "נדל\"ן להשקעה, אחר"),
    ("bs.fin_inv_yield", "bs", "a", r"^השקעות פיננסיות עבור חוזים תלויי תשואה$", "bal", "השקעות פיננסיות עבור חוזים תלויי תשואה"),
    ("bs.cash_yield", "bs", "a", r"^מזומנים ושווי מזומנים עבור חוזים תלויי תשואה", "bal", "מזומנים ושווי מזומנים עבור חוזים תלויי תשואה"),
    ("bs.assets_yield_total", "bs", "a", r"^סך (כל )?ה?נכסים עבור חוזים תלויי תשואה", "bal", "סך הנכסים עבור חוזים תלויי תשואה"),
    ("bs.debt_traded", "bs", "a", r"^נכסי חוב סחירים$", "bal", "נכסי חוב סחירים"),
    ("bs.debt_nontraded", "bs", "a", r"^נכסי חוב שאינם סחירים$", "bal", "נכסי חוב שאינם סחירים"),
    ("bs.equities", "bs", "a", r"^מניות$", "bal", "מניות"),
    ("bs.fin_inv_other_total", "bs", "a", r"^סך (כל )?ה?השקעות פיננסיות אחרות$", "bal", "סך השקעות פיננסיות אחרות"),
    ("bs.cash", "bs", "a", r"^מזומנים ושווי מזומנים אחרים", "bal", "מזומנים ושווי מזומנים אחרים"),
    ("bs.total_assets", "bs", None, r"^סך (כל )?ה?נכסים$", "bal", "סך הנכסים"),
    # balance sheet: equity and liabilities
    ("bs.share_capital", "bs", "le", r"^הון (ה)?מניות$", "bal", "הון מניות"),
    ("bs.share_premium", "bs", "le", r"^פרמיה על מניות$", "bal", "פרמיה על מניות"),
    ("bs.cap_reserves", "bs", "le", r"^קרנות הון$", "bal", "קרנות הון"),
    ("bs.retained", "bs", "le", r"^עודפים$|^יתרת רווח$", "bal", "עודפים"),
    ("bs.equity_attr", "bs", "le", r"^סך (כל )?ה?הון המיוחס לבעלי", "bal", "הון המיוחס לבעלי המניות"),
    ("bs.nci", "bs", "le", r"^זכויות שאינן מקנות שליטה$", "bal", "זכויות שאינן מקנות שליטה"),
    ("bs.total_equity", "bs", None, r"^סך (כל )?ה?הון$", "bal", "סך ההון"),
    ("bs.ins_liab", "bs", "le", r"^התחייבויות בגין חוזי ביטוח$", "bal", "התחייבויות בגין חוזי ביטוח"),
    ("bs.reins_liab", "bs", "le", r"^התחייבויות בגין חוזי ביטוח משנה$", "bal", "התחייבויות בגין חוזי ביטוח משנה"),
    ("bs.inv_contracts_yield", "bs", "le", r"^התחייבויות בגין חוזי השקעה תלויי תשואה$", "bal", "התחייבויות בגין חוזי השקעה תלויי תשואה"),
    ("bs.fin_liab", "bs", "le", r"^התחייבויות פיננסיות$", "bal", "התחייבויות פיננסיות"),
    ("bs.emp_liab", "bs", "le", r"^התחייבויות בשל הטבות לעובדים", "bal", "התחייבויות בשל הטבות לעובדים, נטו"),
    ("bs.def_tax_liab", "bs", "le", r"^התחייבויות (בגין|בשל) מסים נדחים", "bal", "התחייבויות בגין מסים נדחים"),
    ("bs.cur_tax_liab", "bs", "le", r"^התחייבויות (בגין|בשל) מסים שוטפים", "bal", "התחייבויות בגין מסים שוטפים"),
    ("bs.payables", "bs", "le", r"^זכאים ויתרות זכות", "bal", "זכאים ויתרות זכות"),
    ("bs.total_liab", "bs", None, r"^סך (כל )?ה?התחייבויות$", "bal", "סך ההתחייבויות"),
    ("bs.total_le", "bs", None, r"^סך (כל )?ה?(התחייבויות וה?הון|הון וה?התחייבויות)$", "bal", "סך ההון וההתחייבויות"),
    # cash flows
    ("cf.np", "cf", None, r"^(רווח|הפסד)( נקי)?" + P + r"( נקי)? לתקופה$|^רווח נקי" + P + r"$|^רווח" + P + r"$", "res", "רווח לתקופה"),
    ("cf.int_received", "cf", None, r"^ריבית שהתקבלה$", "inc", "ריבית שהתקבלה"),
    ("cf.int_paid", "cf", None, r"^ריבית ששולמה$", "exp", "ריבית ששולמה"),
    ("cf.div_received", "cf", None, r"^דיבידנד(ים)? שהתקבל(ו)?$", "inc", "דיבידנד שהתקבל"),
    ("cf.tax_paid", "cf", None, r"^מסים (על הכנסה )?ששולמו$", "exp", "מסים ששולמו"),
    ("cf.tax_received", "cf", None, r"^מסים (על הכנסה )?שהתקבלו$", "inc", "מסים שהתקבלו"),
    ("cf.cfo", "cf", None, r"מזומנים,? ?נטו.*(מ|ל)פעילות שוטפת", "res", "מזומנים נטו מפעילות שוטפת"),
    ("cf.capex_ppe", "cf", "inv", r"^(השקעה ב|רכישת )רכוש קבוע$", "exp", "השקעה ברכוש קבוע"),
    ("cf.capex_intang", "cf", "inv", r"^(השקעה ב|רכישת )נכסים בלתי מוחשיים$", "exp", "השקעה בנכסים בלתי מוחשיים"),
    ("cf.cfi", "cf", None, r"מזומנים,? ?נטו.*(מ|ל)פעילות השקעה", "res", "מזומנים נטו מפעילות השקעה"),
    ("cf.div_paid", "cf", None, r"^דיבידנד (ששולם|לבעלי)(?!.*(שאינן מקנות|מיעוט))", "exp", "דיבידנד ששולם"),
    ("cf.cff", "cf", None, r"מזומנים,? ?נטו.*(מ|ל)פעילות מימון", "res", "מזומנים נטו מפעילות מימון"),
    ("cf.cash_open", "cf", "cash", r"^יתרת מזומנים ושווי מזומנים לתחילת ה?תקופה", "bal", "מזומנים לתחילת התקופה"),
    ("cf.cash_close", "cf", "cash", r"^יתרת מזומנים ושווי מזומנים לסוף ה?תקופה", "bal", "מזומנים לסוף התקופה"),
    ("cf.cash_change", "cf", "cash", r"^(עלי[יה]+|ירידה)( נטו)?( \((עלי[יה]+|ירידה)\))?( נטו)? במזומנים ושווי מזומנים", "res", "שינוי במזומנים ושווי מזומנים"),
]
CORE_RE = [(i, st, blk, re.compile(p), nat, he) for i, st, blk, p, nat, he in CORE]
# the roles of lines.json (build_workbook.ROLES) and the core id each one is
ROLE_ID = {"ins_rev": "pl.ins_rev", "ins_exp": "pl.ins_exp", "ins_res": "pl.ins_res", "inv_fin": "pl.inv_fin", "gpe": "pl.gpe", "npe": "pl.npe",
           "total_rev": "pl.total_rev", "op_profit": "pl.op_profit", "claims_net": "pl.claims_net", "commissions": "pl.commissions", "ga": "pl.ga",
           "fees": "pl.fees", "opex": "pl.opex", "pbt": "pl.pbt", "tax": "pl.tax", "np": "pl.np", "np_attr": "pl.np_attr", "eps": "pl.eps",
           "total_assets": "bs.total_assets", "equity_attr": "bs.equity_attr", "total_equity": "bs.total_equity", "total_liab": "bs.total_liab",
           "ins_liab": "bs.ins_liab", "intangibles": "bs.intangibles", "cash": "bs.cash", "cfo": "cf.cfo", "cfi": "cf.cfi", "cff": "cf.cff", "div_paid": "cf.div_paid"}
# IFRS 4 lines and the IFRS 17 line that took their place in the statements (not like for like: a definition break, BreakChip)
BRIDGE = {
    "pl.gpe": ("pl.ins_rev", "IFRS 17 החליף פרמיות שהורווחו בהכנסות משירותי ביטוח (לא זהה בהגדרה)"),
    "pl.claims_gross": ("pl.ins_exp", "IFRS 17 החליף תשלומים ושינוי בהתחייבויות בהוצאות משירותי ביטוח (לא זהה בהגדרה)"),
    "pl.reins_premiums": ("pl.reins_exp", "פרמיות למבטחי משנה (IFRS 4) מול הוצאות מביטוח משנה (IFRS 17)"),
    "pl.claims_reins": ("pl.reins_inc", "חלק מבטחי המשנה (IFRS 4) מול הכנסות מביטוח משנה (IFRS 17)"),
    "pl.inv_gains_ifrs4": ("pl.inv_total", "רווחי השקעות והכנסות מימון (IFRS 4) מול סך רווחים מהשקעות (IFRS 17)"),
    "bs.reins_assets": ("bs.reins_contract_assets", "נכסי ביטוח משנה (IFRS 4) מול נכסי חוזי ביטוח משנה (IFRS 17)"),
    "bs.dac": (None, "הוצאות רכישה נדחות אינן מוצגות בנפרד תחת IFRS 17 (נכללות בחוזי הביטוח)"),
}

# lines that are not flows: never summed across periods (build_workbook.NONFLOW, the derivation allow-list)
NONFLOW = re.compile(r"לתחילת|לסוף|^יתרת|יתרה ל|מספר ה?מניות|משוקלל|למניה|שיעור|יחס |באחוזים|%|באלפים")
# series metric keys that are balances (build_workbook.STOCK)
STOCK = re.compile(r"aum_|total_assets|assets_for_yield|equity_|total_equity|ra_closing|ra_confidence|risk_adjustment|loss_component|loss_recovery_component|own_funds|scr|mcr|solvency|surplus|shortfall|capital_|excess_capital|cet1|total_capital_ratio|investment_contracts_liability|transitional_deduction")


def core_match(stmt, block, captions, only=None):
    """The core line a row is, from any caption it was printed under (newest first). None when no curated pattern matches."""
    for cap in captions:
        c = caption(cap)
        for cid, st, blk, rx, nat, he in CORE_RE:
            if (only is None or cid == only) and st == stmt and (blk is None or blk == block) and rx.search(c):
                return cid
    return None


CORE_META = {i: {"nature": nat, "label": he, "stmt": st} for i, st, blk, p, nat, he in CORE}
