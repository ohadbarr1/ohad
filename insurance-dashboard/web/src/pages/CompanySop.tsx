import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Loading, Panel, Seg } from '../components/ui';
import { nf, sn, byPeriodDesc, dateLabel, periodLabel } from '../lib/format';
import { shiftYear } from '../lib/company';
import { load } from '../lib/useData';
import { he, segName } from './CompanyIfrs';
import { BASIS, Orig, endOf } from './IndustryIfrs';
import '../styles/ifrs.css';

interface SopFact { f: string; m: string; s: string; w: string; d: string; v: number; pg: number | null; b: string; u?: string | null; src?: string; n?: string }
type SopData = Record<string, { url: string | null; facts: SopFact[]; missing: string[] }>;
interface Cell { f: SopFact; url: string | null }
interface Row { key: string; path: string[]; total: boolean; cur?: Cell; yoy?: Cell; qoq?: Cell }
interface Node { key: string; label: string; depth: number; row?: Row; kids: Node[] }
const FAMILIES: [string, string][] = [['sop', 'מקורות הרווח'], ['pc', 'כללי, לפי ענף'], ['health', 'בריאות, לפי ענף'], ['life', 'חיים וחיסכון, לפי מוצר'], ['nostro', 'נוסטרו'], ['other', 'אחר']];
const ORDER = ['q', 'ytd', 'fy', 'instant'];
const lineName = (s: string) => { const [head, rest] = s.split(/:(.*)/); return rest ? rest.trim() : segName(head); };
const prevReport = (p: string) => ({ Q1: `${Number(p.slice(0, 4)) - 1}FY`, Q2: `${p.slice(0, 4)}Q1`, Q3: `${p.slice(0, 4)}Q2`, FY: `${p.slice(0, 4)}Q3` } as Record<string, string>)[p.slice(4)];
const prevQEnd = (e: string) => ({ '03-31': `${Number(e.slice(0, 4)) - 1}-12-31`, '06-30': `${e.slice(0, 4)}-03-31`, '09-30': `${e.slice(0, 4)}-06-30`, '12-31': `${e.slice(0, 4)}-09-30` } as Record<string, string>)[e.slice(5)] ?? '';
/** The window as a period name: QTD of a Q2 report is Q2'26, its YTD is H1'26, an annual report's year is FY'25 and its fourth quarter Q4'25. */
const winLabel = (w: string, end: string) => (w === 'fy' ? periodLabel('FY', end) : w === 'ytd' ? periodLabel(end.slice(5, 7) === '06' ? 'H' : end.slice(5, 7) === '09' ? '9M' : 'Q', end) : w === 'q' ? periodLabel('Q', end) : dateLabel(end));
const isPct = (m: string) => /ratio|pct/.test(m);
const mark = (f: SopFact) => f.src === 'image' || f.src === 'chart';

/** Where a figure sits in the tree: sources of profit by line and then segment; the other tables by segment, then line of business, then metric. */
function pathOf(f: SopFact, multi: boolean): { path: string[]; total: boolean } {
  if (f.m.startsWith('sop')) {
    const [l, r] = f.m.replace(/^sop(_total)?:/, '').split(' | ');
    return f.m.startsWith('sop_total') ? { path: [l], total: true } : { path: [l, (r ?? lineName(f.s)).trim()], total: false };
  }
  const [head, rest] = f.s.split(/:(.*)/);
  const metric = f.m.startsWith('nostro_pct:') ? `${f.m.slice(11)}, %` : f.m.startsWith('nostro:') ? f.m.slice(7) : he(f.m);
  return { path: [segName(head), ...(rest ? [rest.trim()] : []), metric + (multi && f.b !== 'na' ? ` · ${BASIS[f.b] ?? f.b}` : '')], total: false };
}

