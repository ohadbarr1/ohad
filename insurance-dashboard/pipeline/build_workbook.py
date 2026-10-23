"""The data workbook of every company, in the format the financials explorer reads: web/public/data/companies/<id>.json

Phoenix keeps the workbook built from its published spreadsheet (pipeline/extract_company_workbook.py); the lines extracted from
the reports (web/public/data/series/<id>.json, 2021 onward, quarterly and annual) are added to it as further sheets.
Every other company gets a workbook made of those extracted lines only. Each fact carries its own source file, because the
figures come from many reports: facts are [metric, period, value, page, url index, flags] and `urls` is the list they index. Flags are a bitmask:
1 = derived (Q4 = FY less nine months, H2 = FY less H1; only on flow lines), 2 = taken from the IFRS 4 statement as originally reported,
4 = sign turned to the latest presentation, 8 = the latest print of a period that a later report restated: the value differs from the first
print by more than rounding (`restated` keeps both, with their pages).
A period printed by several reports takes its figure from the LATEST report that prints it (one vintage per row, so quarters add up to the
half-year and nine months), unless the two prints are not plausibly the same line (opposite sign or more than a factor of two apart),
when the first print stands. Units: "k" = NIS thousands, "nis" = NIS per share, "shares" = number of shares (never rescaled), "pct" = %.

merge() is the extraction merge and writes nothing: it keeps every print of every cell beside the one it picks, and pipeline/build_facts.py
builds the fact table from it and writes companies/<id>.json, search/rows.json and lines.json FROM the table (docs/FACTS.md, step 1).
`python3 pipeline/build_workbook.py` runs that whole build (the same as `python3 pipeline/build_facts.py`).
"""
import collections
import csv
import json
import os
import queue
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
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
    "financial_margin_incl_management_fees": "מרווח פיננסי כולל דמי ניהול", "net_written_premiums": "פרמיות בשייר",
    "capital_shortfall_vs_target": "גירעון הון מול היעד", "solvency_deficit_vs_target": "גירעון כושר פירעון מול היעד", "solvency_gap_to_target": "פער כושר פירעון מול היעד",
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


# Hebrew for the English captions the extractor kept after a metric key ("csm_other:<caption>"): the wording of the Hebrew IFRS 17 notes
# (insurance finance: Phoenix FY'25 p567, Menora FY'25 p380, Clal FY'25 p427; revenue: Clal FY'25 p425; CSM movement: Phoenix FY'25 p536, p548)
NOTE_HE = {
    "Note 21E effect of revision of estimates": "השפעת עדכון אומדנים (ביאור 21ה)",
    "Actual vs. expected financial spread, including modified assumptions": "מרווח פיננסי וצפי מול בפועל, לרבות שינוי הנחות",
    "Balance of assets as of December 31": "יתרת נכסים ליום 31 בדצמבר",
    "Balance of liabilities as of December 31": "יתרת התחייבויות ליום 31 בדצמבר",
    "Changes in recoveries of losses for groups of onerous underlying insurance contracts adjusting the CSM": "שינויים בהשבות של הפסדים בגין קבוצות של חוזי ביטוח בסיס מכבידים המתאמים את מרווח השירות החוזי",
    "Changes in reinsurance CSM": "שינויים במרווח השירות החוזי של ביטוח משנה",
    "time value (interest accretion) and other financial variables": "ערך הזמן (צבירת ריבית) ומשתנים פיננסיים אחרים",
    "Change in liabilities arising from changes in fair value of underlying items of VFA contracts": "שינוי בהתחייבויות בגין חוזי ביטוח הנובע משינויים בשווי ההוגן של פריטי הבסיס של חוזי VFA",
    "Change in liabilities from changes in fair value of underlying items of VFA contracts": "שינוי בהתחייבויות בגין חוזי ביטוח הנובע משינויים בשווי ההוגן של פריטי הבסיס של חוזי VFA",
    "Effect of difference between current-rate and original-rate discounting of changes in FCF charged to CSM": "השפעת הפער בין היוון בריבית שוטפת להיוון בריבית מקורית של השינויים ב-FCF שנזקפו ל-CSM",
    "Effect of difference between current and original discount rate on changes in FCF carried to CSM": "השפעת הפער בין היוון בריבית שוטפת להיוון בריבית מקורית של השינויים ב-FCF שנזקפו ל-CSM",
    "Effects of changes in interest rates and other financial assumptions": "השפעות שינויים בשיעורי הריבית והנחות פיננסיות אחרות",
    "Effects of changes in interest rates and other financial assumptions (including inflation)": "השפעות שינויים בשיעורי הריבית והנחות פיננסיות אחרות, לרבות הנחות אינפלציה",
    "Effects of the risk mitigation option for VFA contracts": "ההשפעות של אופציית צמצום הסיכון בגין חוזי VFA",
    "Exchange rate differences and other, net": "הפרשי שער ואחר, נטו",
    "Interest accrued": "ריבית שנצברה",
    "VAT rate update": "עדכון שיעור המע\"מ",
    "Experience adjustments arising from premiums paid": "תיאומים בהתאם לניסיון הנובעים מפרמיות ששולמו",
    "Experience adjustments arising from premiums received": "תיאומים בהתאם לניסיון הנובעים מפרמיות שהתקבלו",
    "Experience adjustments from premiums received in the period relating to current or past service": "תיאומים בהתאם לניסיון הנובעים מפרמיות שהתקבלו בתקופה בגין שירות שוטף או שירותי עבר",
    "Total contracts for which the PAA was not applied": "סך הכל חוזים שלגביהם לא יושמה גישת הקצאת הפרמיה (PAA)",
    "income (loss) from investments and finance, net": "רווח (הפסד) מהשקעות ומימון, נטו",
}
# segment captions as the Hebrew reports name the operating segments and their sub-segments
SEG_PART = {
    "Life Insurance and Long-Term Savings": "ביטוח חיים וחיסכון ארוך טווח", "Long-Term Savings": "חיסכון ארוך טווח", "Life Insurance": "ביטוח חיים",
    "Health Insurance": "ביטוח בריאות", "P&C Insurance": "ביטוח כללי", "Life and Health Risks": "סיכוני חיים ובריאות",
    "Policies with a non-yield-dependent savings component": "פוליסות הכוללות מרכיב חיסכון שאינו תלוי תשואה",
    "Policies with a yield-dependent savings component": "פוליסות הכוללות מרכיב חיסכון תלוי תשואה",
    "Policies without a savings component": "פוליסות ללא מרכיב חיסכון", "Investment contracts": "חוזי השקעה", "investment contracts": "חוזי השקעה",
    "Pension": "פנסיה", "Provident": "גמל", "LTC": "סיעודי", "Collective": "קולקטיב", "Individual": "פרט", "collective (incl. dental)": "קולקטיב (כולל שיניים)",
    "individual": "פרט", "Medical expenses and disabilities": "הוצאות רפואיות ונכויות", "Compulsory Motor": "רכב חובה", "Motor Property": "רכב רכוש",
    "Other": "אחר", "Run-off": "תיק בהרצה (Run-off)", "Growth": "תיק בצמיחה (Growth)", "Life": "חיים", "Health": "בריאות",
    "Investment policies": "פוליסות חיסכון (חוזי השקעה)", "life_health_combined": "חיים ובריאות, יחד",
}
SEG_HE = {
    "Health Insurance - LTC - Collective": "ביטוח בריאות: סיעודי קולקטיב", "Health Insurance - LTC - Individual": "ביטוח בריאות: סיעודי פרט",
    "Other (critical illness, foreign workers, travel, personal accidents)": "אחר (מחלות קשות, עובדים זרים, נסיעות לחו\"ל, תאונות אישיות)",
    "Adjustments and offsets": "התאמות וקיזוזים", "HMO long-term-care funds operation and others": "תפעול קרנות סיעוד של קופות חולים ואחר",
    "Other (non-segmented)": "לא מיוחס למגזרי פעילות", "group (including nostro)": "הקבוצה (כולל נוסטרו)",
    "group (policyholders and planholders)": "הקבוצה (מבוטחים ועמיתים)", "non-controlling interests": "זכויות שאינן מקנות שליטה",
    "remaining operating segments": "יתר מגזרי הפעילות", "Pension and Provident": "פנסיה וגמל", "Pension and Provident Subsegments": "פנסיה וגמל (תתי מגזרים)",
    "other general insurance (liability and other property)": "ביטוח כללי אחר (חבויות ורכוש אחר)", "Motor": "רכב", "motor property": "רכב רכוש",
    "pc_motor_property": "רכב רכוש", "pc_ayalon_motor_property": "רכב רכוש (איילון)", "pc_wesure_motor_property": "רכב רכוש (WeSure)",
    "Menora Insurance": "מנורה ביטוח", "Shomera Insurance": "שומרה ביטוח", "Phoenix Insurance": "הפניקס ביטוח",
}

