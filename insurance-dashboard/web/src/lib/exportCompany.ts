import type { CompanyData, IfrsData, IfrsFact, KpiData, RegistryCompany } from './types';
import type { LtsData, LtsProv } from './lts';
import { periodLabel as ltsPeriod } from './lts';
import { load } from './useData';
import { periodLabel, pubLabel } from './format';
import { KPI_DEFS, periodTag } from './kpi';
import { METRIC_HE, SEGMENT_HE } from './labels';
import { mayaReport, pdfPage } from './sources';
import { cellRef, downloadXlsxAsync, type XCell, type XSheet } from './xlsx';
import { repName } from '../pages/companyProv';

/* "הורד את חוברת החברה": one workbook per company with everything the site holds on it — statements over all periods, headline KPIs,
   IFRS 17 facts, sources of profit, long-term savings metrics — and a sources sheet that maps every value to its document, page and
   link. Printed figures link to their PDF page; a figure the site derives (Q4 = FY − 9M) is written as a live Excel formula over the
   printed cells it comes from. */

type Src = { sheet: string; row: string; period: string; v: number; doc: string; page: number | null; url: string | null; how: string };
const UNIT: Record<string, string> = { k: 'אלפי ש"ח', m: 'מיליוני ש"ח', nis: 'ש"ח', pct: '%', shares: 'מניות', bn: 'מיליארדי ש"ח' };
const KIND: Record<string, string> = { Q: 'רבעון', H: 'מצטבר 6 ח׳', '9M': 'מצטבר 9 ח׳', FY: 'שנה', I: 'יתרה' };
const WIN: Record<string, string> = { q: 'רבעון', ytd: 'מצטבר', fy: 'שנה', i: 'יתרה', instant: 'יתרה' };
const fmtOf = (u: string) => (u === 'pct' ? 'pct1' as const : u === 'nis' ? 'n2' as const : u === 'k' || u === 'shares' ? 'n0' as const : 'n1' as const);
const head = (v: string): XCell => ({ v, head: true });

/** previous cumulative period of a derived quarter: Q4 = FY − 9M, Q3 = 9M − H1, Q2 = H1 − Q1; H2 = FY − H1 */
function derivedFrom(d: CompanyData, pi: number): [number, number] | null {
  const p = d.periods[pi], end = p.end;
  const back = (e: string, months: number) => { const dt = new Date(`${e}T00:00:00Z`); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() - months + 1); dt.setUTCDate(0); return dt.toISOString().slice(0, 10); };
  const find = (type: string, e: string) => d.periods.findIndex((x) => x.type === type && x.end === e);
  const cum: Record<number, string> = { 3: 'Q', 6: 'H', 9: '9M', 12: 'FY' };
  const span = p.type === 'Q' ? 3 : p.type === 'H' ? 6 : 0;
  if (!span) return null;
  const m = Number(end.slice(5, 7));  // calendar year: cumulative months to the period end
  if (m <= span) return null;
  const a = find(cum[m], end), b = find(cum[m - span], back(end, span));
  return a >= 0 && b >= 0 ? [a, b] : null;
}

