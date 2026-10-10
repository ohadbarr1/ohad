export const meta = {
  name: 'quarterly-history-2022-2026',
  description: 'Extract quarterly history since 2022 for 14 companies from the Hebrew reports (49 Sonnet agents)',
  phases: [
    { title: 'Insurers IFRS 4', detail: 'seven insurers, 2022Q1 to 2024Q3 and FY2022, one agent per company-year', model: 'sonnet' },
    { title: 'Asset managers', detail: 'seven fund houses, 2022 to 2026Q2, one agent per company-year block', model: 'sonnet' },
    { title: 'Hachshara fill', detail: 'FY2023, FY2024 and the first two IFRS 17 quarters', model: 'sonnet' },
  ],
}

const ROOT = '/Users/ohadbar/Library/CloudStorage/GoogleDrive-thebarrs14@gmail.com/My Drive/Chief of Staff/Fox/ohad/insurance-dashboard'
const SCHEMA = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    periods: { type: 'array', items: { type: 'object', properties: {
      period: { type: 'string' }, facts: { type: 'integer' }, verified: { type: 'integer' }, numeric: { type: 'integer' },
      status: { type: 'string', enum: ['done', 'partial', 'skipped'] }, notes: { type: 'string' },
    }, required: ['period', 'status', 'facts'] } },
  },
  required: ['company', 'periods'],
}
const common = (c, periods) => `Repo root: ${ROOT}
Company: ${c}. Periods, in this order: ${periods.join(', ')}. Finish each period completely (file written and verifier run) before starting the next; if you run short, stop cleanly and report which periods you did not reach.

Input, per-page text (1-based PDF pages): data/work/${c}_<period>/<folder>/pNNN.txt. List the folder first: the Hebrew report folder is "he" or "he_<report id>". Set "doc" on every fact to that exact folder name and "page_he" to the page. These reports are long: search the page texts (grep) for the tables you need rather than reading linearly.
report_id_he: data/work/manifest_quarters.json, key "${c}_<period>", field he.report_id.

Hard rules: copy numbers exactly as printed, converted to NIS millions (say in "note" when the source prints thousands); never calculate, difference or infer; record the window the column header states and the comparative columns with their own dates; anything in scope that is not printed goes to "not_found" with the reason. A table that is an image with no text on the page goes to not_found, do not read it from memory or guess. Every value must be visibly present on the cited page.
Do not edit any file other than your outputs. Do not touch git, the web app or the browser.
Return the structured result: for each period the number of facts, how many numeric values the verifier found on their cited page out of how many, status, and one short note on what the report does not print.`

const insurer = (c, periods) => `Extract quarterly and annual history from pre-IFRS 17 reports of an Israeli insurer into JSON.
Read first: pipeline/EXTRACT_SPEC.md sections "Extraction spec v1" (fact format, rules 1-12), "IFRS 4 history (v4)" and "v4, interim reports". Also research/glossary_savings_policies.md. A finished example of the annual form: data/extracted_hist/harel/2024FY.json.
There is no CSM, insurance revenue or insurance service result in these reports: do not look for them.
Output: data/extracted_hist/${c}/<period>.json with envelope {"company","period","standard":"IFRS 4","report_id_he","unit":"NIS millions","facts":[...],"not_found":[...]}.
After each period run from the repo root: .venv/bin/python pipeline/verify_hist.py ${c} <period>  and fix every value reported as not on its page.
${common(c, periods)}`

const manager = (c, periods) => `Extract the financial history of an Israeli fund house / investment house from its Hebrew reports into JSON.
Read first: pipeline/EXTRACT_SPEC.md sections "Extraction spec v1" (fact format, rules 1-12) and "Asset managers (v5)". If data/extracted_savings/${c}/ exists, look at one file there to see how this company's activities were named before and keep the same segment names.
Output: data/extracted_hist/${c}/<period>.json with envelope {"company","period","standard":"asset manager","report_id_he","unit":"NIS millions","facts":[...],"not_found":[...]}.
After each period run from the repo root: .venv/bin/python pipeline/verify_hist.py ${c} <period>  and fix every value reported as not on its page.
${common(c, periods)}`