BASIS = {"net": "נטו", "gross": "ברוטו", "reinsurance": "ביטוח משנה"}
is_pct = lambda m: bool(re.search(r"ratio|_pct|payout|confidence|discount_rate|roe_reported|threshold", m))


def name(m):
    k, _, rest = m.partition(":")
    base = he.get(k) or EXTRA.get(k) or spell(k) or k.replace("_", " ")
    rest = rest.strip()
    return base + (f": {NOTE_HE.get(rest, rest)}" if rest else "")


def seg_he(s):
    """Hebrew name of a segment / sub-segment caption the extractor stored in English; an unknown one is kept as is (the gate flags it)."""
    s = s.strip()
    if s in SEG_HE or s in SEG_PART:
        return SEG_HE.get(s) or SEG_PART[s]
    parts = [x.strip() for x in s.split(" - ")]
    if len(parts) > 1 and all(x in SEG_PART for x in parts):
        return ": ".join(SEG_PART[x] for x in parts)
    return s


FILES = "https://mayafiles.tase.co.il/"
PDF = {int(r["report_id"]): FILES + r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
# the primary statements copied in full (spec v6): statement -> (report group, sheet title)
STATEMENTS = {"income": ("income", "רווח והפסד"), "oci": ("oci", "רווח כולל"), "balance": ("balance", "מאזן"), "cashflow": ("cashflow", "תזרים מזומנים")}
SUBTOTAL = re.compile(r"^(סך|סה)|^רווח( \(הפסד\))?,? (לפני מי?סים|לתקופה|לשנה|משירותי ביטוח$|מהשקעות ומימון|נטו מביטוח)|^(סך הכל |סה.כ )?רווח( \(הפסד\))? כולל")
STD_NOTE = {"IFRS 17": "IFRS 17 (מ-2024, לרבות מספרי השוואה שהוצגו מחדש)", "IFRS 4": "IFRS 4 (עד 2024)"}
def norm(t):
    """Row identity across reports. Wording drifts from report to report ("רווח (הפסד) לפני מיסים על ההכנסה", "רווח לפני מסים על הכנסה"),
    so the key drops bracketed alternatives, note letters, digits, the definite article and word order, and unifies a few spellings."""
    t = re.sub(r"^\d+\S*\s+", "", (t or "").strip())  # a note reference that leaked into the start of a label
    t = re.sub(r"\)([^()]*)\(", r"(\1)", t)  # brackets mirrored by the right-to-left text layer
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"[\"'״׳*().,:;\-–\d]", " ", t)
    t = re.sub(r"סה\s*כ|סך\s+ה?כו?ל", "סך", t)
    for a, b in (("הכול", "הכל"), ("עלייה", "עליה"), ("מיסים", "מסים"), ("פיננסיים", "פיננסים"), ("לשנה", "לתקופה"), ("השנה", "התקופה"), ("למניה", ""), ("בשח", "")):
        t = t.replace(a, b)
    key = " ".join(sorted(w.lstrip("ה") for w in t.split() if len(w.lstrip("ה")) > 1 and w not in ("של", "ש", "ח", "בת", "בנות")))
    return {"רווח": "לתקופה רווח", "נקי רווח": "לתקופה רווח", "לתקופה נקי רווח": "לתקופה רווח", "בעלים חברה": "בעלי חברה מניות"}.get(key, key)  # the bottom line is printed as "רווח", "רווח נקי" or "רווח לתקופה"


POOL = ThreadPoolExecutor(32)  # files on a network drive: read in parallel
# share counts: "מספר המניות ששימשו לחישוב הרווח למניה", "הממוצע המשוקלל של מספר המניות", or a bare "בסיסי" / "מדולל" under such a caption
SHARES = re.compile(r"מספר ה?מניות|ממוצע ה?משוקלל|הממוצע המשוקלל")
BARE_SHARES = re.compile(r"^(בסיסי|מדולל|בסיסי ומדולל|בדילול מלא)$")
# lines that are not flows: no fourth quarter or second half is derived for them (a balance, a count, a ratio, a per-share figure)
NONFLOW = re.compile(r"לתחילת|לסוף|^יתרת|יתרה ל|מספר ה?מניות|משוקלל|למניה|שיעור|יחס |באחוזים|%|באלפים")
PLACEHOLDER = re.compile(r"ללא (תווית|כותרת)")  # the extractor's caption for a printed line it could not read a caption for
BIDI = re.compile(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]")
PLACEHOLDERS = collections.Counter()