function statements(d: CompanyData, name: string, src: Src[]): XSheet[] {
  const by = new Map<number, Map<number, [number, number | null, number | null | undefined, number]>>();
  const F = d.facts;
  for (let i = 0; i < F.length; i++) { const f = F[i], mi = f[0], pi = f[1], v = f[2], pg = f[3], u = f[4], fl = f[5]; if (v == null) continue; let m = by.get(mi); if (!m) by.set(mi, (m = new Map())); m.set(pi, [v, pg, u, fl ?? 0]); }
  const urlOf = (entity: string, u: number | null | undefined) => (u != null ? d.urls?.[u] : null) ?? d.sources.find((x) => x.entity === entity)?.url ?? null;
  const docOf = (entity: string, url: string | null) => (url ? d.sources.find((x) => x.url === url)?.doc ?? decodeURIComponent(url.split('/').pop() ?? url) : d.sources.find((x) => x.entity === entity)?.doc ?? 'דוח כספי');
  const groups = [...new Set(d.sheets.map((s) => s.group))];
  return groups.map((g) => {
    const sheets = d.sheets.filter((s) => s.group === g);
    const mis = d.metrics.map((m, i) => [m, i] as const).filter(([m]) => sheets.some((s) => s.code === m.sheet));
    const used = new Set<number>();
    mis.forEach(([, i]) => by.get(i)?.forEach((_, pi) => used.add(pi)));
    const per = [...used].sort((a, b) => d.periods[a].end.localeCompare(d.periods[b].end) || d.periods[a].months - d.periods[b].months);
    const colOf = new Map(per.map((pi, k) => [pi, k + 3]));
    const title = d.groups[g] ?? g;
    const rows: XCell[][] = [
      [{ v: `${name} · ${title}`, bold: true }],
      [{ v: 'כחול: מקושר לעמוד בדוח · נטוי: נגזר, נוסחה על התאים המודפסים · מקור כל ערך בגיליון "מקורות"', muted: true }],
      [head('שורה'), head('פילוח'), head('יחידה'), ...per.map((pi) => head(periodLabel(d.periods[pi].type, d.periods[pi].end)))],
      [{ v: '', band: true }, { v: '', band: true }, { v: '', band: true }, ...per.map((pi) => ({ v: KIND[d.periods[pi].type] ?? '', band: true }))],
    ];
    for (const s of sheets) {
      rows.push([{ v: s.title, band: true }, { v: '', band: true }, { v: s.entity === 'I' ? 'חברת הביטוח' : s.entity === 'P' ? 'פנסיה וגמל' : 'מאוחד', band: true }, ...per.map(() => ({ v: '', band: true }))]);
      for (const [m, mi] of mis) {
        if (m.sheet !== s.code) continue;
        if (m.header) { rows.push([{ v: m.label, bold: true }]); continue; }
        const r = rows.length, vals = by.get(mi);
        const label = m.label;
        const line: XCell[] = [{ v: label, bold: !!m.total }, m.dim ?? '', { v: UNIT[m.unit] ?? m.unit, muted: true }];
        per.forEach((pi) => {
          const f = vals?.get(pi);
          if (!f) { line.push(null); return; }
          const [v, pg, u, fl] = f, url = urlOf(m.entity, u), per2 = periodLabel(d.periods[pi].type, d.periods[pi].end);
          const fmt = fmtOf(m.unit);
          if (fl & 1) {
            const ab = derivedFrom(d, pi), A = ab ? vals?.get(ab[0]) : undefined, B = ab ? vals?.get(ab[1]) : undefined;
            // the formula only when the printed cells are in this row and give the same figure
            if (ab && A && B && Math.abs(A[0] - B[0] - v) <= Math.max(1, Math.abs(v) * 1e-6)) {
              const fa = cellRef(r, colOf.get(ab[0])!), fb = cellRef(r, colOf.get(ab[1])!);
              line.push({ v, f: `${fa}-${fb}`, fmt, italic: true, bold: !!m.total });
              src.push({ sheet: title, row: label + (m.dim ? ` · ${m.dim}` : ''), period: per2, v, doc: 'נגזר', page: null, url: null, how: `נוסחה: ${periodLabel(d.periods[ab[0]].type, d.periods[ab[0]].end)} − ${periodLabel(d.periods[ab[1]].type, d.periods[ab[1]].end)} (${fa}-${fb})` });
              return;
            }
            line.push({ v, fmt, italic: true, bold: !!m.total, link: url ? pdfPage(url, pg) : undefined });
            src.push({ sheet: title, row: label + (m.dim ? ` · ${m.dim}` : ''), period: per2, v, doc: docOf(m.entity, url), page: pg, url: url ? pdfPage(url, pg) : null, how: 'נגזר מתקופות מצטברות של אותו דוח' });
            return;
          }
          line.push({ v, fmt, bold: !!m.total, link: url ? pdfPage(url, pg) : undefined });
          const how = [fl & 2 ? 'IFRS 4' : '', fl & 4 ? 'סימן הותאם' : '', fl & 8 ? 'הוצג מחדש בדוח מאוחר' : ''].filter(Boolean).join(' · ') || 'מודפס';
          src.push({ sheet: title, row: label + (m.dim ? ` · ${m.dim}` : ''), period: per2, v, doc: docOf(m.entity, url), page: pg, url: url ? pdfPage(url, pg) : null, how });
        });
        rows.push(line);
      }
    }
    return { name: title, rows, widths: [46, 14, 11, ...per.map(() => 11)], freeze: { rows: 4, cols: 1 } };
  });
}