/** An English note from the extractor, as one Hebrew line: the item, why it is missing, the page; the original stays behind a "מקור" mark. */
const SUBJECTS: [RegExp, string][] = [
  [/combined_ratio|combined-ratio/i, 'יחס משולב'], [/loss_ratio|loss-ratio/i, 'יחס נזקים'], [/nostro_pct/i, 'הרכב הנוסטרו באחוזים'], [/nostro(?!_pct)/i, 'הרכב תיק הנוסטרו לפי סוג נכס'],
  [/sop_total/i, 'סכומי ביניים של מקורות הרווח'], [/\bsop\b|sources-of-profit/i, 'מקורות הרווח'], [/insurance_revenue/i, 'הכנסות משירותי ביטוח'], [/gross_written_premiums/i, 'פרמיות ברוטו'],
  [/insurance_service_result/i, 'תוצאות שירותי ביטוח'], [/comprehensive_income_before_tax/i, 'רווח כולל לפני מס'], [/investment_contracts|pure sav/i, 'פוליסות חיסכון (חוזי השקעה, IFRS 9)'],
  [/underwriting-profit/i, 'תוצאת חיתום לפי תת ענף'], [/board-report line tables/i, 'טבלאות הענפים בדוח הדירקטוריון'], [/pc by line/i, 'כללי, לפי ענף'], [/health by line/i, 'בריאות, לפי ענף'], [/life by line/i, 'חיים, לפי ענף'],
];
const REASONS: [RegExp, string][] = [
  [/image|no text layer/i, 'הטבלה בדוח היא תמונה; מה שנקרא ממנה מסומן ב-*'], [/comparative/i, 'תקופות ההשוואה אינן מודפסות'], [/dash|nil/i, 'מודפס כמקף (אפס)'],
  [/prose|narrative|mentioned/i, 'מוזכר בטקסט בלבד, ללא טבלה'], [/chart|not duplicated|repeat/i, 'מופיע בתרשימים שחוזרים על נתונים שכבר חולצו'],
];
function missingHe(m: string) {
  const head = m.split(': ')[0], subj = SUBJECTS.filter(([re]) => re.test(head)).map(([, h]) => h);
  const why = REASONS.find(([re]) => re.test(m))?.[1] ?? 'לא מודפס בדוח, או מודפס באופן חלקי';
  const pg = m.match(/\bp{1,2}\.?\s?(\d+(?:\s?[-–]\s?p?\d+)?)/)?.[1];
  return `${subj.join(', ') || 'פריט נוסף'}: ${why}${pg ? ` (עמ׳ ${pg.replace(/\s|p/g, '')})` : ''}`;
}