# ---- what the fact table needs from the merge (pipeline/build_facts.py): every print of every cell, kept beside the one picked ----
# cell tuple: (value, page, url, flags[, prints | derivation]); prints = ((report period end, value, page, url, step, plausible[, 4 if turned]), ...)
CAPS = {}  # (company, statement, standard, row key) -> every caption the row was printed under (and the captions of rows joined into it)
META = {}  # company -> {metric index: ("st", statement, standard, row key) | ("se", m, s, g, b)}
XFACTS = {}  # company -> {fact index: prints | ("D", op, year, part) | ("S", period, series cell) | None}


def _prints(prints, pick):
    """Every print of one cell, oldest report first: (report period end, value, page, url, step, plausible). A print is plausible when it can
    be the same line as the picked one: the rule applied between the first and the latest print (same sign and within a factor of two, a
    pure change of sign, or equal within the rounding of the two prints)."""
    b, sb = pick[1], pick[4]
    out = []
    for c in sorted(prints, key=lambda c: (c[0][1], c[2] or 0)):
        a, sa = c[1], c[4]
        tol = 0.5 * (sa + sb) + 0.5 * min(sa, sb)
        ok = abs(a - b) <= tol or bool(a and b and ((a * b > 0 and 0.5 <= b / a <= 2) or abs(a + b) <= tol))
        out.append((c[0][1], a, c[2], c[3], c[4], ok))
    return tuple(out)


def _join(cells, keep, drop):
    """Before two rows are joined: where both print a period, the kept row's cell stands and the dropped row's prints join its list, so a
    period first printed under the old wording keeps that first print."""
    a, b = cells.get(keep, {}), cells.get(drop, {})
    for pk in set(a) & set(b):
        ca, cb = a[pk], b[pk]
        if len(ca) > 4 and len(cb) > 4 and ca[4] and cb[4] and ca[4][0] != "D" and cb[4][0] != "D":
            have = {(q[0], q[3], q[2], q[1]) for q in ca[4]}
            more = tuple(q for q in cb[4] if (q[0], q[3], q[2], q[1]) not in have)
            a[pk] = ca[:4] + (tuple(sorted(ca[4] + more, key=lambda q: (q[0], q[2] or 0))),) + ca[5:]


def _merge_caps(comp, stmt, std, keep, drop):
    """Two rows joined into one (a reworded or renamed line): the kept row inherits the captions of the dropped one."""
    CAPS.setdefault((comp, stmt, std, keep), set()).update(CAPS.pop((comp, stmt, std, drop), set()))


def _turn(prints, when):
    """Prints of reports before the change of presentation, turned to the latest sign (the cell itself is turned the same way)."""
    return tuple((r, -v, p, u, s, ok, 4) if r < when else (r, v, p, u, s, ok, 0) for r, v, p, u, s, ok, *_ in prints)


# The caption of an unlabeled row is read from the page text on the Drive folder. Page texts never change once split, so the answers are
# cached; a page that cannot be read in FOX_DRIVE_WAIT seconds (Drive streaming stalled) is replayed from the published workbook: the row
# whose figures were printed on that page of that report with the same values (counted in REPLAYED and printed by the build).
CAPTION_CACHE = Path(os.environ.get("FOX_CACHE", Path.home() / ".cache" / "fox")) / "captions.json"
DRIVE_WAIT = float(os.environ.get("FOX_DRIVE_WAIT", "4"))
_CAPTIONS = {}
REPLAYED = []
_PUB = {}


def _published(comp):
    """The published workbook's statement figures of one company, by (url, page): {value: [labels]} (for replaying a caption)."""
    if comp not in _PUB:
        f = DATA / "companies" / f"{comp}.json"
        idx = {}
        if f.exists():
            d = json.loads(f.read_text(encoding="utf-8"))
            urls, M = d.get("urls") or [], d["metrics"]
            for x in d["facts"]:
                m = M[x[0]]
                if not m["sheet"].startswith("X.") or len(x) < 5 or x[4] is None:
                    continue
                idx.setdefault((urls[x[4]], x[3]), {}).setdefault(x[2], []).append(m["label"])
        _PUB[comp] = idx
    return _PUB[comp]


def _replay(comp, stem, page, values):
    f = ROOT / "data" / "extracted_fs" / comp / f"{stem}.json"
    try:
        rid = json.loads(f.read_text(encoding="utf-8")).get("report_id_he")
    except (OSError, ValueError):
        return None
    vals = _published(comp).get((PDF.get(rid), page), {})
    score = {}
    for v in (v for v in values if isinstance(v, (int, float))):
        for mult in (1, 1000):
            for lab in vals.get(v * mult, []):
                score[lab] = score.get(lab, 0) + 1
    if not score:
        return None
    best = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    return "" if best == "סך הכול" else best


def page_caption(comp, stem, doc, page, values):
    key = json.dumps([comp, stem, doc, page, [v for v in values if isinstance(v, (int, float))]], ensure_ascii=False)
    if key in _CAPTIONS:
        return _CAPTIONS[key]
    box = queue.Queue()
    threading.Thread(target=lambda: box.put(_page_caption(comp, stem, doc, page, values)), daemon=True).start()
    try:
        _CAPTIONS[key] = box.get(timeout=DRIVE_WAIT)
        return _CAPTIONS[key]
    except queue.Empty:
        REPLAYED.append(key)
        return _replay(comp, stem, page, values)


def _page_caption(comp, stem, doc, page, values):
    """The caption printed on the same line as the figures, read from the page text (data/work/<company>_<period>/<doc>/pNNN.txt).
    Returns None when the page text is missing or the line cannot be told apart (the row is then dropped), "" when the page prints the
    figures with no caption at all (an unlabeled sum), or the caption."""
    f = ROOT / "data" / "work" / f"{comp}_{stem}" / (doc or "he") / f"p{int(page or 0):03d}.txt"
    want = [abs(int(round(v))) for v in values if isinstance(v, (int, float))]
    if not page or not want or not f.exists():
        return None
    caps = set()
    for line in BIDI.sub("", f.read_text(encoding="utf-8")).splitlines():
        nums = [int(x.replace(",", "")) for x in re.findall(r"\d[\d,]*\d|\d", line)]
        if not any(nums[i:i + len(want)] in (want, want[::-1]) for i in range(len(nums) - len(want) + 1)):  # some text layers run the columns backwards
            continue
        t = re.sub(r"[()]*-?\d[\d,.]*[()]*", " ", line)
        t = re.sub(r"\)([^()]*)\(", r"(\1)", " ".join(t.split())).strip(" -")
        caps.add(t if re.search(r"[א-ת]", t) else "")
    if "" in caps:
        return ""
    return caps.pop() if len(caps) == 1 else None


