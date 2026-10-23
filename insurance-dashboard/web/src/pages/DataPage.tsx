import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, type Column } from '../components/DataTable';
import { ErrorBox, Field, Loading, Panel, Seg, copyText } from '../components/ui';
import { citation, type CiteFormat } from '../lib/cite';
import { byPeriodDesc, fmt, monthLabel, nf, pubLabel } from '../lib/format';
import { titleFor } from '../lib/title';
import { useLoad, useRegistry } from '../lib/useData';
import { ConsistencyPanel } from './DataConsistency';
import '../styles/data.css';

/* /data (lane 2H; ws5 W5-R2, ws1 W1-18, ws6 W6-15): quality as a product. What the data holds per company and layer, how fresh each
   source is against fox's own target, the deploy gate's results, the open files with their contracts, the licence, and a citation
   generator. Everything is read from coverage.json (pipeline/build_coverage.py) and qa.json (pipeline/gate.py). */

type St = 'fresh' | 'stale' | 'missing' | 'na';
interface Cov {
  built: string;
  layers: { id: string; label: string; cadence: string; source: string }[];
  companies: { id: string; name: string; kind: string; expected: string | null; filed: string | null; inactive?: boolean | null }[];
  cells: Record<string, Record<string, { s: St; last: string | null; n: number | null }>>;
  sources: { id: string; label: string; url: string; cadence: string; sla_days: number; asof: string | null; checked: string | null; feeds: string[]; age_rule?: boolean; behind: { id: string; period: string; filed: string | null; layers: string[] }[] }[];
  files: { pattern: string; contract: string; files: number; bytes: number; example: string }[];
}
interface Qa { built: string; checks: { id: string; ok: boolean; level: 'fail' | 'warn'; n: number; fail: number; note: string }[] }

const ST_HE: Record<St, string> = { fresh: 'עדכני', stale: 'מאחור', missing: 'חסר', na: 'לא רלוונטי' };
const CADENCE: Record<string, string> = { daily: 'יומי', monthly: 'חודשי', quarterly: 'רבעוני', annual: 'שנתי', event: 'בכל עדכון' };
const CHECK_HE: Record<string, string> = {
  workbook: 'תקינות גיליונות הדוחות', prov: 'אגרגטים של הרשות = סכום המסלולים', additivity: 'Q1+Q2=H1, H1+Q3=9M באותו דוח', additivity_vintage: 'אדיטיביות בין דוחות (הצגה מחדש)',
  additivity_funds: 'אדיטיביות, בתי השקעות', units: 'יחידות: למניה ומספר מניות', latin: 'תוויות בעברית', placeholder: 'אין כיתובי מילוי', derived: 'נגזר רק על שורות זרם',
  ifrs_slices: 'קובצי IFRS 17 לפי חברה = הקובץ הענפי', ifrs_page: 'כל נתון IFRS 17 מודפס בעמוד שצוטט', ifrs_page_known: 'חריגים ידועים: גרפים ועמודי תמונה', balance: 'מאזן: נכסים = הון + התחייבויות',
  balance_round: 'מאזן: סטייה מעל עיגול', cross_layer: 'XBRL = הדוחות הכספיים', lens: 'עדשת החיסכון = חישוב מחדש', schemas: 'חוזי נתונים: כל קובץ תואם לסכמה',
  consistency: 'נתון אחד בכל העמודים', fund_roles: 'בתי השקעות: שורות הרווח = XBRL', consistency_old: 'עקביות לפני החלון (היסטוריה)',
};
const CO_HE: Record<string, string> = { phoenix: 'הפניקס', harel: 'הראל', migdal: 'מגדל', clal: 'כלל', menora: 'מנורה', hachshara: 'הכשרה', ayalon: 'איילון', altshuler: 'אלטשולר שחם', meitav: 'מיטב', more: 'מור', analyst: 'אנליסט', yelin: 'ילין לפידות', ibi: 'אי.בי.אי' };
const BASIS_HE: Record<string, string> = { alt: 'שורת רווח לתקופה', filer: 'ישות מדווחת אחרת', restated: 'הוצג מחדש', std: 'IFRS 4 מול IFRS 17', allow: 'רשימת חריגים' };
/** The gate writes its details in English (a terminal tool); the page reads them in Hebrew: the numbers of the note in a Hebrew sentence per check.
    A note this page does not know yet is shown as the counts, with the original in the tooltip. */