function kpiSheet(id: string, k: KpiData, src: Src[]): XSheet | null {
  const c = k.companies[id];
  if (!c) return null;
  const order = c.periods.map((_, i) => i).sort((a, b) => c.end[a].localeCompare(c.end[b]) || (c.periods[a].endsWith('FY') ? 1 : 0) - (c.periods[b].endsWith('FY') ? 1 : 0));
  const defs = KPI_DEFS.filter((d) => c.values[d.key]);
  const rows: XCell[][] = [
    [{ v: 'נתוני מפתח · XBRL במאיה', bold: true }],
    [{ v: `ערכים באלפי ש"ח (רווח למניה בש"ח) · כל ערך מקושר לדיווח במאיה · נתונים ${pubLabel(k.asof)}`, muted: true }],
    [head('מדד'), head('יחידה'), ...order.map((i) => head(periodTag(c.periods[i])))],
  ];
  for (const d of defs) {
    rows.push([d.label, { v: d.key === 'eps' ? 'ש"ח' : 'אלפי ש"ח', muted: true }, ...order.map((i): XCell => {
      const v = c.values[d.key][i];
      if (v == null) return null;
      const rid = c.rid?.[i], fix = c.fix?.[c.periods[i]];
      src.push({ sheet: 'נתוני מפתח', row: d.label, period: periodTag(c.periods[i]), v, doc: `דיווח XBRL · ${KPI_DEFS.find((x) => x.key === d.key)?.label ?? d.key}`, page: null, url: rid ? mayaReport(rid) : null, how: fix ? `תוקן: ${fix.t === 'printed' ? 'הרבעון כפי שהודפס' : fix.t === 'diff' ? 'מצטבר פחות רבעונים קודמים' : 'הושמט'}` : (c.status?.[i] ?? 'XBRL') });
      return { v, fmt: d.key === 'eps' ? 'n2' : 'n0', link: rid ? mayaReport(rid) : undefined, italic: !!fix };
    })]);
  }
  return { name: 'נתוני מפתח', rows, widths: [28, 10, ...order.map(() => 11)], freeze: { rows: 3, cols: 1 } };
}

function factRows(title: string, facts: { f: IfrsFact; url: string | null; doc: string }[], src: Src[], what: (f: IfrsFact) => string): XSheet {
  const rows: XCell[][] = [
    [{ v: title, bold: true }],
    [{ v: 'מיליוני ש"ח אלא אם צוין · כל ערך מקושר לעמוד שלו', muted: true }],
    [head('מדד'), head('מגזר'), head('בסיס'), head('תקופה'), head('חלון'), head('ערך'), head('עמוד'), head('מסמך'), head('כפי שהודפס'), head('הערה')],
  ];
  const sorted = [...facts].sort((a, b) => what(a.f).localeCompare(what(b.f), 'he') || a.f.s.localeCompare(b.f.s) || a.f.d.localeCompare(b.f.d));
  for (const { f, url, doc } of sorted) {
    const per = periodLabel(f.w === 'q' ? 'Q' : f.w === 'fy' ? 'FY' : f.w === 'ytd' ? ({ '03-31': 'Q', '06-30': 'H', '09-30': '9M', '12-31': 'FY' } as Record<string, string>)[f.d.slice(5)] ?? 'Q' : 'I', f.d);
    const link = url ? pdfPage(url, f.pg) : undefined;
    rows.push([what(f), SEGMENT_HE[f.s] ?? f.s, f.b === 'na' ? '' : f.b, per, WIN[f.w] ?? f.w, { v: f.v, fmt: Math.abs(f.v) < 100 && !Number.isInteger(f.v) ? 'n2' : 'n1', link }, f.pg ?? '', { v: doc, link }, { v: f.l ?? '', muted: true }, { v: f.n ?? '', muted: true }]);
    src.push({ sheet: title, row: `${what(f)} · ${SEGMENT_HE[f.s] ?? f.s}`, period: per, v: f.v, doc, page: f.pg, url: link ?? null, how: f.src === 'chart' ? 'נקרא מגרף' : f.src === 'text' ? 'נקרא מטקסט' : 'מודפס' });
  }
  return { name: title, rows, widths: [40, 18, 8, 9, 9, 12, 7, 22, 40, 40], freeze: { rows: 3, cols: 1 } };
}

