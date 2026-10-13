# Long-term savings sector comparison: the method

How the deck "חיסכון ארוך טווח, השוואות ענפיות, Q2-2026" (`pipeline/build_lts.py` -> `web/public/data/lts.json`) computes its
pension (`pen`) and provident (`gem`) figures from the managing companies' reports, settled on two companies (Phoenix,
Menora) against 222 deck anchors. Code: `pipeline/lts_method.py` (every definition, shared) and one mapping script per
company, `pipeline/lts_norm_<company>.py` (which printed facts form each base series). Output:
`data/lts_norm/<company>.json`.

Nothing here is tuned per company. Where the deck cannot be reproduced by one consistent definition it is listed with
both numbers in section 7.

## 1. Units and period keys

| | unit |
|---|---|
| `aum`, `tr_in`, `tr_out`, `tr_net`, `dep`, `nb` | NIS billions |
| `fees`, `sm`, `ga`, `op` | NIS millions |
| `out_rate`, `fee_a`, `fee_d`, `gross_m`, `op_m`, `sm_aum`, `ga_aum`, `sm_fees`, `ga_fees` | percent |

Balance date `2025-09`. Windows: `FY2025`, `H1-2025`, `9M-2025` (year to date), `Q1-2025` ... `Q4-2025` (three months).

## 2. Base series (what a company script must supply)

Per family, from the raw facts of `data/extracted_lts/<company>/`:

