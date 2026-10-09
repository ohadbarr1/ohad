# Extraction spec v1: one filing -> one JSON

Input: a quarterly or annual report of an Israeli insurance group, split to per-page text
(`he/pNNN.txt` binding Hebrew version, `en/pNNN.txt` convenience translation when it exists).
Page numbers are 1-based PDF pages of each file.

Output: `data/extracted/<company>/<period>.json`

```json
{"company": "harel", "period": "2026Q2", "report_id_he": 1766123, "unit": "NIS millions",
 "facts": [{"metric": "csm_closing", "segment": "life", "basis": "net", "window": "instant",
            "date": "2026-06-30", "value": 5952, "page_he": 31, "page_en": 33,
            "label": "exact row label as printed", "source": "table", "note": ""}],
 "not_found": [{"metric": "...", "segment": "...", "why": "not disclosed / ambiguous"}]}
```

Rules
1. Copy numbers exactly as printed, converted to NIS millions (the reports print NIS millions or NIS thousands; say which in `note` if thousands). Negative as negative.
2. Never calculate, sum, difference or infer. If a figure is not printed, put the metric in `not_found`.
3. `window`: `instant` (balance), `q` (three months), `ytd` (cumulative from 1 January), `fy`. Report every window that is printed for the current period; also the same windows for the comparative prior-year period (set `date` to the period end).
4. `basis`: `gross`, `net` (of reinsurance), or `na`. State what the table says; if the table does not say, use `na` and explain in `note`.
5. `segment`: `group`, `life` (life and long-term savings), `health`, `pc` (general insurance), `pension_gemel`, `other`, or a sub-segment name as printed.
6. `page_he` is mandatory and must be the page where the number is printed in the Hebrew file. Verify every value against the Hebrew page, even if you found it first in English.
7. If the same metric appears in two places with different values, report both and explain in `note`.
8. `source`: `table` (a printed table), `text` (a sentence), or `chart` (read from a chart or its labels). Chart readings are allowed only when the label-to-series mapping is unambiguous; otherwise put the metric in `not_found`.
9. Ranges and targets: set `value` to null and add `value_low` and `value_high`; put the target year and the sentence in `note`.
10. Dividends: `dividend_declared` is the amount recognised in the statement of changes in equity for the window; `dividend_paid` is cash paid per the cash flow statement. Report both when printed. A dividend declared after the balance sheet date is `dividend_declared_after_period`.
11. CSM basis: record `gross` or `net` exactly as the table header states; when the roll-forward table does not say, use `na` and quote the header in `note`.
12. Opening balances use the opening date in `date` and `window: instant`.

Metrics (take all that are printed)
- Group: `profit_attributable`, `comprehensive_income_attributable`, `comprehensive_income_before_tax`, `equity_attributable`, `total_assets`, `dividend_paid`, `dividend_declared`, `roe_reported`, `aum_total`, `insurance_revenue`, `insurance_service_result`, `net_investment_and_finance_result`
- Per segment (life, health, pc): `insurance_revenue`, `insurance_service_result`, `comprehensive_income_before_tax`, `gross_written_premiums`
- CSM per segment and total: `csm_opening`, `csm_new_business`, `csm_interest_accretion`, `csm_changes_in_estimates`, `csm_release`, `csm_closing`
- `risk_adjustment` per segment, `loss_component` per segment
- New business: `new_business_annualized_premiums` per segment
- P&C: `combined_ratio`, `loss_ratio` (as printed, with the definition in `note`)
- Solvency (insurer subsidiary): `solvency_ratio_with_transitional`, `solvency_ratio_without_transitional`, `solvency_surplus`, `solvency_date`
- Asset management: `management_fees`, `pension_gemel_profit_before_tax`, `aum_pension`, `aum_gemel`
- Management targets, if stated: `target_*` with the text in `note`

## v2 additions (annual reports and IFRS 17 notes)

File layout for a filing with more than one text folder: each fact carries `"doc": "<folder name>"` (for example `he_1731047`) next to `page_he`; `page_he` is the 1-based page inside that folder. `page_en` refers to the English folder when one exists.

For an annual report the windows are `fy` (the year) and `instant` (31 December); also take the prior-year comparatives printed beside them.