def statements(comp):
    """Rows of each primary statement across all reports: {(statement, standard): (ordered row keys, row meta, cells)}.
    A cell is taken from the latest report that prints its period (flag 8 where that print restates the first one beyond rounding), unless the
    two prints are not plausibly the same line, when the first print stands. Q4 / H2 are derived only on flow lines, from one report's figures."""
    out = {}
    folder = ROOT / "data" / "extracted_fs" / comp
    files = sorted(folder.glob("*.json"), key=lambda f: (f.stem[:4], END[f.stem[4:]], f.stem[4:] == "FY")) if folder.exists() else []
    docs = list(POOL.map(lambda f: json.loads(f.read_text(encoding="utf-8")), files))
    for f, d in reversed(list(zip(files, docs))):  # newest first: its row order is the backbone
        if d.get("report_id_he") in OTHER_ENTITY.get(comp, ()):
            continue
        own, url = f"{f.stem[:4]}-{END[f.stem[4:]]}", PDF.get(d.get("report_id_he"))
        mult = 1000 if re.search(r"million|מיליוני", str(d.get("unit") or "")) else 1
        for st in d["statements"]:
            if st["statement"] not in STATEMENTS:
                continue
            order, meta, cells = out.setdefault((st["statement"], d.get("standard") or "IFRS 4"), ([], {}, {}))
            section, seen, prev, per_share, share_hdr = "", {}, None, False, None
            for r in st["rows"]:
                raw = " ".join((r.get("label") or "").split())
                has = any(isinstance(v, (int, float)) for v in r.get("values") or [])
                if PLACEHOLDER.search(raw):
                    cap = page_caption(comp, f.stem, d.get("doc"), r.get("page"), r.get("values") or [])
                    PLACEHOLDERS[(comp, "dropped" if cap is None else "sum" if cap == "" else "caption")] += 1
                    if cap is None:
                        continue  # no page text to read the caption from: the row is left out rather than shown without one
                    r, raw = {**r, "label": cap}, cap
                if not raw:
                    if r.get("header") or not has:
                        continue  # an empty caption or an empty line
                    r = {**r, "label": "סך הכול", "total": True}  # a sum printed under its section with no caption of its own
                    raw = r["label"]
                # per-share lines are printed in NIS whatever the unit of the statement: from the first "למניה" caption to the end
                # of the income statement (or to the comprehensive-income part, where one statement carries both)
                lab = norm(r["label"]) or f"שורה ללא כותרת {r.get('page')}"
                if "למניה" in raw and "מספר" not in raw:  # a count of shares "used for earnings per share" is not a per-share figure
                    per_share = True
                elif per_share and ("כולל" in raw or "מספר" in raw or any(k[1] == lab and not m["eps"] and not m["header"] for k, m in meta.items())
                                    or any(isinstance(v, (int, float)) and abs(v) >= 5000 for v in r.get("values") or [])):
                    per_share = False  # the statement went on to something else: comprehensive income, share counts, or a second block of the same lines
                if r.get("header"):
                    section = lab
                    share_hdr = raw if SHARES.search(raw) else None
                shares = not r.get("header") and bool(SHARES.search(raw) or (share_hdr and BARE_SHARES.match(raw)))
                occ = seen[(section, lab)] = seen.get((section, lab), 0) + 1
                key = (section if not r.get("header") else "", lab, occ)
                if r.get("header") and lab in ("ליום", ""):
                    continue  # the date caption of the column block, not a section
                if key not in meta:
                    shown = re.sub(r"\)([^()]*)\(", r"(\1)", re.sub(r"^\d+\S*\s+", "", " ".join(r["label"].split()))).replace("לשנה", "לתקופה").replace(" ,", ",")  # a stray note reference; one row serves quarters and years
                    meta[key] = {"label": shown, "header": bool(r.get("header")), "total": bool(r.get("total")) or bool(SUBTOTAL.match(shown)),
                                 "eps": per_share and not r.get("header") and "מספר" not in raw and not shares, "shares": shares}
                    order.insert(order.index(prev) + 1 if prev in order else 0, key)
                prev = key
                CAPS.setdefault((comp, st["statement"], d.get("standard") or "IFRS 4", key), set()).add(" ".join(r["label"].split()))
                # a share count is stored in shares: printed in thousands when the caption says so ("באלפים") or, as the statements of a
                # company with tens of millions of shares print it, when the figure is below a million; never scaled by the money unit
                big = max([abs(v) for v in r.get("values") or [] if isinstance(v, (int, float))] or [0])
                scale = 1000 if "באלפים" in raw or "באלפים" in (share_hdr or "") or big < 1e6 else 1
                for c, v in zip(st["columns"], r.get("values") or []):
                    if not isinstance(v, (int, float)):
                        continue
                    date, w = c["date"], c["window"]
                    typ = "I" if w == "instant" else "FY" if w == "fy" else "Q" if w == "q" or date[5:7] == "03" else "H" if date[5:7] == "06" else "9M"
                    val, step = (v * scale, scale) if shares else (v, 0.01) if per_share else (v * mult, mult)
                    cells.setdefault(key, {}).setdefault((typ, date), []).append(((date != own, own), val, r.get("page"), url, step))
    RESTATED[comp] = []
    for (stmt, std), (order, meta, cells) in out.items():
        turned, source, printed = {}, {}, {}
        for key, by in cells.items():
            for pk in by:
                # a period printed again by a later report with another figure: as first reported against the latest print.
                # Kept only when the two are plausibly the same line (same sign and within a factor of two, or the sign alone flipped).
                first, latest = min(by[pk], key=lambda c: c[0]), max(by[pk], key=lambda c: c[0][1])
                a, b = first[1], latest[1]
                tol = 0.5 * (first[4] + latest[4]) + 0.5 * min(first[4], latest[4])  # rounding of the two prints (thousands, millions, agorot)
                same = bool(a and b and ((a * b > 0 and 0.5 <= b / a <= 2) or abs(a + b) <= tol))
                if abs(a - b) > 1.5 and a and b and ((a * b > 0 and 0.5 <= b / a <= 2) or abs(a + b) < 0.5):
                    RESTATED[comp].append([f"X.{STATEMENTS[stmt][1].replace(' ', '_')}", std, meta[key]["label"], pk[0], pk[1], a, first[2], first[3], b, latest[2], latest[3], latest[0][1]])
                # the opposite sign with (nearly) the same size: a change of presentation, not of substance. A restated comparative may differ a little.
                mirror = [c for c in by[pk] if c[1] * first[1] < 0 and abs(abs(c[1]) - abs(first[1])) <= max(0.5, 0.05 * abs(first[1]))]
                if mirror and abs(first[1]) > 1.5:
                    # the first report that printed this period with the opposite sign: from that report on the line is presented the other way round
                    turned.setdefault(key, []).append(min(c[0][1] for c in mirror))
                # the cell shows the latest print (one vintage across the row) when it is plausibly the same line; otherwise the first stands.
                # Flag 8: the latest print differs from the first by more than rounding (a pure change of sign is a presentation, flag 4).
                pick = latest if (same or abs(a - b) <= tol) else first
                restated = pick is latest and abs(a - b) > tol and abs(a + b) > tol
                source[(key, pk)] = pick[0][1]
                printed[(key, pk)] = by[pk]
                by[pk] = (pick[1], pick[2], pick[3], 8 if restated else 0, _prints(by[pk], pick))
        # A line whose sign convention changed (interest paid shown positive, later in brackets) reads in the latest convention throughout:
        # figures taken from reports before the change are turned, and flagged (4), so a series does not flip half way.
        for key, when in turned.items():
            for pk, c in cells.get(key, {}).items():
                if source[(key, pk)] < min(when):
                    cells[key][pk] = (-c[0], c[1], c[2], (c[3] if len(c) > 3 else 0) | 4) + tuple(c[4:])
        for key, when in turned.items():
            for pk, c in cells.get(key, {}).items():
                if len(c) > 4:
                    cells[key][pk] = c[:4] + (_turn(c[4], min(when)),)
        # A line printed as "הכנסות (הוצאות) אחרות" in one report and "הוצאות אחרות" in another is one line:
        # the bracketed wording and the plain alternative are joined, under the newest wording.
        for key in list(order):
            m = re.match(r"^(\S+) \(([^)]+)\),? (.+)$", meta.get(key, {}).get("label", ""))
            if not m or key not in meta:
                continue
            twin = (key[0], norm(f"{m.group(2)} {m.group(3)}"), key[2])
            if twin == key or twin not in meta or meta[twin]["header"]:
                continue
            # where a later report reprints an earlier period under the new wording, the newest wording's figure stands
            keep, drop = (key, twin) if order.index(key) < order.index(twin) else (twin, key)
            _join(cells, keep, drop); cells[keep] = {**cells.pop(drop, {}), **cells.get(keep, {})}; _merge_caps(comp, stmt, std, keep, drop)
            order.remove(drop)
            del meta[drop]
        # A line the company renamed: the old name and the new name print the same figures wherever a later report repeats an earlier
        # period, and each has periods the other lacks. They are one line, under the newest name.
        # The same holds for two differently named lines that agree in three or more periods (a comparative reprinted under the new name).
        for _ in range(3):  # a merge can bring two more lines into agreement: repeat until nothing is left
            plain = [k for k in order if not meta[k]["header"] and not meta[k]["total"] and not meta[k].get("eps") and not meta[k].get("shares")]
            for i, a in enumerate(plain):
                for b in plain[i + 1:]:
                    if a not in meta or b not in meta:
                        continue
                    ca, cb = cells.get(a, {}), cells.get(b, {})
                    both = set(ca) & set(cb)
                    renamed = len(both) >= 2 and set(ca) - set(cb) and set(cb) - set(ca)  # each name has periods of its own
                    agree = all(abs(ca[p][0] - cb[p][0]) < 0.6 for p in both)
                    # the same caption under two section captions (a statement printed in blocks, or a caption reworded) is one line unless the two
                    # ever print different figures for one period, which is what marks a caption the statement really repeats
                    same_name = a[1] == b[1] and agree and bool(ca) and bool(cb)
                    if same_name or (((renamed and a[0] == b[0]) or len(both) >= 3) and agree and any(abs(ca[p][0]) > 0.6 for p in both)):
                        _join(cells, a, b); cells[a] = {**cb, **ca}; _merge_caps(comp, stmt, std, a, b)
                        cells.pop(b, None)
                        order.remove(b)
                        del meta[b]
            # a total printed under a section the company renamed ("סה"כ הכנסות" under "הכנסות" until 2022, under "הכנסות ורווחים" after):
            # the same caption, periods that barely overlap and agree where they do, is one line. Totals that share most periods (the two
            # attribution blocks, profit and comprehensive income) stay apart.
            tots = [k for k in order if meta[k]["total"] and not meta[k]["header"]]
            for i, a in enumerate(tots):
                for b in tots[i + 1:]:
                    if a not in meta or b not in meta or a[1] != b[1] or a[0] == b[0]:
                        continue
                    ca, cb = cells.get(a, {}), cells.get(b, {})
                    both = set(ca) & set(cb)
                    if min(len(ca), len(cb)) >= 4 and len(both) <= 0.25 * min(len(ca), len(cb)) and all(abs(ca[p][0] - cb[p][0]) < 0.6 for p in both):
                        keep, drop = (a, b) if max(e for _, e in ca) >= max(e for _, e in cb) else (b, a)  # under the newer section
                        _join(cells, keep, drop); cells[keep] = {**cells.pop(drop, {}), **cells.get(keep, {})}; _merge_caps(comp, stmt, std, keep, drop)
                        order.remove(drop)
                        del meta[drop]
        if stmt == "balance":
            continue
        def same_print(key, pk, part):
            """The annual figure as printed by the report the part-year figure came from, when that report prints both: a year from one report
            less nine months from another mixes a restated figure with an unrestated one."""
            rep_end = source.get((key, part))
            prints = printed.get((key, pk), [])
            c = next((c for c in prints if c[0][1] == rep_end), None)
            if c is None and rep_end is not None:
                # the part's report does not print the year (a nine months' report never does): the year as first printed after it, so a
                # restatement printed later (a comparative column of the next year's report) is not netted against the unrestated part
                later = [c for c in prints if c[0][1] >= rep_end]
                c = min(later, key=lambda c: c[0][1]) if later else None
            flipped = key in turned and rep_end is not None and rep_end < min(turned[key])
            return None if c is None else ((-c[1] if flipped else c[1]), c[2], c[3])

        for key, by in cells.items():
            m = meta.get(key, {})
            if m.get("header") or m.get("eps") or m.get("shares") or NONFLOW.search(m.get("label", "")) or NONFLOW.search(key[0]):
                continue  # not a flow: a year less nine months means nothing for an opening balance, a share count or a per-share figure
            for (typ, date), fy in list(by.items()):  # the fourth quarter is not printed: the year less nine months, flagged as derived
                p9, ph = ("9M", date[:4] + "-09-30"), ("H", date[:4] + "-06-30")
                n9 = by.get(p9)
                if typ == "FY" and n9 and ("Q", date) not in by:
                    year = same_print(key, (typ, date), p9) or (fy[0], fy[1], fy[2])  # the year as printed by the nine months' own report
                    by[("Q", date)] = (round(year[0] - n9[0], 3), year[1], year[2], 1, ("D", "FY-9M", (typ, date, year[0], year[2]), ("9M", p9[1], n9[0], n9[2])))
                h1 = by.get(ph)
                if typ == "FY" and h1 and ("H", date) not in by:  # the second half, likewise: the year less the first half
                    year = same_print(key, (typ, date), ph) or (fy[0], fy[1], fy[2])
                    by[("H", date)] = (round(year[0] - h1[0], 3), year[1], year[2], 1, ("D", "FY-H1", (typ, date, year[0], year[2]), ("H", ph[1], h1[0], h1[2])))
    return out


