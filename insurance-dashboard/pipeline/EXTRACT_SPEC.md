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