| series | key | content |
|---|---|---|
| `aum` | balance date | Assets of every fund of the family the company manages, from the fund-type summary table of the business description. Pension: new comprehensive + new general + **veteran funds** + assets backing pension recipients. Provident: every provident column (gemel, study funds, investment gemel, child savings, central funds, guaranteed-return tracks, "other"). |
| `aum_new` (pension, only if the company has veteran funds) | balance date | New funds only (comprehensive + general). Denominator of the activity-table rates (`out_rate`, `fee_a`). |
| `tr_in`, `tr_out` | YTD | "העברות צבירה לקרן / מהקרן" as printed, summed over the fund columns. Gross, nothing netted, transfers between tracks not removed. Pension: new funds. |
| `dep` | YTD | "דמי גמולים" (current deposits). **One-time deposits are not added.** |
| `nb` (pension) | YTD | "דמי גמולים משונתים עבור מצטרפים חדשים", new funds. |
| `fees_a` (pension) | YTD | Fees collected from assets in the new funds: members (active + inactive) **plus pension recipients**. |
| `fees_d` (pension) | YTD | Fees collected from deposits, new funds. |
| `fees`, `sm`, `ga` | YTD | Operating-segments note of the financial statements: "הכנסות מדמי ניהול, נטו", "עמלות, הוצאות שיווק והוצאות רכישה אחרות", "הוצאות הנהלה וכלליות" of the pension-funds segment and of the provident-funds segment. Pension segment as printed (it includes the veteran funds). A separate segment whose income is not management fees (Menora's guaranteed-return tracks) is left out. |

How to choose segments for a new company:
1. Balances and activity flows come from the fund-type table (one column per fund type); P&L comes from the segment note. Do not mix: collected fees from the fund table are not the segment's fee income.
2. If a report prints two counts of the same assets (Menora: summary table vs investment-track table), use the summary table that splits active / inactive / recipients. It is the one printed every period back to 2021.
3. Sum the printed columns; use a printed total only when no columns are printed. `lts_method.collect` refuses a fact printed twice with two values in one report.
4. A blank or `*` cell is not a figure. A gross flow printed in parentheses is taken as its amount.
5. Printed average fee rates are not used: both companies print them by population only (active / inactive / recipients), and the deck's rates are computed (section 4).

## 3. Windows, average assets, annualisation, restatements

**Year-to-date and full-year windows** are the printed cumulative figures.

**Quarter**: the stand-alone three-month figure when the report of that period prints one (income statement and segment note); otherwise YTD(m) - YTD(m-3). Q1 is the Q1 figure. Q4 is always FY - 9M. Printed three-month figures equal the differences exactly at Phoenix; at Menora they differ only in 2023, where the Q1-2023 comparative is before a reclassification and the H1-2023 one after it.

**Average assets** of a window = (assets at the start of the window + assets at its end) / 2. Start of a YTD window = 31 December of the previous year; start of a quarter = the previous quarter end.

**Annualisation** of a part-year flow = x 12 / months in the window (x2, x4/3, x4). Not by days.

**Rates are computed**, never taken from printed rates.

**Which report, when two reports print different values** (one rule):
- Balances, interim windows and both sides of a quarter difference: the report of the period itself. If that report is not extracted (2021-2022, the 2023 quarters), the earliest report that prints the figure as a comparative.
- Full years: the **latest annual report** that prints the year. Interim reports never overwrite a full year.
- For Q4 of a year whose 9M figure comes from the following year's comparative, the full year is taken from that following year's annual report, so both sides have one classification.
- Every other printed value is recorded in `notes` of the output (`used`, `used_file`, `other`, `other_files`).

Evidence: Menora reclassified between S&M and G&A twice. FY2023 pension S&M is 162.606 in the 2023 annual report and 168.258 in the 2024 and 2025 annual reports: the deck's FY2023 gross margins (pension 0.257, provident 0.27) reproduce only with 168.258 (0.260 and 0.32 otherwise). FY2025 pension S&M is 174.843 in the 2025 annual report and 192.473 in the Q1 and Q2-2026 comparatives: the deck's FY2025 `sm_fees` 21, `ga_fees` 41 and `gross_m` 0.238 reproduce only with 174.843. Phoenix restated FY2025 provident transfers in the 2026 interim reports (in 11.463, out 6.753); the deck uses the 2025 annual report (11.212, 6.502).

Alternatives tested, anchors reproduced (Menora + Phoenix, of 222):

| definition | score |
|---|---|
| **chosen** | **94 + 101 = 195** |
| full year from the report of the year itself, never updated | 92 + 101 |
| latest report of any kind | 90 + 97 |
| latest report of the same kind (annual / same quarter) | 94 + 101 (same anchors; rejected because a quarter difference would then mix classifications) |

Average assets, on the 108 rate anchors only (54 per company):

| average | Menora | Phoenix |
|---|---|---|
| **(start + end) / 2** | **40** | **44** |
| mean of all quarter ends in the window, start included | 25 | 27 |
| mean of quarter ends, start excluded | 20 | 19 |
| trapezoid over quarter ends | 23 | 25 |
| end of window | 6 | 1 |
| start of window | 7 | 3 |

Annualisation, on the 110 part-year anchors: x 12 / months 43 + 46; x days-in-year / days-in-window 35 + 35.

Other choices tested:

| question | result |
|---|---|
| Phoenix pension assets with / without veteran funds | With: Dec-24 116.4, Dec-25 146.2, Jun-26 161.8 = deck 116, 146, 162. Without: 113.2, 142.9, 158.4. |
| Phoenix `out_rate`, `fee_a` denominator | New funds only: 101 anchors. Veteran funds included: 96. |
| Segment margins denominator (`gross_m`, `op_m`, `sm_aum`, `ga_aum`) | All assets of the family (veteran included): Phoenix FY2025 pension gross margin 0.1420 = deck 0.142; on new funds 0.146. |
| One-time deposits inside `dep` | Without them `fee_d` and `gem.dep` reproduce; with them 3 anchors are lost per family per company (Menora provident: 1). |
| Menora pension assets: summary table / track table | Summary 94; track table throughout 82; track table from Dec-25 92; track table from 2026 only 96 (rejected: it is two definitions). |
| Menora provident assets without guaranteed-return tracks | 71 (with them 94). |
| Menora provident G&A with the guaranteed-return segment | 92 (gains 5 anchors of FY2024 / H1-2026, loses 7 of FY2025 / H1-2026). |

## 4. Deck metrics (one definition each)

`avg` = average assets of the window on `aum`; `avg_new` = the same on `aum_new` (= `aum` where the company has no veteran funds); `k` = 12 / months.

| metric | formula |
|---|---|
| `aum` | `aum` at the balance date |
| `tr_in`, `tr_out` | base flow of the window |
| `tr_net` | `tr_in - tr_out` (unrounded) |
| `out_rate` | `tr_out x k / avg_new x 100` |
| `nb` (pension) | base flow, **not annualised** (the deck prints the half-year amount for H1) |
| `dep` (provident) | base flow, not annualised |
| `fee_a` pension | `fees_a x k / avg_new x 100` |
| `fee_a` provident | `fees x k / avg x 100` (segment fee income; provident funds charge almost nothing on deposits) |
| `fee_d` (pension) | `fees_d / dep x 100` |
| `fees`, `sm`, `ga` | base flow |
| `op` | `fees - sm - ga` (not the printed profit before tax; other expenses, finance and investment income are outside) |
| `gross_m` | `(fees - sm) x k / avg x 100` |
| `op_m` | `(fees - sm - ga) x k / avg x 100` |
| `sm_fees`, `ga_fees` | `sm / fees x 100`, `ga / fees x 100` |
| `sm_aum`, `ga_aum` | `sm x k / avg x 100`, `ga x k / avg x 100` |

Rounding of the deck (an anchor counts only at this rounding, half up): `aum`, `dep`, `op`, `sm_fees`, `ga_fees` 0 decimals; `tr_*`, `nb` 1; `fee_d`, `sm_aum`, `ga_aum` 2; `fee_a` 3; `gross_m`, `op_m` 3 for pension and 2 for provident; `out_rate` 1 for pension and for all quarters, 2 for provident YTD.

## 5. Output

`data/lts_norm/<company>.json`: `facts` (`metric`, `period`, `value` in the deck's unit unrounded to 6 decimals, `formula`, `parts` = the printed facts with `file`, `metric`, `segment`, `window`, `date`, `value`, `unit`, `page`, `label`, and `component` / `population` where the extraction has them), `anchors` (`deck`, `ours` at the deck's rounding, `ours_exact`, `ok`), `notes`.

A value is given only when every operand is printed: no rate for the first year (no opening assets), no quarter when the previous YTD is missing. A negative difference of a gross flow is not output and is logged in `notes`.

Coverage from the reports extracted (2023FY to 2026Q2): balances Dec-2021 to Jun-2026 (quarterly from Mar-2023); flows FY2021 to H1-2026, quarters from Q1-2023. Rates start FY2022 and Q1-2023. Phoenix segment P&L for Q1-2023 is missing (the Q1-2024 file has no segment note).

## 6. To add a company

1. Copy `lts_norm_menora.py` (components and populations) or `lts_norm_phoenix.py` (one segment per fund column).
2. Fill the base series of section 2 with `M.collect(facts, where, scale)` and `M.choose_base` (flows) / `M.choose` (balances). Give `aum_new` only if there are veteran funds.
3. Run it. Read the misses and the `notes`; exclude a raw fact only when it is demonstrably wrong, with a note saying why (see `bad()` in the Phoenix script). Never change a definition in `lts_method.py` for one company.

## 7. Anchors

Anchors = every `pen.*` / `gem.*` figure of the deck for the company, shares and growth rates excluded.

### menora: 94 of 111 anchors reproduced

Not reproduced:

| metric | period | deck | ours (deck rounding) | ours (exact) | why |
|---|---|---|---|---|---|
| pen.aum | 2026-06 | 332 | 328.0 | 328.3130 | Summary table (active + inactive + pension recipients) = 328.31; track table of the directors' report = 331.61. Deck: Dec-24 259 and Dec-25 306 are the summary table (track table: 262, 309), Jun-26 332 is the track table. No single table gives all three. |
| pen.out_rate | Q2-2025 | 5.7 | 5.6 | 5.5580 | Deck quarterly rates of 2025 imply transfers out of 4.11 + 3.86 + 4.02 + 5.26 = 17.25, above the printed year (16.66) that the deck's own FY2025 rate (5.9) uses. Not a rounding matter; no definition from the reports gives it. |
| pen.out_rate | Q3-2025 | 5.6 | 5.4 | 5.4117 | As Q2-2025. |
| pen.out_rate | Q4-2025 | 7.0 | 6.5 | 6.4860 | As Q2-2025. |
| pen.fee_a | H1-2026 | 0.183 | 0.184 | 0.1840 | 0.18398. Reproduced (0.183) only with the track-table figure for Jun-26 in the average. |
| pen.gross_m | H1-2026 | 0.215 | 0.217 | 0.2169 | Deck value needs average assets of 319.4-320.9; summary table gives 317.26, track table at both ends gives 320.44 (0.215). Using the track table for Dec-25 breaks pen.aum Dec-25 and four FY2025 rates. |
| pen.gross_m | H1-2025 | 0.248 | 0.24 | 0.2401 | (406.386 - 82.816) x 2 / 269.52 = 0.240 from the Q2-2025 report; 0.235 with the reclassified comparative of the Q2-2026 report (S&M 89.686). No definition tested gives 0.248. |
| pen.op_m | H1-2026 | 0.116 | 0.117 | 0.1173 | Same cause as pen.gross_m H1-2026 (track table at both ends gives 0.116). |
| gem.out_rate | Q2-2025 | 8.7 | 8.6 | 8.6020 | 8.60 against 8.7: transfers out H1 - Q1 = 0.989; deck implies 1.000. |
| gem.out_rate | Q3-2025 | 8.6 | 5.6 | 5.6456 | Printed 9M - H1 = 0.684; deck implies 1.04. Deck quarters of 2025 sum to 4.46 against the printed year 3.63 (which the deck's FY2025 rate 7.55 uses). |
| gem.out_rate | Q4-2025 | 11.5 | 7.9 | 7.9141 | Printed FY - 9M = 1.002; deck implies 1.46. See Q3-2025. |
| gem.op | FY2024 | 37 | 42.0 | 41.9370 | Deck FY2024 includes the G&A of the guaranteed-return tracks segment (4.591): 192.440 - 70.828 - 79.675 - 4.591 = 37.3. In FY2025 and H1-2026 the deck leaves that segment out (56 and 40 reproduce only without it). Rule kept: segment 'ניהול קופות גמל' only. |
| gem.gross_m | H1-2026 | 0.3 | 0.31 | 0.3084 | 0.3084 against 0.30 (deck prints two decimals). Needs average assets above 55.07; ours 54.45. |
| gem.op_m | FY2024 | 0.09 | 0.1 | 0.1023 | As gem.op FY2024 (with the guaranteed-return G&A: 0.091). |
| gem.ga_fees | FY2024 | 44 | 41.0 | 41.4025 | As gem.op FY2024 (with it: 43.8). |
| gem.ga_aum | FY2024 | 0.21 | 0.19 | 0.1943 | As gem.op FY2024 (with it: 0.206). |
| gem.ga_aum | H1-2026 | 0.17 | 0.16 | 0.1599 | 0.1599. With the guaranteed-return G&A (2.196) 0.168, but then gem.op and gem.ga_fees of H1-2026 fail. |

All anchors (deck / ours at the deck's rounding; `x` marks a miss):

| metric | values |
|---|---|
| pen.aum | 2024-12: 259 / 259.0; 2025-12: 306 / 306.0; 2026-06: 332 / 328.0 x |
| pen.tr_in | H1-2026: 8.9 / 8.9; FY2025: 12.5 / 12.5; Q1-2026: 4.5 / 4.5; Q2-2026: 4.4 / 4.4 |
| pen.tr_out | H1-2026: 10.3 / 10.3; FY2025: 16.7 / 16.7; Q1-2026: 5.6 / 5.6; Q2-2026: 4.7 / 4.7 |
| pen.tr_net | H1-2026: -1.4 / -1.4; FY2025: -4.2 / -4.2; Q1-2026: -1.1 / -1.1; Q2-2026: -0.3 / -0.3 |
| pen.out_rate | FY2024: 5.1 / 5.1; FY2025: 5.9 / 5.9; H1-2026: 6.5 / 6.5; Q1-2025: 6.3 / 6.3; Q2-2025: 5.7 / 5.6 x; Q3-2025: 5.6 / 5.4 x; Q4-2025: 7.0 / 6.5 x; Q1-2026: 7.3 / 7.3; Q2-2026: 5.8 / 5.8 |
| pen.nb | FY2024: 1.9 / 1.9; FY2025: 2.0 / 2.0; H1-2026: 1.3 / 1.3 |
| pen.fee_a | FY2024: 0.186 / 0.186; FY2025: 0.182 / 0.182; H1-2026: 0.183 / 0.184 x |
| pen.fee_d | FY2024: 1.7 / 1.7; FY2025: 1.69 / 1.69; H1-2026: 1.67 / 1.67 |
| pen.op | FY2024: 278 / 278.0; FY2025: 324 / 324.0; H1-2026: 186 / 186.0 |
| pen.gross_m | FY2024: 0.249 / 0.249; FY2025: 0.238 / 0.238; H1-2026: 0.215 / 0.217 x; FY2023: 0.257 / 0.257; H1-2024: 0.245 / 0.245; H1-2025: 0.248 / 0.24 x |
| pen.op_m | FY2024: 0.116 / 0.116; FY2025: 0.115 / 0.115; H1-2026: 0.116 / 0.117 x |
| pen.sm_fees | FY2024: 22 / 22.0; FY2025: 21 / 21.0; H1-2026: 25 / 25.0 |
| pen.sm_aum | FY2024: 0.07 / 0.07; FY2025: 0.06 / 0.06; H1-2026: 0.07 / 0.07 |
| pen.ga_fees | FY2024: 42 / 42.0; FY2025: 41 / 41.0; H1-2026: 35 / 35.0 |
| pen.ga_aum | FY2024: 0.13 / 0.13; FY2025: 0.12 / 0.12; H1-2026: 0.1 / 0.1 |
| gem.aum | 2024-12: 45 / 45.0; 2025-12: 52 / 52.0; 2026-06: 57 / 57.0 |
| gem.tr_in | H1-2026: 4.0 / 4.0; FY2025: 3.5 / 3.5; Q1-2026: 2.0 / 2.0; Q2-2026: 2.0 / 2.0 |
| gem.tr_out | H1-2026: 1.9 / 1.9; FY2025: 3.6 / 3.6; Q1-2026: 1.0 / 1.0; Q2-2026: 0.9 / 0.9 |
| gem.tr_net | H1-2026: 2.1 / 2.1; FY2025: -0.1 / -0.1; Q1-2026: 0.9 / 0.9; Q2-2026: 1.2 / 1.2 |
| gem.dep | FY2024: 4 / 4.0; FY2025: 5 / 5.0; H1-2026: 3 / 3.0 |
| gem.out_rate | FY2024: 6.97 / 6.97; FY2025: 7.55 / 7.55; H1-2026: 6.98 / 6.98; Q1-2025: 8.6 / 8.6; Q2-2025: 8.7 / 8.6 x; Q3-2025: 8.6 / 5.6 x; Q4-2025: 11.5 / 7.9 x; Q1-2026: 7.9 / 7.9; Q2-2026: 6.3 / 6.3 |
| gem.fee_a | FY2024: 0.469 / 0.469; FY2025: 0.469 / 0.469; H1-2026: 0.476 / 0.476 |
| gem.op | FY2024: 37 / 42.0 x; FY2025: 56 / 56.0; H1-2026: 40 / 40.0 |
| gem.gross_m | FY2024: 0.3 / 0.3; FY2025: 0.3 / 0.3; H1-2026: 0.3 / 0.31 x; FY2023: 0.27 / 0.27; H1-2024: 0.3 / 0.3; H1-2025: 0.31 / 0.31 |
| gem.op_m | FY2024: 0.09 / 0.1 x; FY2025: 0.12 / 0.12; H1-2026: 0.15 / 0.15 |
| gem.sm_fees | FY2024: 37 / 37.0; FY2025: 36 / 36.0; H1-2026: 35 / 35.0 |
| gem.sm_aum | FY2024: 0.17 / 0.17; FY2025: 0.17 / 0.17; H1-2026: 0.17 / 0.17 |
| gem.ga_fees | FY2024: 44 / 41.0 x; FY2025: 39 / 39.0; H1-2026: 34 / 34.0 |
| gem.ga_aum | FY2024: 0.21 / 0.19 x; FY2025: 0.18 / 0.18; H1-2026: 0.17 / 0.16 x |

### phoenix: 101 of 111 anchors reproduced

Not reproduced:

| metric | period | deck | ours (deck rounding) | ours (exact) | why |
|---|---|---|---|---|---|
| pen.out_rate | Q2-2025 | 10.0 | 10.3 | 10.2600 | 10.26. With the veteran funds in the denominator 9.99 (= deck), but that definition loses FY2025, H1-2026, Q1-2025 and the fee_a anchors. |
| pen.out_rate | Q3-2025 | 9.1 | 9.3 | 9.3348 | 9.33; with the veteran funds 9.11 (= deck). See Q2-2025. |
| pen.out_rate | Q4-2025 | 10.4 | 9.4 | 9.4476 | FY - 9M = 3.271, x4 / 138.53 = 9.45. Deck 10.4 implies 3.60; no definition found. |
| pen.out_rate | Q1-2026 | 10.6 | 10.5 | 10.5101 | 3.811 x 4 / 145.05 = 10.51 against 10.6. |
| pen.out_rate | Q2-2026 | 10.1 | 10.0 | 9.9931 | 3.817 x 4 / 152.79 = 9.99 against 10.1. |
| pen.gross_m | H1-2026 | 0.133 | 0.135 | 0.1352 | (224.024 - 119.941) x 2 / 153.99 = 0.1352. The deck is not consistent with itself here: gross_m 0.133 needs average assets above 155.9, sm_aum 0.16 needs them below 154.8, and op_m 0.046 + ga_aum 0.09 = 0.136. |
| gem.out_rate | FY2024 | 11.8 | 17.91 | 17.9150 | As printed 14.235 / 79.46 = 17.91. The deck neutralises transfers between tracks (its footnote); the reports print no such amount, so 11.80 (implied 9.38 of transfers out) cannot be rebuilt. |
| gem.gross_m | H1-2026 | 0.25 | 0.26 | 0.2554 | 0.2554 against 0.25. Same inconsistency as pension: gross_m and op_m need average assets above 108.9, sm_aum 0.33 needs them below 106.8; ours 108.29. |
| gem.op_m | H1-2026 | 0.12 | 0.13 | 0.1258 | 0.1258 against 0.12. See gem.gross_m H1-2026. |
| gem.sm_aum | H1-2026 | 0.33 | 0.32 | 0.3204 | 0.3204 against 0.33. See gem.gross_m H1-2026. |

All anchors (deck / ours at the deck's rounding; `x` marks a miss):

| metric | values |
|---|---|
| pen.aum | 2024-12: 116 / 116.0; 2025-12: 146 / 146.0; 2026-06: 162 / 162.0 |
| pen.tr_in | H1-2026: 10.5 / 10.5; FY2025: 16.1 / 16.1; Q1-2026: 6.1 / 6.1; Q2-2026: 4.4 / 4.4 |
| pen.tr_out | H1-2026: 7.6 / 7.6; FY2025: 13.0 / 13.0; Q1-2026: 3.8 / 3.8; Q2-2026: 3.8 / 3.8 |
| pen.tr_net | H1-2026: 2.8 / 2.8; FY2025: 3.1 / 3.1; Q1-2026: 2.3 / 2.3; Q2-2026: 0.5 / 0.5 |
| pen.out_rate | FY2024: 10.8 / 10.8; FY2025: 10.1 / 10.1; H1-2026: 10.1 / 10.1; Q1-2025: 12.7 / 12.7; Q2-2025: 10.0 / 10.3 x; Q3-2025: 9.1 / 9.3 x; Q4-2025: 10.4 / 9.4 x; Q1-2026: 10.6 / 10.5 x; Q2-2026: 10.1 / 10.0 x |
| pen.nb | FY2024: 2.2 / 2.2; FY2025: 2.3 / 2.3; H1-2026: 1.1 / 1.1 |
| pen.fee_a | FY2024: 0.162 / 0.162; FY2025: 0.157 / 0.157; H1-2026: 0.158 / 0.158 |
| pen.fee_d | FY2024: 1.53 / 1.53; FY2025: 1.51 / 1.51; H1-2026: 1.48 / 1.48 |
| pen.op | FY2024: 44 / 44.0; FY2025: 67 / 67.0; H1-2026: 36 / 36.0 |
| pen.gross_m | FY2024: 0.152 / 0.152; FY2025: 0.142 / 0.142; H1-2026: 0.133 / 0.135 x; FY2023: 0.165 / 0.165; H1-2024: 0.153 / 0.153; H1-2025: 0.147 / 0.147 |
| pen.op_m | FY2024: 0.042 / 0.042; FY2025: 0.051 / 0.051; H1-2026: 0.046 / 0.046 |
| pen.sm_fees | FY2024: 55 / 55.0; FY2025: 53 / 53.0; H1-2026: 54 / 54.0 |
| pen.sm_aum | FY2024: 0.19 / 0.19; FY2025: 0.16 / 0.16; H1-2026: 0.16 / 0.16 |
| pen.ga_fees | FY2024: 32 / 32.0; FY2025: 30 / 30.0; H1-2026: 31 / 31.0 |
| pen.ga_aum | FY2024: 0.11 / 0.11; FY2025: 0.09 / 0.09; H1-2026: 0.09 / 0.09 |
| gem.aum | 2024-12: 84 / 84.0; 2025-12: 103 / 103.0; 2026-06: 114 / 114.0 |
| gem.tr_in | H1-2026: 8.4 / 8.4; FY2025: 11.2 / 11.2; Q1-2026: 5.2 / 5.2; Q2-2026: 3.2 / 3.2 |
| gem.tr_out | H1-2026: 4.3 / 4.3; FY2025: 6.5 / 6.5; Q1-2026: 2.2 / 2.2; Q2-2026: 2.1 / 2.1 |
| gem.tr_net | H1-2026: 4.1 / 4.1; FY2025: 4.7 / 4.7; Q1-2026: 2.9 / 2.9; Q2-2026: 1.1 / 1.1 |
| gem.dep | FY2024: 6 / 6.0; FY2025: 8 / 8.0; H1-2026: 4 / 4.0 |
| gem.out_rate | FY2024: 11.8 / 17.91 x; FY2025: 6.95 / 6.95; H1-2026: 8.02 / 8.02; Q1-2025: 7.9 / 7.9; Q2-2025: 6.3 / 6.3; Q3-2025: 6.7 / 6.7; Q4-2025: 7.3 / 7.3; Q1-2026: 8.6 / 8.6; Q2-2026: 7.7 / 7.7 |
| gem.fee_a | FY2024: 0.574 / 0.574; FY2025: 0.577 / 0.577; H1-2026: 0.576 / 0.576 |
| gem.op | FY2024: 102 / 102.0; FY2025: 145 / 145.0; H1-2026: 68 / 68.0 |
| gem.gross_m | FY2024: 0.3 / 0.3; FY2025: 0.29 / 0.29; H1-2026: 0.25 / 0.26 x; FY2023: 0.31 / 0.31; H1-2024: 0.3 / 0.3; H1-2025: 0.27 / 0.27 |
| gem.op_m | FY2024: 0.13 / 0.13; FY2025: 0.15 / 0.15; H1-2026: 0.12 / 0.13 x |
| gem.sm_fees | FY2024: 48 / 48.0; FY2025: 50 / 50.0; H1-2026: 56 / 56.0 |
| gem.sm_aum | FY2024: 0.27 / 0.27; FY2025: 0.29 / 0.29; H1-2026: 0.33 / 0.32 x |
| gem.ga_fees | FY2024: 30 / 30.0; FY2025: 23 / 23.0; H1-2026: 23 / 23.0 |
| gem.ga_aum | FY2024: 0.17 / 0.17; FY2025: 0.13 / 0.13; H1-2026: 0.13 / 0.13 |

## 8. Problems in the raw extraction

| file | problem | handling |
|---|---|---|
| phoenix 2025FY | Segment-note facts dated 2023-12-31, window fy (management fees, S&M, G&A, other expenses; pension and provident) carry the 9M-2024 column: pension fees 263,256, the 2023 annual report prints 312,047. Total expenses and profit of the same date are right. | Excluded in `lts_norm_phoenix.bad`. The file should be re-read. |
| phoenix 2024Q2 | Provident transfers out for H1-2023 are negative (printed in parentheses), -4.862 bn. | Taken as an amount. |
| phoenix 2024Q3 / 2025Q3 | 9M-2024 provident transfers (in 4.271, out 7.432) are below H1-2024 (4.953, 7.583) and far below FY2024 (10.790, 14.235). Either the report changed basis or the 9M column was misread. | 9M-2024, Q3-2024, Q4-2024 not derived. Worth a re-read of page 22 of the Q3-2024 report. |
| phoenix 2024Q1 | No segment note: no Q1-2023 P&L by segment; Q1-2024 comes from the 2025Q1 comparative. | None. |
| menora 2024Q1 | Provident fees from deposits for Q1-2024 = 2,116, identical to FY2023 (H1-2024 is 878). | Not used by any metric. |
| menora 2025Q1 / 2025Q2 | Transfers in, column "אחר": Q1-2025 9,532, H1-2025 8,917 (a YTD that falls). | Used as printed; 0.6 NIS m. |
| menora 2025FY / 2026Q2 | Provident assets at Dec-25, gemel column: 18.47 bn in the summary table, 18.52 bn in the track table. | Summary table used. |
| menora (all) | Two labels for one column ("לחסכון" / "לחיסכון") and two segment keys (`pension` / `pension_new`) for the same segment-note column, by report vintage. | Both accepted in the mapping. |