# Filings whose extracted statements belong to another entity than the company page shows: Yelin Lapidot's four 2023 filings are listed
# under Atrao Capital Markets, and the statements read from them are Atrao's own (page 18 of report 1559780 is headed "אטראו שוקי הון בע"מ";
# fee income "הכנסות מעמלות", pretax about NIS 18m a quarter against Yelin's 50m+). Yelin's own 2023 figures come from the 2024 reports'
# comparative columns. Found by pipeline/check_consistency.py (company page and statements disagreed for Q4'23 pretax).
OTHER_ENTITY = {"yelin": {1525737, 1545177, 1559780, 1583350}}
RESTATED = {}
ROLE_MI = {}  # company -> {role: metric index}
# The lines every insurer prints under some wording: (key, name on screen, sheet, pattern over the caption with "סך הכל" / סה"כ reduced to "סך").
# The first matching line of a sheet is taken: the IFRS 17 section comes first, and its common lines already run back through IFRS 4.
ROLES = [
    ("ins_rev", "הכנסות משירותי ביטוח", "X.רווח_והפסד", r"^הכנסות משירותי ביטוח"),
    ("ins_exp", "הוצאות משירותי ביטוח", "X.רווח_והפסד", r"^הוצאות משירותי ביטוח"),
    ("ins_res", "רווח משירותי ביטוח", "X.רווח_והפסד", r"^(רווח|תוצאות)( \(הפסד\))? משירותי ביטוח$"),
    ("inv_fin", "רווח מהשקעות ומימון, נטו", "X.רווח_והפסד", r"^רווח( \(הפסד\))? מהשקעות ומימון,? ?נטו"),
    ("gpe", "פרמיות שהורווחו ברוטו (IFRS 4)", "X.רווח_והפסד", r"^פרמיות שהורווחו ברוטו"),
    ("npe", "פרמיות שהורווחו בשייר (IFRS 4)", "X.רווח_והפסד", r"^פרמיות שהורווחו בשייר"),
    ("total_rev", "סך ההכנסות (במבטחות: IFRS 4)", "X.רווח_והפסד", r"^סך (כל )?ה?הכנסות$"),
    ("op_profit", "רווח תפעולי (בתי השקעות)", "X.רווח_והפסד", r"^רווח( \(הפסד\))? (תפעולי|מפעולות)"),
    ("claims_net", "תשלומים ושינוי בהתחייבויות, בשייר (IFRS 4)", "X.רווח_והפסד", r"^תשלומים ושינוי בהתחייבויות.*בשייר"),
    ("commissions", "עמלות, שיווק ורכישה (IFRS 4)", "X.רווח_והפסד", r"^עמלות,? ?(ו)?הוצאות (שיווק|רכישה)"),
    ("ga", "הנהלה וכלליות (IFRS 4)", "X.רווח_והפסד", r"^הוצאות הנהלה וכלליות"),
    ("fees", "הכנסות מדמי ניהול", "X.רווח_והפסד", r"^הכנסות מדמי ניהול"),
    ("opex", "הוצאות תפעוליות אחרות", "X.רווח_והפסד", r"^הוצאות תפעוליות אחרות"),
    ("pbt", "רווח לפני מס", "X.רווח_והפסד", r"^רווח( \(הפסד\))? לפני מי?סים על ה?הכנסה"),
    ("tax", "מסים על ההכנסה", "X.רווח_והפסד", r"^מי?סים על ה?הכנסה"),
    ("np", "רווח לתקופה", "X.רווח_והפסד", r"^(רווח|הפסד)( נקי)?( \(הפסד\))?( נקי)? לתקופה$|^רווח נקי( \(הפסד\))?$"),
    ("np_attr", "רווח לבעלי המניות", "X.רווח_והפסד", r"^ל?בעלי(ם)? (ה)?(מניות )?של (ה)?חברה|^ל?בעלי(ם)? (ה)?(מניות )?של חברת (ה)?אם|^בעלי המניות$"),
    ("eps", "רווח בסיסי למניה (ש\"ח)", "X.רווח_והפסד", r"^רווח( נקי)?( \(הפסד\))? בסיסי( ומדולל)? למניה|^רווח מפעילויות נמשכות למניה|^רווח למניה רגילה|^בסיסי$"),
    ("total_assets", "סך הנכסים", "X.מאזן", r"^סך (כל )?ה?נכסים$"),
    ("equity_attr", "הון לבעלי המניות", "X.מאזן", r"^סך (כל )?ה?הון המיוחס לבעלי"),
    ("total_equity", "סך ההון", "X.מאזן", r"^סך (כל )?ה?הון$"),
    ("total_liab", "סך ההתחייבויות", "X.מאזן", r"^סך (כל )?ה?התחייבויות$"),
    ("ins_liab", "התחייבויות בגין חוזי ביטוח", "X.מאזן", r"^התחייבויות בגין חוזי ביטוח$"),
    ("intangibles", "נכסים בלתי מוחשיים", "X.מאזן", r"^נכסים בלתי מוחשיים"),
    ("cash", "מזומנים ושווי מזומנים אחרים", "X.מאזן", r"^מזומנים ושווי מזומנים אחרים"),
    ("cfo", "מזומנים נטו מפעילות שוטפת", "X.תזרים_מזומנים", r"מזומנים נטו.*(מ|ל)פעילות שוטפת"),
    ("cfi", "מזומנים נטו מפעילות השקעה", "X.תזרים_מזומנים", r"מזומנים נטו.*(מ|ל)פעילות השקעה"),
    ("cff", "מזומנים נטו מפעילות מימון", "X.תזרים_מזומנים", r"מזומנים נטו.*(מ|ל)פעילות מימון"),
    ("div_paid", "דיבידנד ששולם", "X.תזרים_מזומנים", r"^דיבידנד (ששולם|לבעלי)"),
]


