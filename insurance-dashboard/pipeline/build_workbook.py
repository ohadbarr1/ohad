"""The data workbook of every company, in the format the financials explorer reads: web/public/data/companies/<id>.json

Phoenix keeps the workbook built from its published spreadsheet (pipeline/extract_company_workbook.py); the lines extracted from
the reports (web/public/data/series/<id>.json, 2021 onward, quarterly and annual) are added to it as further sheets.
Every other company gets a workbook made of those extracted lines only. Each fact carries its own source file, because the
figures come from many reports: facts are [metric, period, value, page, url index, 1 when the value is derived (Q4 = FY less nine months)] and `urls` is the list they index.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "Q4": "12-31", "FY": "12-31"}
# segment of the extraction -> (reporting entity, report group, sheet title). F = the parent, consolidated; I = the insurance company; P = pension and provident.
GROUPS = {"group": ("F", "income", "תמצית מאוחדת"), "life": ("F", "life", "מגזר חיים וחיסכון ארוך טווח"), "health": ("F", "health", "מגזר בריאות"), "pc": ("F", "general", "מגזר ביטוח כללי"),
          "investment_contracts": ("F", "pension", "פוליסות חיסכון (חוזי השקעה)"), "other": ("F", "other", "אחר"),
          "insurer": ("I", "capital", "חברת הביטוח: הון וכושר פירעון"), "savings": ("P", "pension", "פנסיה, גמל וניהול נכסים")}
ENTITY_NAMES = {"F": "חברת האם (מאוחד)", "I": "חברת הביטוח", "P": "פנסיה וגמל"}
GROUP_LABELS = {"balance": "מאזן", "income": "רווח והפסד", "oci": "רווח כולל", "equity": "שינויים בהון", "cashflow": "תזרים מזומנים", "segments": "מגזרי פעילות",
                "life": "ביטוח חיים וחיסכון ארוך טווח", "health": "ביטוח בריאות", "general": "ביטוח כללי", "pension": "פנסיה, גמל וחוזי השקעה", "capital": "הון ודרישות הון",
                "insurance_services": "רווח משירותי ביטוח", "investments": "רווח מהשקעות ומימון", "instruments": "מכשירים פיננסיים", "other": "אחר"}
# Hebrew metric names live with the site's label dictionaries
he = {}
for f in ("web/src/lib/labels.ts", "web/src/pages/CompanyIfrs.tsx", "web/src/pages/IndustryIfrs.tsx"):
    src = (ROOT / f).read_text(encoding="utf-8")
    for k, v in re.findall(r"[\[{,\s]'?([a-z][a-z0-9_]+)'?\s*[:,]\s*'([^'\n]*[א-ת][^'\n]*)'", src):
        he.setdefault(k, v)
STOCK = re.compile(r"aum_|total_assets|assets_for_yield|equity_|total_equity|ra_closing|ra_confidence|risk_adjustment|loss_component|loss_recovery_component|own_funds|scr|mcr|solvency|surplus|shortfall|capital_|excess_capital|cet1|total_capital_ratio|investment_contracts_liability|transitional_deduction")
EXTRA = {
    "gross_premiums_earned": "פרמיות שהורווחו ברוטו", "net_premiums_earned": "פרמיות שהורווחו בשייר", "gross_written_premiums": "פרמיות ברוטו", "gross_written_premiums_turnover": "פרמיות ברוטו (מחזור)",
    "combined_ratio": "יחס משולב (Combined ratio)", "loss_ratio": "יחס תביעות (Loss ratio)", "aum_customer_portfolios": "נכסים מנוהלים: תיקי לקוחות", "aum_mutual_funds": "נכסים מנוהלים: קרנות נאמנות",
    "aum_investment_contracts": "נכסים מנוהלים: פוליסות חיסכון (חוזי השקעה)", "aum_insurance_contracts": "נכסים מנוהלים: חוזי ביטוח", "aum_financial_services": "נכסים מנוהלים: שירותים פיננסיים",
    "aum_financial_services_nis_bn": "נכסים מנוהלים: שירותים פיננסיים (מיליארדי ₪)", "aum_gemel_nis_bn": "נכסים מנוהלים: גמל (מיליארדי ₪)", "aum_pension_nis_bn": "נכסים מנוהלים: פנסיה (מיליארדי ₪)",
    "aum_pension_gemel": "נכסים מנוהלים: פנסיה וגמל", "aum_pension_gemel_total": "נכסים מנוהלים: פנסיה וגמל, סך הכול", "aum_hmo_ltc": "נכסים מנוהלים: סיעוד קופות חולים", "aum_total_nostro": "נכסי נוסטרו, סך הכול",
    "aum_total_members_funds": "נכסים מנוהלים עבור עמיתים, סך הכול", "aum_insured_and_members": "נכסים מנוהלים עבור מבוטחים ועמיתים", "aum_managed_for_insureds_and_members": "נכסים מנוהלים עבור מבוטחים ועמיתים",
    "assets_for_yield_dependent_contracts": "נכסים עבור חוזים תלויי תשואה", "total_assets_yield_linked": "סך נכסים עבור חוזים תלויי תשואה", "investment_contracts_liability": "התחייבויות בגין חוזי השקעה",
    "contributions": "הפקדות", "contributions_gemel": "הפקדות: גמל", "contributions_pension": "הפקדות: פנסיה", "contributions_towards_benefits": "דמי גמולים", "transfers_in": "העברות נכנסות", "transfers_out": "העברות יוצאות",
    "net_transfers": "העברות, נטו", "net_accumulation": "צבירה נטו", "management_fees_fixed": "דמי ניהול קבועים", "management_fees_variable": "דמי ניהול משתנים", "fee_rate_from_assets": "שיעור דמי ניהול מנכסים",
    "fee_rate_from_deposits": "שיעור דמי ניהול מהפקדות", "financial_margin": "מרווח פיננסי", "financial_margin_and_management_fees": "מרווח פיננסי ודמי ניהול", "excess_financial_spread": "מרווח פיננסי עודף",
    "investment_contract_receipts": "תקבולים בגין חוזי השקעה", "investment_contracts_receipts": "תקבולים בגין חוזי השקעה", "receipts_investment_contracts": "תקבולים בגין חוזי השקעה", "investment_contract_proceeds": "תקבולים בגין חוזי השקעה",
    "proceeds_investment_contracts": "תקבולים בגין חוזי השקעה", "investment_contract_premiums": "תקבולים בגין חוזי השקעה", "investment_contract_receipts_credited_to_reserves": "תקבולים בגין חוזי השקעה שנזקפו לעתודות",
    "payments_investment_contracts": "תשלומים בגין חוזי השקעה", "investment_contracts_profit": "רווח מחוזי השקעה", "premiums_incl_investment_contract_receipts": "פרמיות, כולל תקבולים בגין חוזי השקעה",
    "gross_premiums_incl_investment_contract_receipts": "פרמיות ברוטו, כולל תקבולים בגין חוזי השקעה", "current_premiums_incl_investment_contract_receipts": "פרמיות שוטפות, כולל תקבולים בגין חוזי השקעה",
    "one_time_premiums_incl_investment_contract_receipts": "פרמיות חד פעמיות, כולל תקבולים בגין חוזי השקעה", "one_time_premium_earned": "פרמיות חד פעמיות שהורווחו", "one_time_premium_new_business": "עסק חדש: פרמיות חד פעמיות",
    "one_time_premium_new_business_investment_contracts": "עסק חדש: הפקדות חד פעמיות בחוזי השקעה", "new_business_annualized_premiums": "עסק חדש: פרמיה משונתת", "new_business_annualized_premiums_investment_contracts": "עסק חדש: הפקדה משונתת בחוזי השקעה",
    "new_business_individual_premium": "עסק חדש: פרמיות פרט", "new_business_one_off_premiums": "עסק חדש: פרמיות חד פעמיות", "new_business_single_premiums": "עסק חדש: פרמיות חד פעמיות",
    "profit_for_period": "רווח לתקופה", "profit_for_year": "רווח לשנה", "profit_total": "רווח, סך הכול", "net_profit_total": "רווח נקי, סך הכול", "net_income": "רווח נקי", "net_profit": "רווח נקי", "profit_attributable": "רווח לבעלי המניות",
    "comprehensive_income_total": "רווח כולל, סך הכול", "comprehensive_income_before_tax_after_allocation": "רווח כולל לפני מס, לאחר הקצאה", "income_tax": "מסים על ההכנסה", "income_tax_on_comprehensive_income": "מסים על הרווח הכולל",
    "operating_profit_before_tax": "רווח תפעולי לפני מס", "pension_gemel_profit_before_tax": "רווח לפני מס: פנסיה וגמל", "core_income": "רווח ליבה", "core_profit": "רווח ליבה", "revenue": "הכנסות",
    "roe_adjusted": "ROE מותאם", "roe_core": "ROE ליבה", "roe_normalized": "ROE מנורמל", "roe_reported_ex_adjustments": "ROE מדווח, ללא התאמות", "total_equity": "סך הון", "cet1_ratio": "יחס הון רובד 1", "total_capital_ratio": "יחס הון כולל",
    "mcr": "MCR", "transitional_deduction": "ניכוי בתקופת הפריסה", "dividend_declared_after_period": "דיבידנד שהוכרז לאחר התקופה", "dividend_declared_in_kind": "דיבידנד בעין שהוכרז",
    "capital_instruments_issued_redeemed": "מכשירי הון שהונפקו ונפדו", "capital_raise_effect": "השפעת גיוס הון", "assumption_change_effect": "השפעת שינוי הנחות", "assumption_update": "עדכון הנחות",
    "insurance_service_expense": "הוצאות שירותי ביטוח", "insurance_service_expenses": "הוצאות שירותי ביטוח", "insurance_service_result_before_reinsurance": "תוצאות שירותי ביטוח לפני ביטוח משנה",
    "reinsurance_expenses": "הוצאות ביטוח משנה", "reinsurance_expenses_total": "הוצאות ביטוח משנה, סך הכול", "reinsurance_revenues": "הכנסות ביטוח משנה", "reinsurance_revenues_total": "הכנסות ביטוח משנה, סך הכול",
    "reinsurance_finance_result": "תוצאות מימון ביטוח משנה", "reinsurance_net_result": "תוצאה נטו מביטוח משנה", "net_reinsurance_result": "תוצאה נטו מביטוח משנה", "reinsurance_past_service": "ביטוח משנה: שירותי עבר",
    "reinsurance_recoveries_claims": "ביטוח משנה: השבת תביעות", "ise_total": "הוצאות שירותי ביטוח, סך הכול", "ise_claims_incurred": "הוצאות שירותי ביטוח: תביעות שהתהוו", "ise_past_service": "הוצאות שירותי ביטוח: שירותי עבר",
    "ise_amortization_acquisition": "הוצאות שירותי ביטוח: הפחתת תזרימי רכישה", "loss_recovery_component": "רכיב השבת הפסד", "ra_confidence_level": "RA: רמת ביטחון", "net_investment_and_finance_result_pl": "תוצאות השקעה ומימון, נטו (רווח והפסד)",
    "net_investment_result_oci": "תוצאות השקעה, נטו (רווח כולל אחר)", "insurance_finance_result": "הכנסות (הוצאות) מימון ביטוח", "insurance_finance_interest_accrued": "מימון ביטוח: צבירת ריבית", "insurance_finance_accrued_interest": "מימון ביטוח: צבירת ריבית",
    "insurance_finance_rate_effect": "מימון ביטוח: השפעת שינויי ריבית", "insurance_finance_rate_effects": "מימון ביטוח: השפעת שינויי ריבית", "csm_economic_interest_and_other_effects": "CSM: ריבית והשפעות כלכליות אחרות",
    "total_investment_gains_recognized_in_income_statement": "סך רווחי השקעות שנזקפו לרווח והפסד", "investment_gains_assets_held_against_insurance_and_yield_dependent": "רווחי השקעות מנכסים כנגד חוזי ביטוח וחוזים תלויי תשואה",
    "shortfall_vs_board_target": "גירעון מול יעד הדירקטוריון",
}
STEMS = [("solvency_ratio", "יחס כושר פירעון"), ("solvency_surplus", "עודף הון"), ("capital_surplus", "עודף הון"), ("excess_capital", "עודף הון"), ("surplus", "עודף הון"), ("own_funds", "הון עצמי לעניין SCR"), ("scr", "הון נדרש (SCR)"),
         ("capital_raise", "גיוס הון"), ("capital_issuance", "גיוס הון"), ("capital_raising", "גיוס הון")]
MODS = [("_without_transitional", "ללא הוראות מעבר"), ("_with_transitional", "עם הוראות מעבר"), ("_after_capital_actions", "לאחר פעולות הון"), ("_after_capital_events", "לאחר פעולות הון"),
        ("_after_capital_transactions", "לאחר פעולות הון"), ("_after_capital_raise", "לאחר גיוס הון"), ("_pro_forma", "פרו פורמה"), ("_for_mcr", "לעניין MCR"), ("_mcr", "לעניין MCR"),
        ("_vs_board_target", "מול יעד הדירקטוריון"), ("_over_target", "מעל היעד"), ("_vs_target", "מול היעד"), ("_after_calculation_date", "לאחר תאריך החישוב"), ("_after_report_date", "לאחר תאריך הדוח"), ("_after_period", "לאחר התקופה")]


def spell(k):
    """Hebrew name for a capital key built from a stem and qualifiers; a key that does not fully resolve keeps its English name, nothing is guessed."""
    for stem, word in STEMS:
        if k.startswith(stem):
            rest, parts = k[len(stem):], [word]
            while rest:
                hit = next(((m, w) for m, w in MODS if rest.startswith(m)), None)
                if not hit:
                    return None
                parts.append(hit[1]); rest = rest[len(hit[0]):]
            return ", ".join(parts)
    return None


BASIS = {"net": "נטו", "gross": "ברוטו", "reinsurance": "ביטוח משנה"}
is_pct = lambda m: bool(re.search(r"ratio|_pct|payout|confidence|discount_rate|roe_reported|threshold", m))


def name(m):
    k, _, rest = m.partition(":")
    base = he.get(k) or EXTRA.get(k) or spell(k) or k.replace("_", " ")
    return base + (f": {rest}" if rest else "")


registry = json.loads((ROOT / "data" / "registry" / "companies.json").read_text(encoding="utf-8"))
names = {c["id"]: c["name_he"] for c in (registry if isinstance(registry, list) else registry.get("companies", []))}
for sf in sorted((DATA / "series").glob("*.json")):
    comp = sf.stem
    if comp == "index":
        continue
    series = json.loads(sf.read_text(encoding="utf-8"))
    base_f = ROOT / "data" / "workbook_base" / f"{comp}.json"  # the spreadsheet-based workbook, kept aside so this script can be rerun
    live_f = DATA / "companies" / f"{comp}.json"
    if comp == "phoenix" and not base_f.exists() and live_f.exists():
        base_f.write_text(live_f.read_text(encoding="utf-8"), encoding="utf-8")
    base = json.loads(base_f.read_text(encoding="utf-8")) if base_f.exists() else None
    d = base or {"company": comp, "sources": [], "groups": {}, "sheets": [], "periods": [], "metrics": [], "facts": [], "stats": {}}
    d["groups"] = {**GROUP_LABELS, **d.get("groups", {})}
    urls, uidx = [], {}
    pidx = {p["id"]: i for i, p in enumerate(d["periods"])}

    def period(per, flow):
        typ = "FY" if per.endswith("FY") else ("Q" if flow else "I")
        end = f"{per[:4]}-{END[per[4:]]}"
        pid = f"{typ}{end}"
        if pid not in pidx:
            pidx[pid] = len(d["periods"])
            d["periods"].append({"id": pid, "label": pid, "type": typ, "end": end, "months": {"FY": 12, "Q": 3, "I": 0}[typ]})
        return pidx[pid]

    by_g = {}
    for r in series["rows"]:
        by_g.setdefault(r["g"], []).append(r)
    for g, rows in by_g.items():
        ent, grp, title = GROUPS.get(g, ("F", "other", g))
        code = f"X.{title.replace(' ', '_')}"  # X marks a sheet built from the periodic reports, 2021 onward
        d["sheets"].append({"code": code, "entity": ent, "title": title, "pages": "", "group": grp})
        if not any(s["entity"] == ent for s in d["sources"]):
            d["sources"].append({"entity": ent, "name": ENTITY_NAMES[ent], "doc": "הדוחות התקופתיים של " + names.get(comp, comp), "url": None, "pages": None})
        for order, r in enumerate(rows):
            flow = not STOCK.match(r["m"])
            dim = " · ".join(x for x in ((r["s"].split(":", 1)[1].strip() if ":" in r["s"] else r["s"]) if r["s"] != r["g"] else "", BASIS.get(r["b"], "")) if x)
            mi = len(d["metrics"])
            pct = is_pct(r["m"])
            d["metrics"].append({"entity": ent, "sheet": code, "group": grp, "label": name(r["m"]), "dim": dim, "unit": "pct" if pct else "k", "header": False, "order": order})
            for per, c in r["vals"].items():
                if per.endswith("FY") and not flow:
                    continue  # a balance at year-end is already the Q4 column
                u = c.get("u")
                if u and u not in uidx:
                    uidx[u] = len(urls)
                    urls.append(u)
                d["facts"].append([mi, period(per, flow), c["v"] if pct else round(c["v"] * 1000, 3), c.get("pg"), uidx.get(u) if u else None] + ([1] if c.get("der") else []))
    d["urls"] = urls
    live_f.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(comp, len(d["sheets"]), "sheets,", len(d["metrics"]), "lines,", len(d["facts"]), "facts,", len(d["periods"]), "periods")