function ltsSheet(id: string, d: LtsData, prov: LtsProv | null, labels: Map<string, { l: string; u: string }>, src: Src[]): XSheet | null {
  const lid = id === 'idi' ? 'direct' : id;
  const facts = d.facts.filter((f) => f[1] === lid);
  if (!facts.length) return null;
  const keyOf = (p: string) => { const ym = /^(\d{4})-(\d{2})$/.exec(p); if (ym) return `${ym[1]}${ym[2]}i`; const [w, y] = p.startsWith('FY') ? ['FY', p.slice(2)] : p.split('-'); const m = { Q1: '03', Q2: '06', Q3: '09', Q4: '12', H1: '06', H2: '12', '9M': '09', FY: '12' }[w] ?? '00'; return `${y}${m}${w === 'FY' ? 'z' : w.startsWith('Q') ? 'a' : 'm'}`; };
  const pers = [...new Set(facts.map((f) => f[2]))].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const mets = [...new Set(facts.map((f) => f[0]))].sort();
  const val = new Map(facts.map((f) => [`${f[0]}|${f[2]}`, f]));
  const rows: XCell[][] = [
    [{ v: `חיסכון ארוך טווח · ${d.companies[lid] ?? id}`, bold: true }],
    [{ v: 'מחושב מדוחות החברה המנהלת; הנוסחה והרכיבים של כל ערך בגיליון "מקורות" · נטוי: מחושב', muted: true }],
    [head('מדד'), head('יחידה'), ...pers.map((p) => head(ltsPeriod(p)))],
  ];
  for (const m of mets) {
    const lab = labels.get(`lts:${m}`);
    rows.push([lab?.l ?? m, { v: UNIT[lab?.u ?? ''] ?? lab?.u ?? '', muted: true }, ...pers.map((p): XCell => {
      const f = val.get(`${m}|${p}`);
      if (!f) return null;
      const pv = prov?.facts[`${m}|${p}`];
      const parts = pv ? pv[1].slice(0, 6).map((i) => prov!.parts[i]).filter(Boolean) : [];
      const first = parts.find((x) => x[0]);
      const url = first ? prov!.urls[first[0]] ?? null : null;
      src.push({ sheet: 'חיסכון ארוך טווח', row: lab?.l ?? m, period: ltsPeriod(p), v: f[3], doc: first ? `${prov?.entity ?? 'דוח החברה המנהלת'}, ${first[0].replace('ic:', '')}` : f[4] ? 'מצגת' : 'דוחות החברה המנהלת', page: first?.[1] ?? null, url: url ? pdfPage(url, first?.[1]) : null,
        how: pv ? `מחושב: ${pv[0]}${parts.length ? ` · רכיבים: ${parts.map((x) => `${x[2]} ${x[3]} (עמ׳ ${x[1] ?? '–'})`).join('; ')}` : ''}` : 'מודפס' });
      return { v: f[3], fmt: lab?.u === 'pct' ? 'pct1' : Math.abs(f[3]) < 100 ? 'n2' : 'n1', italic: !!pv, link: url ? pdfPage(url, first?.[1]) : undefined };
    })]);
  }
  return { name: 'חיסכון ארוך טווח', rows, widths: [40, 12, ...pers.map(() => 10)], freeze: { rows: 3, cols: 1 } };
}