def caption(t):
    t = re.sub(r"[\"'״׳*]", "", t)
    return re.sub(r"\s+", " ", re.sub(r"סה\s*כ|סך\s+ה?כו?ל", "סך", t)).strip()

registry = json.loads((ROOT / "data" / "registry" / "companies.json").read_text(encoding="utf-8"))
names = {c["id"]: c["name_he"] for c in (registry if isinstance(registry, list) else registry.get("companies", []))}
# every company with extracted lines (the series of the insurers) or with full statements (insurers and fund houses)
COMPANIES = sorted({f.stem for f in (DATA / "series").glob("*.json") if f.stem != "index"} | {p.name for p in (ROOT / "data" / "extracted_fs").iterdir() if p.is_dir() and any(p.glob("*.json"))})


def merge(log=print):
    """The extraction merge: every company's workbook as the site serves it ({company: workbook}), with what the fact table needs kept
    beside it in CAPS, META and XFACTS (every print of every statement cell, derivation inputs, captions). Writes nothing:
    pipeline/build_facts.py builds the fact table from it and writes companies/<id>.json from the table (docs/FACTS.md, migration step 1)."""
    for x in (CAPS, META, XFACTS, RESTATED, ROLE_MI, PLACEHOLDERS):
        x.clear()
    del REPLAYED[:]
    try:
        _CAPTIONS.update(json.loads(CAPTION_CACHE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    n0 = len(_CAPTIONS)
    wbs = {}
    for comp in COMPANIES:
        sf = DATA / "series" / f"{comp}.json"
        series = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else {"rows": []}
        base_f = ROOT / "data" / "workbook_base" / f"{comp}.json"  # the spreadsheet-based workbook, kept aside so this script can be rerun
        live_f = DATA / "companies" / f"{comp}.json"
        if comp == "phoenix" and not base_f.exists() and live_f.exists():
            base_f.write_text(live_f.read_text(encoding="utf-8"), encoding="utf-8")
        base = json.loads(base_f.read_text(encoding="utf-8")) if base_f.exists() else None
        d = base or {"company": comp, "sources": [], "groups": {}, "sheets": [], "periods": [], "metrics": [], "facts": [], "stats": {}}
        d["groups"] = {**GROUP_LABELS, **d.get("groups", {})}
        for m in d["metrics"]:  # the published spreadsheet tags a sum the report prints without a caption, and describes it: keep the description
            if m["label"].startswith("[ללא כותרת בדוח]"):
                m["label"], m["total"] = m["label"][len("[ללא כותרת בדוח]"):].strip(), True
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

        def pid(typ, end):
            k = f"{typ}{end}"
            if k not in pidx:
                pidx[k] = len(d["periods"])
                d["periods"].append({"id": k, "label": k, "type": typ, "end": end, "months": {"FY": 12, "Q": 3, "H": 6, "9M": 9, "I": 0}[typ]})
            return pidx[k]

        fs = statements(comp)
        for stmt, (grp, title) in STATEMENTS.items():
            parts = [(std, fs[(stmt, std)]) for std in ("IFRS 17", "IFRS 4") if (stmt, std) in fs]
            if not parts:
                continue
            code = f"X.{title.replace(' ', '_')}"
            d["sheets"].append({"code": code, "entity": "F", "title": title, "pages": "", "group": grp})
            if not any(s["entity"] == "F" for s in d["sources"]):
                d["sources"].append({"entity": "F", "name": ENTITY_NAMES["F"], "doc": "הדוחות התקופתיים של " + names.get(comp, comp), "url": None, "pages": None})
            if len(parts) == 2:
                # a row that exists once under each standard with the same name (profit for the period, taxes, total assets, equity) is one line:
                # the periods before the IFRS 17 comparatives are filled from the IFRS 4 statement as originally reported, and marked
                (o17, m17, c17), (o4, m4, c4) = parts[0][1], parts[1][1]

                def nth(order, meta):
                    """(name, ordinal among the rows of that name) -> row; and how many rows carry each name"""
                    seen, out = {}, {}
                    for k in order:
                        if not meta[k]["header"]:
                            seen[k[1]] = seen.get(k[1], 0) + 1
                            out[(k[1], seen[k[1]])] = k
                    return out, seen

                (new, n17), (old, n4) = nth(o17, m17), nth(o4, m4)
                # the same name the same number of times in both statements; the bottom lines of the income statement by their first appearance
                bottom = {norm(x) for x in ("רווח לתקופה", "בעלי המניות של החברה", "זכויות שאינן מקנות שליטה", "סך הכל הכנסות", "סך הכל הוצאות")} if stmt == "income" else set()
                new = {k: v for k, v in new.items() if n17[k[0]] == n4.get(k[0]) or (k[0] in bottom and k[1] == 1 and k in old)}
                for lab in new.keys() & old.keys():
                    have = c17.setdefault(new[lab], {})
                    for pk, c in c4.get(old[lab], {}).items():
                        if pk not in have:
                            have[pk] = (c[0], c[1], c[2], (c[3] if len(c) > 3 else 0) | 2) + tuple(c[4:])
            n = 0
            for std, (order, meta, cells) in parts:
                if len(parts) > 1:
                    d["metrics"].append({"entity": "F", "sheet": code, "group": grp, "label": STD_NOTE[std], "unit": "k", "header": True, "order": n, "std": True})
                    n += 1
                for key in order:
                    m, mi = meta[key], len(d["metrics"])
                    unit = "shares" if m.get("shares") else "nis" if (m.get("eps") or "למניה" in m["label"]) and "מספר" not in m["label"] else "k"
                    d["metrics"].append({"entity": "F", "sheet": code, "group": grp, "label": m["label"], "unit": unit, "header": m["header"], "order": n, **({"total": True} if m["total"] else {})}); META.setdefault(comp, {})[mi] = ("st", stmt, std, key)
                    n += 1
                    for (typ, date), c in cells.get(key, {}).items():
                        v, page, u = c[0], c[1], c[2]
                        if u and u not in uidx:
                            uidx[u] = len(urls)
                            urls.append(u)
                        d["facts"].append([mi, pid(typ, date), v, page, uidx.get(u) if u else None] + ([c[3]] if len(c) > 3 and c[3] else [])); XFACTS.setdefault(comp, {})[len(d["facts"]) - 1] = c[4] if len(c) > 4 else None

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
                dim = " · ".join(x for x in (seg_he(r["s"].split(":", 1)[1].strip() if ":" in r["s"] else r["s"]) if r["s"] != r["g"] else "", BASIS.get(r["b"], "")) if x)
                mi = len(d["metrics"])
                pct = is_pct(r["m"])
                d["metrics"].append({"entity": ent, "sheet": code, "group": grp, "label": name(r["m"]), "dim": dim, "unit": "pct" if pct else "k", "header": False, "order": order}); META.setdefault(comp, {})[mi] = ("se", r["m"], r["s"], r["g"], r["b"])
                for per, c in r["vals"].items():
                    if per.endswith("FY") and not flow:
                        continue  # a balance at year-end is already the Q4 column
                    if c.get("der") and (pct or not flow):
                        continue  # a ratio or a balance has no "year less nine months"
                    u = c.get("u")
                    if u and u not in uidx:
                        uidx[u] = len(urls)
                        urls.append(u)
                    d["facts"].append([mi, period(per, flow), c["v"] if pct else round(c["v"] * 1000, 3), c.get("pg"), uidx.get(u) if u else None] + ([1] if c.get("der") else [])); XFACTS.setdefault(comp, {})[len(d["facts"]) - 1] = ("S", per, c)
        def uix(u):
            if u and u not in uidx:
                uidx[u] = len(urls)
                urls.append(u)
            return uidx.get(u) if u else None

        # [sheet, standard, line, period type, period end, as first reported, page, url, as last printed, page, url, period end of the report that reprinted it]
        d["restated"] = [[r[0], r[1], r[2], r[3], r[4], r[5], r[6], uix(r[7]), r[8], r[9], uix(r[10]), r[11]] for r in RESTATED.get(comp, []) if r[3] != "9M"]
        d["urls"] = urls
        # the lines every insurer prints, picked by caption, for the cross-company chart
        facts_of = {}
        for x in d["facts"]:
            facts_of.setdefault(x[0], []).append(x)
        for key, _, sheet, pat in ROLES:
            # among the rows whose caption matches, the one that runs to the latest period (a caption renamed in later reports leaves its old
            # row with history only); a tie goes to the first in the statement (the IFRS 17 section, the line before its breakdown)
            cand = [i for i, m in enumerate(d["metrics"]) if m["sheet"] == sheet and not m["header"] and m["unit"] != "shares" and (key != "eps" or m["unit"] == "nis")
                    and re.search(pat, caption(m["label"])) and len(facts_of.get(i, [])) >= 4]
            cand = [i for i in cand if not (key == "div_paid" and "שאינן מקנות" in d["metrics"][i]["label"])]  # the dividend to minorities is another line
            mi = max(cand, key=lambda i: (max(d["periods"][x[1]]["end"] for x in facts_of[i]), -i)) if cand else None
            if mi is None:
                continue
            d["metrics"][mi]["role"] = key  # the statements page links this row to the same line of every company
            ROLE_MI.setdefault(comp, {})[key] = mi
        wbs[comp] = d
        log(comp, len(d["sheets"]), "sheets,", len(d["metrics"]), "lines,", len(d["facts"]), "facts,", len(d["periods"]), "periods")
    if len(_CAPTIONS) != n0:
        try:
            CAPTION_CACHE.parent.mkdir(parents=True, exist_ok=True)
            CAPTION_CACHE.write_text(json.dumps(_CAPTIONS, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    log("unlabeled rows (caption read from the page / printed sum without caption / dropped, no page text):", dict(PLACEHOLDERS))
    return wbs


def side_outputs(wbs):
    """search/rows.json (every line of the sheets built from the reports, once per sheet and wording) and lines.json (the lines every
    insurer prints, for the cross-company chart: the row the merge gave each role, its current figures)."""
    rows = []
    lines = {"roles": [[k, n, sh] for k, n, sh, _ in ROLES], "periods": [], "urls": [], "data": {k: {} for k, *_ in ROLES}}
    lp, lu = {}, {}
    for comp, d in wbs.items():
        seen = set()
        for i, m in enumerate(d["metrics"]):
            if not m["header"] and m["sheet"].startswith("X.") and (m["sheet"], m["label"], m.get("dim")) not in seen:
                seen.add((m["sheet"], m["label"], m.get("dim")))
                rows.append([comp, m["sheet"], m["label"] + (f" · {m['dim']}" if m.get("dim") else ""), i])
        facts_of = {}
        for x in d["facts"]:
            facts_of.setdefault(x[0], []).append(x)
        for key, *_ in ROLES:
            mi = ROLE_MI.get(comp, {}).get(key)
            if mi is None:
                continue
            cells = []
            for x in facts_of[mi]:
                p = d["periods"][x[1]]
                if p["type"] == "9M":
                    continue
                pi = lp.setdefault((p["type"], p["end"]), len(lp))
                u = d["urls"][x[4]] if len(x) > 4 and x[4] is not None else None
                cells.append([pi, x[2], x[3], lu.setdefault(u, len(lu)) if u else None, x[5] if len(x) > 5 else 0])
            lines["data"][key][comp] = {"label": d["metrics"][mi]["label"], "unit": d["metrics"][mi]["unit"], "cells": cells}
    lines["periods"] = [list(k) for k, _ in sorted(lp.items(), key=lambda kv: kv[1])]
    lines["urls"] = [u for u, _ in sorted(lu.items(), key=lambda kv: kv[1])]
    return rows, lines


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def write(wbs, rows, lines, log=print):
    """companies/<id>.json, search/rows.json, lines.json; returns the files whose bytes changed."""
    changed = []

    def put(f, text):
        if not f.exists() or f.read_text(encoding="utf-8") != text:
            f.write_text(text, encoding="utf-8")
            changed.append(str(f.relative_to(DATA)))
    for comp, d in wbs.items():
        put(DATA / "companies" / f"{comp}.json", dump(d))
    (DATA / "search").mkdir(exist_ok=True)
    put(DATA / "search" / "rows.json", dump(rows))
    put(DATA / "lines.json", dump(lines))
    log(len(rows), "statement lines indexed for search; cross-company lines:", {k: len(v) for k, v in lines["data"].items()})
    return changed


if __name__ == "__main__":
    # the workbooks are written from the fact table: one build writes companies/, search/rows.json, lines.json and facts/
    import build_facts
    sys.exit(build_facts.build())