const hachIfrs17 = (periods) => `Extract reported figures from an Israeli insurer's IFRS 17 quarterly reports into JSON, exactly as was already done for its later periods.
Read first: pipeline/EXTRACT_SPEC.md sections v1, v2 and v2.1, and research/glossary_savings_policies.md. Follow the conventions of data/extracted/hachshara/2025Q3.json (metric names, segments, basis).
Output: data/extracted/hachshara/<period>.json (2025Q2 has three-month "q" and six-month "ytd" windows).
After each period run from the repo root: .venv/bin/python pipeline/verify_extraction.py hachshara <period>  and fix values reported missing from their page and CSM bridges that do not close (re-read, never force a fit).
${common('hachshara', periods)}`

const INSURERS = ['harel', 'phoenix', 'migdal', 'clal', 'menora', 'ayalon', 'hachshara']
const insJobs = INSURERS.flatMap((c) => [
  { c, periods: ['2022Q1', '2022Q2', '2022Q3', '2022FY'] },
  { c, periods: ['2023Q1', '2023Q2', '2023Q3'] },
  { c, periods: ['2024Q1', '2024Q2', '2024Q3'] },
])
const MGRS = { altshuler: 1, more: 1, more_gemel: 1, yelin: 1, ibi: 1 }
const mgrJobs = Object.keys(MGRS).flatMap((c) => [
  { c, periods: ['2022Q1', '2022Q2', '2022Q3', '2022FY'] },
  { c, periods: ['2023Q1', '2023Q2', '2023Q3', '2023FY'] },
  { c, periods: ['2024Q1', '2024Q2', '2024Q3', '2024FY'] },
  { c, periods: ['2025Q1', '2025Q2', '2025Q3', '2025FY', '2026Q1', '2026Q2'] },
]).concat([
  { c: 'analyst', periods: ['2022Q2', '2022FY', '2023Q1', '2023Q2', '2023Q3', '2023FY'] },
  { c: 'analyst', periods: ['2024Q1', '2024Q2', '2024Q3', '2024FY'] },
  { c: 'analyst', periods: ['2025Q1', '2025Q2', '2025Q3', '2025FY', '2026Q1', '2026Q2'] },
  { c: 'meitav', periods: ['2023FY', '2024Q1', '2024Q2', '2024Q3', '2024FY'] },
  { c: 'meitav', periods: ['2025Q1', '2025Q2', '2025Q3', '2025FY', '2026Q1', '2026Q2'] },
])

const run = (jobs, make, phaseName) => parallel(jobs.map((j) => () =>
  agent(make(j.c, j.periods), { label: `${j.c} ${j.periods[0]}..${j.periods[j.periods.length - 1]}`, phase: phaseName, model: 'sonnet', schema: SCHEMA })
    .then((r) => r || { company: j.c, periods: j.periods.map((p) => ({ period: p, status: 'skipped', facts: 0, notes: 'agent returned nothing' })) })))

const [ins, mgr, hach] = await Promise.all([
  run(insJobs, insurer, 'Insurers IFRS 4'),
  run(mgrJobs, manager, 'Asset managers'),
  parallel([
    () => agent(insurer('hachshara', ['2023FY', '2024FY']), { label: 'hachshara 2023FY..2024FY', phase: 'Hachshara fill', model: 'sonnet', schema: SCHEMA }),
    () => agent(hachIfrs17(['2025Q1', '2025Q2']), { label: 'hachshara 2025Q1..2025Q2 (IFRS 17)', phase: 'Hachshara fill', model: 'sonnet', schema: SCHEMA }),
  ]),
])
const all = [...ins, ...mgr, ...hach].filter(Boolean)
const flat = all.flatMap((r) => r.periods.map((p) => ({ company: r.company, ...p })))
log(`${flat.filter((p) => p.status === 'done').length} periods done, ${flat.filter((p) => p.status !== 'done').length} partial or skipped`)
return { periods: flat }