/** Builds and downloads the company workbook. Returns the number of values written. */
export async function exportCompany(id: string, onStep?: (s: string) => void): Promise<number> {
  onStep?.('טוען');
  const [reg, kpi, ifrs, sopIdx, lts, registry, qa] = await Promise.all([
    load<RegistryCompany[]>('companies/index.json'), load<KpiData>('kpi.json').catch(() => null), load<IfrsData>('ifrs.json').catch(() => null),
    load<Record<string, Record<string, number>>>('sop/index.json').catch(() => ({} as Record<string, Record<string, number>>)), load<LtsData>('lts.json').catch(() => null),
    load<{ metrics: { id: string; l: string; u: string }[] }>('peers/registry.json').catch(() => null), load<{ built?: string }>('qa.json').catch(() => null),
  ]);
  const entry = reg.find((c) => c.id === id);
  if (!entry) throw new Error('החברה לא נמצאה');
  const name = entry.name_he, src: Src[] = [], sheets: XSheet[] = [];
  const ifrsFiles = ifrs?.files.filter((f) => f.company === id) ?? [];
  const [data, ifrsFacts, sop, ltsProv] = await Promise.all([
    entry.has_financials ? load<CompanyData>(`companies/${id}.json`).catch(() => null) : Promise.resolve(null),
    Promise.all(ifrsFiles.map((f) => load<IfrsFact[]>(`ifrs/${id}/${f.period}.json`).then((fs) => fs.map((x) => ({ f: x, url: x.u !== undefined ? x.u : f.url, doc: `${x.u !== undefined ? 'מצגת' : 'דוח'} ${repName(f.period)}` })), () => []))),
    sopIdx[id] ? load<Record<string, { url: string | null; facts: (IfrsFact & { f: string })[] }>>(`sop/${id}.json`).catch(() => null) : Promise.resolve(null),
    load<LtsProv>(`lts_prov/${id === 'idi' ? 'direct' : id}.json`).catch(() => null),
  ]);
  onStep?.('בונה');
  if (data) sheets.push(...statements(data, name, src));
  const k = kpi && kpiSheet(id, kpi, src); if (k) sheets.push(k);
  const allIfrs = ifrsFacts.flat();
  if (allIfrs.length) sheets.push(factRows('IFRS 17', allIfrs, src, (f) => METRIC_HE[f.m] ?? f.m));
  if (sop) {
    const facts = Object.entries(sop).flatMap(([p, x]) => x.facts.map((f) => ({ f, url: f.u !== undefined ? f.u ?? null : x.url, doc: `${f.u !== undefined ? 'מצגת' : 'דוח'} ${repName(p)}` })));
    if (facts.length) sheets.push(factRows('מקורות רווח', facts, src, (f) => f.m.replace(/^sop:/, '')));
  }
  const labels = new Map((registry?.metrics ?? []).map((m) => [m.id, { l: m.l, u: m.u }]));
  const l = lts && ltsSheet(id, lts, ltsProv, labels, src); if (l) sheets.push(l);
  const built = new Date().toISOString(), dd = qa?.built ?? built;
  const sources: XSheet = { name: 'מקורות', freeze: { rows: 3, cols: 0 }, widths: [18, 46, 10, 13, 34, 7, 60, 50], rows: [
    [{ v: `${name} · מקור לכל ערך`, bold: true }],
    [{ v: `${src.length.toLocaleString('en-US')} ערכים · עמוד = עמוד ב-PDF של המסמך · נוסחה = ערך שהאתר גוזר, כתוב כנוסחת Excel בגיליון שלו`, muted: true }],
    [head('גיליון'), head('שורה'), head('תקופה'), head('ערך'), head('מסמך'), head('עמוד'), head('קישור'), head('אופן')],
    ...src.map((s): XCell[] => [s.sheet, s.row, s.period, { v: s.v, fmt: Math.abs(s.v) < 100 && !Number.isInteger(s.v) ? 'n2' : 'n0' }, s.doc, s.page ?? '', s.url ? { v: s.url, link: s.url } : '', { v: s.how, muted: s.how === 'מודפס' }]),
  ] };
  const docs = new Map<string, { doc: string; url: string; n: number }>();
  src.forEach((s) => { if (!s.url) return; const u = s.url.split('#')[0]; const d = docs.get(u) ?? { doc: s.doc, url: u, n: 0 }; d.n++; docs.set(u, d); });
  const cover: XSheet = { name: 'שער', widths: [26, 90], rows: [
    [{ v: `fox · ${name}`, bold: true }],
    [{ v: entry.name_en ?? '', muted: true }],
    [],
    ['כתובת', { v: `${location.host}/company/${id}`, link: `${location.origin}/company/${id}` }],
    ['נתונים נכון ל', pubLabel(dd)], ['הופק', pubLabel(built)],
    ['ערכים', src.length], ['מסמכים', docs.size],
    [],
    [{ v: 'גיליונות', bold: true }],
    ...sheets.map((s) => [s.name, `${Math.max(0, s.rows.length - 3)} שורות`]),
    ['מקורות', 'מקור לכל ערך: מסמך, עמוד, קישור; ערך נגזר: הנוסחה'],
    [],
    [{ v: 'מקרא', bold: true }],
    ['כחול', 'הערך מקושר לעמוד שלו ב-PDF (או לדיווח במאיה)'], ['נטוי', 'נגזר: Q4 = FY − 9M, H2 = FY − H1, כתוב כנוסחה על התאים המודפסים'], ['תקופות', "Q2'26 רבעון · H1'26 מצטבר · FY'25 שנה · יתרה לתאריך המאזן"],
    [],
    [{ v: 'מסמכים', bold: true }],
    ...[...docs.values()].sort((a, b) => b.n - a.n).map((d) => [{ v: d.doc, link: d.url }, `${d.n} ערכים`]),
  ] };
  onStep?.('כותב');
  await downloadXlsxAsync(`fox-${id}-${pubLabel(built)}`, [cover, ...sheets, sources], { title: `fox · ${name}` });
  return src.length;
}