IFRS 17 notes: take every row of these tables, per segment (life / health / pc, or the portfolio names as printed) and in total, and for direct contracts (`basis: gross`), reinsurance held (`basis: reinsurance`) and net when printed:
- CSM roll-forward: `csm_opening`, `csm_new_business` (contracts initially recognised), `csm_interest_accretion`, `csm_changes_in_estimates` (changes that adjust the CSM), `csm_experience_adjustments`, `csm_release` (recognised in profit or loss for services provided), `csm_fx_and_other`, `csm_closing`. If the table has a row that does not fit, keep it as `csm_other:<row label>`.
- By measurement model when the table is split that way: put `GMM`, `VFA` or `PAA` in `"model"`.
- By transition approach when printed: `"transition"`: `full_retrospective`, `modified_retrospective`, `fair_value`, `post_transition`.
- `risk_adjustment` opening / release / closing: `ra_opening`, `ra_release`, `ra_closing`.
- `loss_component` closing and the charge for the year: `loss_component`, `losses_on_onerous_contracts`.
- Insurance revenue analysis: `rev_expected_claims_and_expenses`, `rev_ra_release`, `rev_csm_release`, `rev_acquisition_cashflow_recovery`, `rev_paa`, `insurance_revenue`.
- Expected recognition of the CSM in future periods: `csm_expected_release` with the time bucket as printed in `"bucket"` (for example `up to 1 year`, `1-2 years`, `over 10 years`).
- Insurance finance income or expense: `insurance_finance_result` (profit or loss) and `insurance_finance_oci`.
- Sensitivity tables: `sensitivity:<shock as printed>` with the effect on profit / comprehensive income / CSM in `"effect_on"`.
- Discount curves: `discount_rate` with the tenor in `"bucket"` and the portfolio or illiquidity level in `note`.
- Solvency (insurer subsidiary), as printed in the annual report or the board report: ratios with and without transitional measures, `own_funds`, `scr`, `mcr`, and the board's capital target `target_solvency_ratio`.

Coverage rule for long tables: finish a table once you start it. A half-copied roll-forward is worse than none; if a table cannot be completed, leave it out and say so in `not_found`.

## v2.1 naming rules (from the FY2025 round)
- A metric name belongs to one table. Rows of the CSM roll-forward use the `csm_*` names; the same amounts shown in another note get that note's own name: `rev_csm_release` (insurance revenue analysis), `reins_expense_csm_release` / `reins_expense_ra_release` (reinsurance expense analysis), `note<N>_*` for anything else.
- Printed subtotals inside a roll-forward are `csm_subtotal:<row label>` (or `ra_subtotal:` etc.), never `csm_other:`.
- The finance row of a CSM roll-forward is `csm_interest_accretion`, with the printed label in `label`.
- Before finishing, check each roll-forward: opening + movement rows = closing (under one sign convention, within rounding). If it does not hold, find the duplicate, subtotal or missing row.

## Savings economics (managing-company profitability)

Purpose: the long-term-savings peer comparison (pension and provident separately, per company): fee income, selling and marketing, general and administrative, profit, and the asset base. Output file: `data/extracted_savings/<company>/<period>.json`, same schema and rules as above (nothing calculated, Hebrew page mandatory, `doc` folder, `source`).

Where it is printed: the operating-segments note (pension and provident / long-term savings / asset management segment and its sub-segments), the board report's section on pension and provident, and, for a fund house, its consolidated income statement and segment note. Take the figures for each activity separately when the report separates them, using these `segment` values: `pension`, `provident` (gemel and hishtalmut), `pension_provident` (when only the combined figure is printed), `investment_contracts` / `savings_policies` when the report shows them as a managed-asset activity, and the printed name for anything else.

Metrics (all windows printed: `fy`, `ytd`, `q`, with prior-period comparatives):
- `management_fees` (total); `management_fees_from_assets` and `management_fees_from_deposits` when split
- `selling_and_marketing_expenses` (commissions, marketing and acquisition), `general_and_administrative_expenses`, `other_expenses`, `total_expenses`
- `profit_before_tax`, `comprehensive_income_before_tax`, `operating_profit` (as labelled)
- `aum` at period end and `aum_average` if printed; `deposits` / `contributions`; `net_transfers`, `transfers_in`, `transfers_out`; `new_business_annualized_premiums`
- `fee_rate_from_assets`, `fee_rate_from_deposits` (percent, as printed)
- `members` / `accounts` if printed
Put the exact row label in `label`. If the report gives only a combined pension-and-provident figure, say so in `not_found` for the separate ones.