function noteHe(x: { id: string; n: number; fail: number; note: string }): string {
  const t = x.note, N = (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []), cos = (s: string) => s.replace(/\b([a-z_]+)\b/g, (w) => CO_HE[w] ?? w).replace(/[{}']/g, '').replace(/:\s*/g, ' ');
  const tail = (sep: string) => { const i = t.indexOf(sep); return i < 0 ? '' : t.slice(i + sep.length).trim(); };
  switch (x.id) {
    case 'workbook': return `${x.n} חברות · ${x.fail} בעיות בגיליונות`;
    case 'prov': return `${N[0] ?? '–'} אגרגטים · ${N[1] ?? '–'} חודשי מסלול · ${N[2] ?? '–'} הפרשים · ${N[3] ?? '–'} רכיבים ללא אגרגט`;
    case 'additivity': return `פערים באותו דוח (IFRS 17, 2024 ואילך): ${/none\s*$/.test(t) ? 'אין' : cos(tail('):'))}`;
    case 'additivity_vintage': return `פערים בין דוחות (הצגה מחדש בין דוחות; מודל גרסאות מלא בשלב 3): ${cos(tail('):'))}`;
    case 'additivity_funds': return `בתי השקעות, 2024 ואילך: ${N[1] ?? '–'} פערים באותו דוח, ${N[2] ?? '–'} בין דוחות`;
    case 'units': return `${N[0] ?? '–'} ערכים למניה מחוץ לטווח 0.01–500 · ${N[3] ?? '–'} שורות מספר מניות שלא סומנו`;
    case 'latin': return 'תוויות עם שלוש מילים לועזיות ברצף או יותר';
    case 'placeholder': return 'כיתובי מילוי במקום שם שורה';
    case 'derived': return 'Q4 או H2 נגזרים על שורות שאינן זרם (יתרות)';
    case 'ifrs_slices': return 'קובץ IFRS 17 של כל חברה ותקופה = שורות החברה בקובץ הענפי';
    case 'ifrs_page': return `${N[0] ?? '–'}/${N[1] ?? '–'} מודפסים בעמוד שצוטט · ${N[2] ?? '–'} פספוסים חדשים · ${N[3] ?? '0'} נתונים בלי טקסט עמוד`;
    case 'ifrs_page_known': return `חריגים ידועים בשכבת החילוץ (גרפים, עמודי תמונה, יעדים במילים): ${cos(tail('):'))}`;
    case 'balance': return `נכסים = התחייבויות + הון בכל תאריך מאזן · סטייה מעל 1%: ${N[1] ?? x.fail}`;
    case 'balance_round': return `סטייה מעבר לעיגול אך מתחת ל-1%: ${cos(tail(':'))}`;
    case 'cross_layer': return `רווח והון לבעלי המניות, ${t.match(/Q\d'\d\d/)?.[0] ?? ''}: XBRL = הדוחות הכספיים`;
    case 'lens': return `עדשת החיסכון זהה לחישוב מחדש · ${N[0] ?? '–'} שורות רבעון · ${N[1] ?? '–'} פערי נוסחה`;
    case 'consistency': { const b = t.match(/\(([^)]*)\)/)?.[1] ?? ''; return `${N[0] ?? '–'} זהים בעיגול · ${N[1] ?? '–'} הבדלי בסיס מסומנים (${b.split(',').map((y) => { const [k, v] = y.trim().split(/\s+/); return `${BASIS_HE[k] ?? k} ${v ?? ''}`.trim(); }).join(', ')}) · 8 רבעונים אחרונים`; }
    case 'fund_roles': return 'בתי השקעות, ארבעה רבעונים אחרונים: רווח ורווח כולל לבעלי המניות בדף החברה = XBRL';
    case 'consistency_old': return 'פערים לפני שמונת הרבעונים האחרונים (תקופת IFRS 4, תיקוני תגים)';
    case 'schemas': return `${N[0] ?? '–'} קבצים תחת חוזה · ${N[1] ?? '–'} נכשלים · ${N[2] ?? '–'} חוזים · ${N[3] ?? '–'} קבצים ללא חוזה`;
  }
  return `נבדקו ${nf(x.n, 0)} · חריגים ${nf(x.fail, 0)}`;
}
const pl = (p: string | null) => (!p ? '–' : /^\d{6}$/.test(p) ? monthLabel(Number(p)) : /^\d{4}-\d{2}$/.test(p) ? monthLabel(Number(p.replace('-', ''))) : /^\d{4}-\d{2}-\d{2}/.test(p) ? pubLabel(p) : p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const days = (iso: string | null, now: Date) => (iso ? Math.floor((now.getTime() - Date.parse(iso.slice(0, 10))) / 864e5) : null);
const kb = (b: number) => (b >= 1048576 ? `${nf(b / 1048576, 1)} MB` : `${nf(b / 1024, 0)} KB`);

export function DataPage() {
  const cov = useLoad<Cov>('coverage.json');
  const qa = useLoad<Qa>('qa.json');
  if (cov.error) return <ErrorBox what="נתוני הכיסוי" error={cov.error} />;
  if (!cov.data) return <Loading what="נתונים ואיכות" />;
  return <Inner c={cov.data} qa={qa.data} qaError={qa.error} />;
}

function Inner({ c, qa, qaError }: { c: Cov; qa: Qa | null; qaError: string | null }) {
  const now = useMemo(() => new Date(), []);
  const cells = c.companies.flatMap((co) => c.layers.map((l) => c.cells[co.id]?.[l.id]?.s ?? 'missing'));
  const applicable = cells.filter((s) => s !== 'na').length, fresh = cells.filter((s) => s === 'fresh').length;
  const pass = qa?.checks.filter((x) => x.ok).length ?? 0, warns = qa?.checks.filter((x) => !x.ok && x.level === 'warn').length ?? 0, fails = qa?.checks.filter((x) => !x.ok && x.level === 'fail').length ?? 0;
  const breach = (s: Cov['sources'][number]) => {
    const age = days(s.checked, now);
    const late = s.behind.filter((b) => b.filed && (days(b.filed, now) ?? 0) > s.sla_days);
    return { age, late, bad: (s.age_rule !== false && age != null && age > s.sla_days) || late.length > 0 };
  };
  const inSla = c.sources.filter((s) => !breach(s).bad).length;
  const totalBytes = c.files.reduce((t, f) => t + f.bytes, 0), totalFiles = c.files.reduce((t, f) => t + f.files, 0);
  const name = (id: string) => c.companies.find((x) => x.id === id)?.name ?? id;

  const covCols: Column<Cov['companies'][number]>[] = [
    { key: 'co', head: 'חברה', value: (co) => co.name, cell: (co) => <span className="co"><Link to={`/company/${co.id}`}>{co.name}</Link><small>{co.expected ? <>דוח אחרון <span className="num">{pl(co.expected)}</span>{co.inactive ? ' · לא פעילה' : ''}</> : 'ללא דוחות תקופתיים'}</small></span> },
    ...c.layers.map((l): Column<Cov['companies'][number]> => ({
      key: l.id, head: l.label, title: `${l.label} · ${CADENCE[l.cadence] ?? l.cadence}`,
      value: (co) => ({ fresh: 3, stale: 2, missing: 1, na: 0 })[c.cells[co.id]?.[l.id]?.s ?? 'missing'],
      text: (co) => { const x = c.cells[co.id]?.[l.id]; return x ? `${ST_HE[x.s]}${x.last ? ` ${pl(x.last)}` : ''}` : ''; },
      cell: (co) => { const x = c.cells[co.id]?.[l.id] ?? { s: 'missing' as St, last: null, n: null };
        return <span className={`cv ${x.s}`} title={`${l.label} · ${co.name} · ${ST_HE[x.s]}${x.last ? ` · ${pl(x.last)}` : ''}${x.n != null ? ` · ${nf(x.n, 0)}` : ''}`}>{x.s === 'na' ? '·' : x.last ? <span className="num">{pl(x.last)}</span> : ST_HE[x.s]}</span>; },
    })),
  ];

  return (
    <div className="dq wide-page">
      <div className="pagehead"><div><h1>נתונים ואיכות</h1><div className="sub">כיסוי, בדיקות ורעננות לפי מקור · נבנה <span className="num">{pubLabel(c.built)}</span></div></div></div>

      <section className="kpis">
        <div className="kpi"><div className="l">כיסוי</div><div className="v num">{fmt((fresh / Math.max(1, applicable)) * 100, 'pct', { d: 0 })}</div><div className="s"><span className="num">{fresh}/{applicable}</span> תאים עדכניים · {c.companies.length} חברות × {c.layers.length} שכבות</div></div>
        <div className="kpi"><div className="l">בדיקות איכות</div><div className={`v num ${fails ? 'neg' : ''}`}>{qa ? `${pass}/${qa.checks.length}` : '–'}</div><div className="s">{fails ? <span className="chip bad">{fails} נכשלו</span> : <span className="chip pass">ללא כשל חוסם</span>}{warns > 0 && <span className="chip est">{warns} אזהרות</span>}</div></div>
        <div className="kpi"><div className="l">מקורות בתוך היעד</div><div className={`v num ${inSla < c.sources.length ? 'neg' : ''}`}>{inSla}/{c.sources.length}</div><div className="s">יעד הרענון של fox לכל מקור</div></div>
        <div className="kpi"><div className="l">קבצים פתוחים</div><div className="v num">{nf(totalFiles, 0)}</div><div className="s"><span className="num">{kb(totalBytes)}</span> · {c.files.length} משפחות · JSON עם חוזה</div></div>
      </section>

      <Panel title="מטריצת כיסוי" aside={<div className="cov-legend">{(['fresh', 'stale', 'missing', 'na'] as St[]).map((s) => <span key={s}><span className={`cv ${s}`}>{s === 'na' ? '·' : ST_HE[s]}</span> {s === 'fresh' ? 'כולל את הדוח האחרון שפורסם' : s === 'stale' ? 'תקופה קודמת' : s === 'missing' ? 'אין נתונים' : 'לא רלוונטי'}</span>)}</div>}>
        <DataTable className="cov" caption="מטריצת כיסוי: חברות מול שכבות נתונים" rows={c.companies} rowKey={(co) => co.id} columns={covCols}
          export={{ name: 'fox-coverage', title: 'מטריצת כיסוי', note: `נבנה ${pubLabel(c.built)} · עדכני = השכבה כוללת את הדוח האחרון שהחברה פרסמה` }} />
        <div className="src">התא מציג את התקופה האחרונה בשכבה (רבעון, חודש רשות או תאריך מחיר) מול הדוח האחרון שהחברה פרסמה ב-MAYA. מחיר מניה: קלט לעמודי הערכת שווי בלבד.</div>
      </Panel>

      <div className="dq-stack">
        <Panel title="בדיקות איכות" aside={qa && <span>gate · <span className="num">{pubLabel(qa.built)}</span> · כשל חוסם עוצר פריסה</span>}>
          {qaError ? <ErrorBox what="תוצאות הבדיקות" error={qaError} /> : !qa ? <Loading what="בדיקות" /> : (
            <DataTable caption="בדיקות איכות" rows={qa.checks} rowKey={(x) => x.id} export={{ name: 'fox-qa', title: 'בדיקות איכות', note: `pipeline/gate.py · ${pubLabel(qa.built)}` }} columns={[
              { key: 'id', head: 'בדיקה', value: (x) => CHECK_HE[x.id] ?? x.id, cell: (x) => <>{CHECK_HE[x.id] ?? x.id}<span className="dim mono" dir="ltr">{x.id}</span></> },
              { key: 'ok', head: 'מצב', value: (x) => (x.ok ? 2 : x.level === 'warn' ? 1 : 0), text: (x) => (x.ok ? 'עבר' : x.level === 'warn' ? 'אזהרה' : 'נכשל'), firstDir: 'asc',
                cell: (x) => <span className={`chip ${x.ok ? 'pass' : x.level === 'warn' ? 'est' : 'bad'}`}>{x.ok ? 'עבר' : x.level === 'warn' ? 'אזהרה' : 'נכשל'}</span> },
              { key: 'n', head: 'נבדקו', value: (x) => x.n, unit: 'int' },
              { key: 'fail', head: 'חריגים', value: (x) => x.fail, unit: 'int', tone: 'neg', cell: (x) => <span className={`num ${x.fail && x.level === 'fail' ? 'neg' : x.fail ? 'muted' : ''}`}>{nf(x.fail, 0)}</span> },
              { key: 'note', head: 'פירוט', tdClass: () => 'notecell', text: (x) => noteHe(x), cell: (x) => <span className="note" title={x.note}>{noteHe(x)}</span> },
            ]} />
          )}
        </Panel>

        <Panel title="רעננות לפי מקור" aside={<span>יעד: יעד רענון של fox, לא התחייבות של המקור</span>}>
          <DataTable caption="רעננות לפי מקור" rows={c.sources} rowKey={(s) => s.id} export={{ name: 'fox-freshness', title: 'רעננות לפי מקור', note: `נבדק ${pubLabel(now.toISOString())}` }} columns={[
            { key: 's', head: 'מקור', value: (s) => s.label, cell: (s) => <><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a><span className="dim">{CADENCE[s.cadence] ?? s.cadence}</span></> },
            { key: 'asof', head: 'נתונים עד', value: (s) => s.asof, text: (s) => pl(s.asof), cell: (s) => <span className="num">{pl(s.asof)}</span> },
            { key: 'chk', head: 'נקרא', value: (s) => s.checked, text: (s) => pubLabel(s.checked), cell: (s) => <span className="num">{s.checked ? pubLabel(s.checked) : '–'}</span> },
            { key: 'age', head: 'ימים', value: (s) => breach(s).age, unit: 'int', firstDir: 'desc' },
            { key: 'sla', head: 'יעד', value: (s) => s.sla_days, text: (s) => `≤ ${s.sla_days} ימים`, cell: (s) => <span className="muted">≤ <span className="num">{s.sla_days}</span> ימים</span> },
            { key: 'st', head: 'מצב', value: (s) => (breach(s).bad ? 0 : 1), firstDir: 'asc', text: (s) => (breach(s).bad ? 'חריגה' : 'בתוך היעד'),
              cell: (s) => { const b = breach(s); return <span className="chips"><span className={`chip ${b.bad ? 'bad' : 'pass'}`}>{b.bad ? 'חריגה' : 'בתוך היעד'}</span>
                {s.behind.map((x) => <span key={x.id} className={`chip ${b.late.includes(x) ? 'est' : ''}`} title={`${name(x.id)} · ${pl(x.period)} פורסם ${pubLabel(x.filed)} · חסר ב: ${x.layers.map((l) => c.layers.find((y) => y.id === l)?.label ?? l).join(', ')}`}>{name(x.id)} <span className="num">{pl(x.period)}</span></span>)}</span>; } },
          ]} />
          <div className="src">חריגה: המקור לא נקרא בתוך היעד, או שדוח שפורסם לפני יותר מ-{c.sources.find((s) => s.id === 'maya')?.sla_days ?? 7} ימים עדיין חסר באחת השכבות שהמקור מזין.</div>
        </Panel>
      </div>

      <ConsistencyPanel name={name} />

      <Panel title="קבצי נתונים פתוחים" aside={<a href="/data/schemas.json" download>חוזי הנתונים (JSON Schema)</a>}>
        <div className="licence"><b>נתונים ממקורות ציבוריים; ציטוט עם קישור</b><span className="muted">כל מספר באתר מקושר למסמך או לקובץ שממנו נלקח</span>
          <a href="https://maya.tase.co.il/" target="_blank" rel="noreferrer">MAYA</a><a href="https://data.gov.il/dataset/gemelnet" target="_blank" rel="noreferrer">data.gov.il</a><a href="https://www.boi.org.il/" target="_blank" rel="noreferrer">בנק ישראל</a><a href="https://www.cbs.gov.il/" target="_blank" rel="noreferrer">הלמ"ס</a></div>
        <DataTable caption="קבצי נתונים פתוחים" rows={c.files} rowKey={(f) => f.pattern} sort={{ key: 'bytes', dir: 'desc' }} export={{ name: 'fox-files', title: 'קבצי נתונים פתוחים', note: 'נתונים ממקורות ציבוריים; ציטוט עם קישור' }} columns={[
          { key: 'p', head: 'קובץ', value: (f) => f.pattern, cell: (f) => <a className="mono" dir="ltr" href={`/data/${f.example}`} target="_blank" rel="noreferrer">data/{f.pattern}</a> },
          { key: 'c', head: 'חוזה', value: (f) => f.contract, cell: (f) => <span className="mono" dir="ltr">{f.contract}</span> },
          { key: 'n', head: 'קבצים', value: (f) => f.files, unit: 'int' },
          { key: 'bytes', head: 'גודל', value: (f) => f.bytes, text: (f) => kb(f.bytes), cell: (f) => <span className="num">{kb(f.bytes)}</span> },
        ]} />
      </Panel>

      <CiteGenerator c={c} />
    </div>
  );
}

const PAGES: [string, string][] = [
  ['/', 'דף הבית'], ['/industry/peers', 'טבלת עמיתים'], ['/industry/csm', 'IFRS 17 · CSM · הון'], ['/industry/savings', 'עדשת חיסכון'], ['/funds', 'מסלולים'], ['/managers', 'מנהלים'], ['/calendar', 'לוח דיווחים'], ['/data', 'נתונים ואיכות'],
];

/** "fox · page · figure · data date · original source · link · seen": built from the page's own route, with the data date and the source
 *  taken from coverage.json; every field can be edited. A page can open it prefilled: /data?cite=<path>&f=<figure>#cite. */
function CiteGenerator({ c }: { c: Cov }) {
  const [sp] = useSearchParams();
  const reg = useRegistry().data;
  const [path, setPath] = useState(sp.get('cite') ?? '/industry/peers');
  const [figure, setFigure] = useState(sp.get('f') ?? '');
  const [asof, setAsof] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [fmtSel, setFmt] = useState<CiteFormat>('text');
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => { if (sp.get('cite')) document.getElementById('cite')?.scrollIntoView({ block: 'start' }); }, [sp]);

  const clean = path.trim().replace(/^https?:\/\/[^/]+/, '') || '/';
  const route = clean.split(/[?#]/)[0];
  const seg = route.split('/').filter(Boolean);
  const company = (seg[0] === 'company' || seg[0] === 'valuation') && seg[1] ? c.companies.find((x) => x.id === seg[1]) : undefined;
  const src = (id: string) => c.sources.find((s) => s.id === id);
  // what the page is built from: a company page from its filings, the savings and fund pages from the regulator's monthly files
  const auto = seg[0] === 'valuation' ? { asof: company?.expected ? pl(company.expected) : null, source: 'דוחות תקופתיים (MAYA) ומחירי TASE' }
    : company ? { asof: company.expected ? pl(company.expected) : null, source: 'דוחות תקופתיים, MAYA' }
    : ['funds', 'managers', 'market'].includes(seg[0]) || (seg[0] === 'industry' && seg[1] === 'savings') ? { asof: pl(src('reg')?.asof ?? null), source: 'רשות שוק ההון, data.gov.il' }
    : seg[0] === 'industry' ? { asof: pl(c.companies.map((x) => x.expected).filter((x): x is string => !!x).sort(byPeriodDesc)[0] ?? null), source: 'דוחות תקופתיים, MAYA' }
    : { asof: pubLabel(c.built), source: 'MAYA; רשות שוק ההון; בנק ישראל' };
  const names = new Map(reg?.map((x) => [x.id, x.name_he]));
  const title = titleFor(route, (id) => names.get(id))?.replace(/ · fox$/, '').replace(/^fox · /, '') ?? clean;
  const url = `${location.origin}${clean}`;
  const text = citation({ title, figure: figure.trim() || undefined, asof: (asof ?? auto.asof) || undefined, source: (source ?? auto.source) || undefined, url }, fmtSel);

  return (
    <Panel title="מחולל ציטוט" className="cite-panel" aside={<span>לכל עמוד ולכל נתון באתר</span>}>
      <div id="cite" className="cite">
        <Field label="עמוד"><input type="text" dir="ltr" list="cite-pages" value={path} onChange={(e) => { setPath(e.target.value); setAsof(null); setSource(null); }} placeholder="/company/harel" /></Field>
        <datalist id="cite-pages">{PAGES.map(([p, l]) => <option key={p} value={p}>{l}</option>)}{c.companies.filter((x) => x.expected).map((x) => <option key={x.id} value={`/company/${x.id}`}>{x.name}</option>)}</datalist>
        <Field label="נתון (לא חובה)"><input type="text" value={figure} onChange={(e) => setFigure(e.target.value)} placeholder="CSM נטו, Q2'26" /></Field>
        <Field label="נתונים נכון ל"><input type="text" value={asof ?? auto.asof ?? ''} onChange={(e) => setAsof(e.target.value)} /></Field>
        <Field label="מקור מקורי"><input type="text" value={source ?? auto.source} onChange={(e) => setSource(e.target.value)} /></Field>
      </div>
      <div className="cite-out">
        <output aria-live="polite" dir={fmtSel === 'text' ? 'rtl' : 'auto'}>{text}</output>
        <div className="row">
          <Seg<CiteFormat> label="תבנית" value={fmtSel} onChange={setFmt} options={[['text', 'טקסט'], ['md', 'Markdown'], ['html', 'HTML']]} />
          <button type="button" className="btn primary" onClick={() => copyText(text, setCopied)}>{copied == null ? 'העתק ציטוט' : copied ? 'הועתק' : 'ההעתקה נחסמה: סמנו את הטקסט'}</button>
        </div>
      </div>
    </Panel>
  );
}