/** What the report says about where profit comes from: sources of profit by segment, results by line of business, and the insurer's own investment book. As printed, each figure on its page. */
export function CompanySop({ id, docs }: { id: string; docs: number }) {
  const [data, setData] = useState<SopData | null | undefined>(undefined);
  useEffect(() => { setData(undefined); load<SopData>(`sop/${id}.json`).then(setData, () => setData(null)); }, [id]);
  const periods = useMemo(() => Object.keys(data ?? {}).sort(byPeriodDesc), [data]);
  const [sel, setSel] = useState('');
  const [fam, setFam] = useState('sop');
  const [exp, setExp] = useState<Record<string, boolean>>({});

  // one period control: every report with the windows it prints at its own balance date
  const opts = useMemo(() => periods.flatMap((p) => {
    const e = endOf(p), has = (w: string) => (data?.[p]?.facts ?? []).some((f) => f.w === w && f.d === e);
    const ws = (p.endsWith('FY') ? ['fy', 'q'] : p.endsWith('Q1') ? ['q'] : ['q', 'ytd']).filter(has);
    return (ws.length ? ws : ['instant'].filter(has)).map((w) => [`${p}|${w}`, winLabel(w, e)] as [string, string]);
  }), [periods, data]);
  const S = opts.some(([k]) => k === sel) ? sel : opts[0]?.[0] ?? '';
  const [P, w0] = S.split('|');
  const end = P ? endOf(P) : '';
  const facts = data?.[P]?.facts ?? [];
  const fams = FAMILIES.filter(([k]) => facts.some((f) => f.f === k));
  const F = fams.some(([k]) => k === fam) ? fam : fams[0]?.[0] ?? '';
  const mine = useMemo(() => facts.filter((f) => f.f === F), [facts, F]);
  // a table with no figures in the chosen window (the nostro book is a balance, not a flow) falls back to the window it does print
  const W = [w0, ...ORDER].find((w) => mine.some((f) => f.w === w && f.d === end)) ?? '';
  const yEnd = end ? shiftYear(end, -1) : '', qEnd = end ? prevQEnd(end) : '';

  const rows = useMemo(() => {
    if (!W || !data) return [] as Row[];
    const map = new Map<string, Row>();
    const bases = new Map<string, Set<string>>();
    mine.forEach((f) => bases.set(`${f.m}|${f.s}`, (bases.get(`${f.m}|${f.s}`) ?? new Set()).add(f.b)));
    const cell = (f: SopFact, p: string): Cell => ({ f, url: f.u !== undefined ? f.u : data[p]?.url ?? null });
    const slot = (f: SopFact) => {
      const key = `${f.m}|${f.s}|${f.b}`;
      if (!map.has(key)) map.set(key, { key, ...pathOf(f, (bases.get(`${f.m}|${f.s}`)?.size ?? 1) > 1) });
      return map.get(key)!;
    };
    mine.forEach((f) => {
      if (f.w !== W) return;
      if (f.d === end) slot(f).cur ??= cell(f, P);
      else if (f.d === yEnd) slot(f).yoy ??= cell(f, P);
    });
    // previous quarter: the same report when it prints it, otherwise the report before
    if (W === 'q' || W === 'instant') {
      const pr = prevReport(P);
      [[P, mine], [pr, (data[pr]?.facts ?? []).filter((f) => f.f === F)]].forEach(([p, fs]) => (fs as SopFact[]).forEach((f) => { if (f.w === W && f.d === qEnd && map.has(`${f.m}|${f.s}|${f.b}`)) map.get(`${f.m}|${f.s}|${f.b}`)!.qoq ??= cell(f, p as string); }));
    }
    return [...map.values()];
  }, [mine, W, end, yEnd, qEnd, P, F, data]);

  const tree = useMemo(() => {
    const top: Node[] = [];
    rows.forEach((r) => {
      let level = top, key = '';
      r.path.forEach((label, i) => {
        key += `/${label}`;
        let n = level.find((x) => x.label === label);
        if (!n) { n = { key, label, depth: i, kids: [] }; level.push(n); }
        if (i === r.path.length - 1) n.row = r;
        level = n.kids;
      });
    });
    return top;
  }, [rows]);

  if (data === undefined) return <Loading what="מקורות הרווח" />;
  if (!data || !P) return <Empty title="מקורות הרווח של החברה טרם חולצו">{docs > 0 && <Link to="../filings">{docs} מסמכי מקור</Link>}</Empty>;
  const hasYoy = rows.some((r) => r.yoy), hasQoq = rows.some((r) => r.qoq);
  const groups: string[] = [];
  const walk = (ns: Node[]) => ns.forEach((n) => { if (n.kids.length) { groups.push(`${F}${n.key}`); walk(n.kids); } });
  walk(tree);
  const isOpen = (k: string) => exp[`${F}${k}`] ?? rows.length <= 14;
  const allOpen = groups.length > 0 && groups.every((k) => exp[k] ?? rows.length <= 14);

  const fig = (c?: Cell) => !c ? <span className="muted">–</span> : (
    <>{c.url && c.f.pg != null ? <a className={`num ${c.f.v < 0 ? 'neg' : ''}`} href={`${c.url}#page=${c.f.pg}`} target="_blank" rel="noreferrer" title={`${BASIS[c.f.b] ?? ''} עמ׳ ${c.f.pg}`.trim()}>{nf(c.f.v, isPct(c.f.m) || Math.abs(c.f.v) < 100 ? 1 : 0)}{isPct(c.f.m) ? '%' : ''}</a> : <span className="num">{nf(c.f.v, 1)}</span>}{mark(c.f) && <sup className="mk" title="הטבלה או הגרף בדוח הם תמונה; המספר נקרא ממנה ולא אומת מול טקסט">*</sup>}</>
  );
  // derived: percent for amounts, points for rates; a line absent from either period shows no change at all
  const chg = (a?: Cell, b?: Cell) => {
    if (!a || !b) return null;
    const rate = isPct(a.f.m), abs = !rate && (b.f.v <= 0 || a.f.v <= 0), x = rate || abs ? a.f.v - b.f.v : (a.f.v / b.f.v - 1) * 100;
    return <span className={`chg num ${x >= 0 ? 'pos' : 'neg'}`} title={`נגזר מהמספרים שהודפסו: ${abs ? 'הפרש במיליוני ש"ח' : rate ? 'הפרש בנקודות' : 'שינוי באחוזים'}`}>{sn(x, rate || !abs ? 1 : 0)}{rate ? ' נק׳' : abs ? '' : '%'}</span>;
  };
  const line = (n: Node): JSX.Element[] => {
    const r = n.row, open = isOpen(n.key), kids = n.kids.length > 0;
    return [
      <tr key={n.key} className={`${kids ? 'grp' : 'kid'} ${r?.total ? 'tot' : ''}`}>
        <td className="lbl tl" style={{ '--d': n.depth } as CSSProperties}>
          {kids ? <button type="button" className="tg" aria-expanded={open} aria-label={`${open ? 'סגירת' : 'פתיחת'} ${n.label}`} onClick={() => setExp((e) => ({ ...e, [`${F}${n.key}`]: !open }))}>{open ? '−' : '+'}</button> : n.depth > 0 && <span className="tg gap" />}{n.label}
        </td>
        <td>{r ? fig(r.cur) : null}</td>
        {hasYoy && <td>{r ? <>{fig(r.yoy)}{chg(r.cur, r.yoy)}</> : null}</td>}
        {hasQoq && <td>{r ? <>{fig(r.qoq)}{chg(r.cur, r.qoq)}</> : null}</td>}
      </tr>,
      ...(kids && open ? n.kids.flatMap(line) : []),
    ];
  };
  const img = mine.some(mark);

  return (
    <>
      <section className="controls">
        <div className="field"><span>תקופה</span><Seg label="תקופה" value={S} onChange={setSel} options={opts} /></div>
        <div className="field"><span>טבלה</span><Seg label="טבלה" value={F} onChange={setFam} options={fams} /></div>
        <span className="chip">מיליוני ש"ח · כפי שדווח</span>
        {data[P].url && <a className="chip" href={data[P].url!} target="_blank" rel="noreferrer">הדוח המלא</a>}
      </section>
      <Panel title={FAMILIES.find(([k]) => k === F)?.[1]} aside={<>{groups.length > 0 && <button type="button" className="btn" onClick={() => setExp(Object.fromEntries(groups.map((k) => [k, !allOpen])))}>{allOpen ? 'סגירת הכול' : 'פתיחת הכול'}</button>}<span>{rows.length} שורות</span></>}>
        {rows.length === 0 ? <Empty title="אין נתונים לטבלה ולתקופה שנבחרו" /> : (
          <div className="scroll"><table className="sop">
            <thead><tr><th>שורה</th><th>{winLabel(W, end)}</th>{hasYoy && <th className="sub">{winLabel(W, yEnd)} · YoY</th>}{hasQoq && <th className="sub">{winLabel(W, qEnd)} · QoQ</th>}</tr></thead>
            <tbody>{tree.flatMap(line)}</tbody>
          </table></div>
        )}
        <div className="src">YoY ו-QoQ הם שינוי מחושב מהמספרים שהודפסו: באחוזים לסכומים, בנקודות לשיעורים, בהפרש כשאחד הצדדים הפסד; שורה שלא הודפסה בתקופה מסומנת – ואין לה שינוי{img && <> · <sup className="mk">*</sup> נקרא מטבלה או מגרף שהם תמונה בדוח, לא אומת מול טקסט</>}</div>
        {F === 'life' && <div className="src">"פוליסות הכוללות רכיב חיסכון" הן ביטוחי מנהלים (IFRS 17). חוזי השקעה הם פוליסות חיסכון טהורות (IFRS 9).</div>}
      </Panel>
      {data[P].missing.length > 0 && (() => {
        const lines = new Map<string, string[]>();
        data[P].missing.forEach((m) => { const h = missingHe(m); lines.set(h, [...(lines.get(h) ?? []), m]); });
        return (
          <Panel title="מה הדוח לא מדפיס" aside={<span>{lines.size}</span>}>
            <ul className="miss">{[...lines].map(([h, ms]) => <li key={h}>{h}<Orig t={ms.join('\n')} /></li>)}</ul>
          </Panel>
        );
      })()}
    </>
  );
}
