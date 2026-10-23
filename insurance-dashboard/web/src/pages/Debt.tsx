import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { DataTable, type Column } from '../components/DataTable';
import { DebtLadder, type LadderPart } from '../components/DebtLadder';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Seg } from '../components/ui';
import { foxOption } from '../lib/foxchart';
import { dateLabel, fmt, nf, pubLabel } from '../lib/format';
import { idColor, idCss } from '../lib/identity';
import type { Prov } from '../lib/prov';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { downloadXlsx, type XCell } from '../lib/xlsx';
import { NotFound } from './NotFound';
import '../styles/debt.css';

/* /debt and /debt/:id · חוב ופירעונות. The liabilities schedules (MAYA form ת126) of the groups and their bond-issuing subsidiaries,
   parsed by code (pipeline/build_debt.py). Every figure opens the cell of the form it comes from (report, table, row, column);
   sums open their parts. NIS thousands in the files, NIS millions on screen. */

/* ---------- data files ---------- */
type Role = 'parent' | 'capital' | 'sub';
type Cell = [number, string, string, ...number[]];
interface Rep { rid: number; e: number; end: string; pub: string; ref: string | null; url: string; fixed: boolean; issues?: Record<string, string[]>; title_end?: string }
interface Bs { end: string; form: number; bs: number; labels: string[]; pg: number | null; url: string | null; gap: number; gap_pct: number | null }
interface Ent { maya_id: number; name: string; role: Role; corp: string | null; legal: string | null }
export interface DebtFile {
  id: string; name: string; kind: 'ins' | 'fund'; built: string; source: string; files: string; cols: string[]; col_he: Record<string, string>;
  entities: Ent[]; reports: Rep[]; free: Record<string, Record<string, string>>; cells: Cell[];
  views: { end: string; rids: Record<string, number>; in_parent_h: Record<string, boolean>; warn?: string[] }[]; bs: Bs[];
  series: { asof: string; rows: [number, string, string, string, string, number | null][] } | null;
}
type B = Record<string, [number, number]>;
interface WallPart { k: 'solo' | 'subs' | 'sep'; e: number; rid: number; url: string; ref: string | null; b: B }
interface Cov { end: string; profit_ltm?: { v: number; parts: [string, number, number | null, string | null, number][] }; dividend_fy?: { fy: string; v: number; pg: number | null; u: string | null } }
interface Wall { end: string; parts: WallPart[]; cov?: Cov }
interface IdxCo { id: string; name: string; kind: 'ins' | 'fund'; entities: [number, string, Role][]; walls: Wall[]; bs: Bs[]; issues: number; forms: number }
export interface DebtIndex {
  built: string; source: string; files: string; since: string; listed: string; companies: IdxCo[]; none: [string, string][];
  checks: { listed: number; forms: number; parsed: number; tables: number; passed: number; pass_rate: number | null; failed: [string, number, string, number, string, string][]; warnings: [string, number, string, number, string, string][]; no_htm: number; replaced: number; title_mismatch: number };
}

/* ---------- vocabulary ---------- */
const BK = ['y1', 'y2', 'y3', 'y4', 'y5p'] as const;
const BK_HE: Record<string, string> = { y1: 'שנה 1', y2: 'שנה 2', y3: 'שנה 3', y4: 'שנה 4', y5p: 'שנה 5+', y5: 'שנה 5', y6p: 'שנה 6+', once: 'חד פעמי', total: 'סה"כ' };
/** older forms split year 5 and 6+: both fold into 5+ */
const bucketOf = (rk: string) => (rk === 'y5' || rk === 'y6p' ? 'y5p' : rk);
const T_HE: Record<string, [string, string]> = {
  pub: ['א', 'אג"ח לציבור'], priv: ['ב', 'אג"ח פרטיות ואשראי חוץ בנקאי'], bank: ['ג', 'אשראי בנקאי בישראל'], bank_abroad: ['ד', 'אשראי בנקאי בחו"ל'],
  solo: ['ה', 'סולו: סיכום א–ד'], offbal: ['ו', 'חשיפה חוץ מאזנית, סולו'], offbal_subs: ['ז', 'חשיפה חוץ מאזנית, מאוחדות'], subs: ['ח', 'חברות מאוחדות שאינן מדווחות'],
  from_parent: ['ט', 'מחברת האם'], from_sister: ['י', 'מחברות אחיות'], from_subs: ['י"א', 'מחברות מאוחדות'],
};
const ROLE_HE: Record<Role, string> = { parent: 'החברה האם', capital: 'חברת גיוס הון', sub: 'חברה בת מדווחת' };
const PART_HE: Record<WallPart['k'], string> = { solo: 'האם, סולו (ה)', subs: 'מאוחדות (ח)', sep: 'מנפיקה נפרדת' };
const UNIT = 'מיליוני ש"ח';
const m = (k: number) => k / 1000;
const mf = (k: number | null | undefined) => (k == null ? '–' : fmt(m(k), 'm'));
const formName = (end: string) => `ת126 ${dateLabel(end)}`;

/** One cell of one form, as its source. */
function cellProv(files: string, rep: Rep, entity: string, table: string, rk: string, col: string, v: number): Prov {
  const [letter, th] = T_HE[table] ?? [table, table];
  return { k: 'report', title: `${th} · ${BK_HE[rk] ?? rk} · ${col} · ${entity}`, value: mf(v), unit: UNIT, url: files + rep.url, pg: null,
    doc: `${entity}, מצבת התחייבויות (${formName(rep.end)})`, period: dateLabel(rep.end), srcType: 'טופס ת126 (MAYA)',
    note: `טבלה ${letter} · שורה "${BK_HE[rk] ?? rk}" · עמודה "${col}"${rep.ref ? ` · אסמכתא ${rep.ref}` : ''} · פורסם ${pubLabel(rep.pub)}${rep.fixed ? ' · דוח מתוקן' : ''}` };
}
const sumProv = (title: string, total: number, inputs: { label: string; v: number; src?: () => Prov }[], formula = 'סכום התאים בטופס'): Prov =>
  ({ k: 'calc', title, value: mf(total), unit: UNIT, formula, inputs: inputs.filter((x) => x.v).map((x) => ({ label: x.label, v: mf(x.v), src: x.src })) });

/* ====================================================================================================== */
export function Debt() {
  const { id } = useParams();
  return id ? <DebtCompany id={id} /> : <DebtIndustry />;
}

function useSet() {
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string) => setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  return [sp, set] as const;
}

/* ---------- industry: the maturity wall of every group, side by side ---------- */
function DebtIndustry() {
  const { data, error } = useLoad<DebtIndex>('debt/index.json');
  const [sp, set] = useSet();
  const phone = usePhone();
  const kind = sp.get('k') === 'fund' ? 'fund' : 'ins';
  const withInt = sp.get('i') !== '0';
  const cos = useMemo(() => (data?.companies ?? []).filter((c) => c.kind === kind && c.walls.length), [data, kind]);
  const dates = useMemo(() => [...new Set(cos.flatMap((c) => c.walls.map((w) => w.end)))].sort().reverse(), [cos]);
  // default: the latest date most groups have filed
  const common = dates.find((d) => cos.filter((c) => c.walls.some((w) => w.end === d)).length >= Math.ceil(cos.length * 0.75)) ?? dates[0];
  const D = sp.get('d') && dates.includes(sp.get('d')!) ? sp.get('d')! : common;
  if (error) return <ErrorBox what="מצבת ההתחייבויות" error={error} />;
  if (!data) return <Loading what="מצבת ההתחייבויות" />;
  const files = data.files;
  const wallOf = (c: IdxCo) => c.walls.find((w) => w.end === D);
  const bucketSum = (c: IdxCo, w: Wall, bk: string, which: 0 | 1) => wallCell(files, c, w, bk, which);
  const rows = cos.map((c) => {
    const w = wallOf(c);
    const cell = (bk: string, which: 0 | 1) => (w ? bucketSum(c, w, bk, which) : null);
    return { c, w, cell };
  });
  const shown = rows.filter((r) => r.w);
  const val = (r: (typeof rows)[number], bk: string) => { const p = r.cell(bk, 0)?.v ?? 0, i = r.cell(bk, 1)?.v ?? 0; return withInt ? p + i : p; };
  const parts: LadderPart[] = shown.flatMap((r) => [
    { name: r.c.name, group: r.c.name, color: idColor(r.c.id), data: BK.map((bk) => m(r.cell(bk, 0)?.v ?? 0)) },
    ...(withInt ? [{ name: `${r.c.name} · ריבית`, group: r.c.name, color: idColor(r.c.id), interest: true, data: BK.map((bk) => m(r.cell(bk, 1)?.v ?? 0)) }] : []),
  ]);
  const prov = (r: (typeof rows)[number], bk: string, which: 0 | 1 | 2): Prov => {
    const p = r.cell(bk, 0)!, i = r.cell(bk, 1)!;
    const t = `${r.c.name} · ${BK_HE[bk]} · ${dateLabel(D)}`;
    if (which === 0) return sumProv(`קרן · ${t}`, p.v, p.inputs);
    if (which === 1) return sumProv(`ריבית · ${t}`, i.v, i.inputs);
    return sumProv(`קרן וריבית · ${t}`, p.v + i.v, [{ label: 'קרן', v: p.v, src: () => prov(r, bk, 0) }, { label: 'ריבית', v: i.v, src: () => prov(r, bk, 1) }], 'קרן + ריבית');
  };
  const totalOf = (r: (typeof rows)[number], which: 0 | 1) => BK.reduce((s, bk) => s + (r.cell(bk, which)?.v ?? 0), 0);
  const totProv = (r: (typeof rows)[number], which: 0 | 1): Prov => sumProv(`${which ? 'ריבית' : 'קרן'} · כל השנים · ${r.c.name} · ${dateLabel(D)}`, totalOf(r, which),
    BK.map((bk) => ({ label: BK_HE[bk], v: r.cell(bk, which)?.v ?? 0, src: () => prov(r, bk, which) })), 'סכום השנים');
  type R = (typeof rows)[number];
  const cols: Column<R>[] = [
    { key: 'co', head: 'קבוצה', value: (r) => r.c.name, cell: (r) => <Link to={`/debt/${r.c.id}?d=${D}`} className="dl-co"><i className="pdot" style={{ background: idCss(r.c.id) }} />{r.c.name}</Link> },
    ...BK.map((bk): Column<R> => ({ key: bk, head: BK_HE[bk], unit: 'm', value: (r) => (r.w && val(r, bk) ? m(val(r, bk)) : null), src: (r) => (r.w ? prov(r, bk, withInt ? 2 : 0) : null), total: 'sum' })),
    { key: 'p', head: 'קרן, סה"כ', unit: 'm', value: (r) => (r.w ? m(totalOf(r, 0)) : null), src: (r) => (r.w ? totProv(r, 0) : null), total: 'sum' },
    { key: 'i', head: 'ריבית, סה"כ', unit: 'm', value: (r) => (r.w ? m(totalOf(r, 1)) : null), src: (r) => (r.w ? totProv(r, 1) : null), total: 'sum', className: 'wide-only' },
  ];
  // next 12 months against what the group earns and distributes (insurers: csm/capital.json)
  const covRows = shown.filter((r) => r.c.kind === 'ins');
  const n12 = (r: R) => (r.cell('y1', 0)?.v ?? 0) + (r.cell('y1', 1)?.v ?? 0);
  const profit = (r: R) => r.w?.cov?.profit_ltm?.v ?? null;
  const profitProv = (r: R): Prov => { const pl = r.w!.cov!.profit_ltm!; return { k: 'calc', title: `רווח מיוחס לבעלים, LTM · ${r.c.name} · ${dateLabel(D)}`, value: fmt(pl.v, 'm'), unit: UNIT, formula: 'סכום ארבעת הרבעונים האחרונים',
    inputs: pl.parts.map(([q, v, pg, u, der]) => ({ label: `${q.slice(4)}'${q.slice(2, 4)}${der ? ' (FY פחות 9M)' : ''}`, v: fmt(v, 'm'), src: () => ({ k: 'report', title: `רווח מיוחס לבעלים · ${r.c.name} · ${q}`, value: fmt(v, 'm'), unit: UNIT, url: u, pg, der: !!der }) })) }; };
  const covCols: Column<R>[] = [
    cols[0],
    { key: 'p1', head: 'קרן, 12 ח׳', unit: 'm', value: (r) => m(r.cell('y1', 0)?.v ?? 0), src: (r) => prov(r, 'y1', 0) },
    { key: 'i1', head: 'ריבית, 12 ח׳', unit: 'm', value: (r) => m(r.cell('y1', 1)?.v ?? 0), src: (r) => prov(r, 'y1', 1) },
    { key: 'n12', head: 'שירות חוב, 12 ח׳', unit: 'm', value: (r) => m(n12(r)), src: (r) => prov(r, 'y1', 2) },
    { key: 'pl', head: 'רווח LTM', title: 'רווח מיוחס לבעלי המניות, ארבעה רבעונים עד תאריך המצבת', unit: 'm', value: (r) => profit(r), src: (r) => (profit(r) != null ? profitProv(r) : null) },
    { key: 'x', head: 'רווח ÷ שירות חוב', unit: 'x', d: 1, value: (r) => (profit(r) != null && n12(r) ? profit(r)! / m(n12(r)) : null),
      src: (r) => ({ k: 'calc', title: `רווח LTM ÷ שירות חוב 12 ח׳ · ${r.c.name}`, value: `${nf(profit(r)! / m(n12(r)), 1)}×`, formula: 'רווח מיוחס LTM ÷ (קרן + ריבית בשנה הראשונה)',
        inputs: [{ label: 'רווח LTM', v: fmt(profit(r), 'm'), src: () => profitProv(r) }, { label: 'שירות חוב 12 ח׳', v: mf(n12(r)), src: () => prov(r, 'y1', 2) }] }) },
    { key: 'dv', head: 'דיבידנד שהוכרז, FY', unit: 'm', d: 0, value: (r) => r.w?.cov?.dividend_fy?.v ?? null,
      src: (r) => { const d = r.w!.cov!.dividend_fy!; return { k: 'report', title: `דיבידנד שהוכרז · ${r.c.name} · FY'${d.fy.slice(2, 4)}`, value: fmt(d.v, 'm'), unit: UNIT, url: d.u, pg: d.pg, period: `FY'${d.fy.slice(2, 4)}` }; },
      text: (r) => r.w?.cov?.dividend_fy ? `${r.w.cov.dividend_fy.v} (FY'${r.w.cov.dividend_fy.fy.slice(2, 4)})` : '' },
  ];
  // the trend: total principal by date per group
  const allDates = dates.slice().reverse();
  const trend = foxOption({ x: allDates.map(dateLabel), unit: UNIT, series: cos.map((c) => ({ name: c.name, kind: 'line', color: idColor(c.id),
    data: allDates.map((d) => { const w = c.walls.find((x) => x.end === d); return w ? m(w.parts.reduce((s, p) => s + (p.b.total?.[0] ?? 0), 0)) : null; }) })), labels: false });
  const ck = data.checks;
  const staleCos = cos.filter((c) => !wallOf(c));

  return (
    <div className="dl">
      <div className="pagehead"><div><h1>חוב ופירעונות</h1>
        <div className="sub"><span>מצבת התחייבויות לפי מועדי פירעון (טופס ת126) · <span className="num">{shown.length}</span> קבוצות · {dateLabel(D)} · מאוחד לפי הטופס: האם סולו, מאוחדות שאינן מדווחות ומנפיקות נפרדות</span></div></div>
      </div>
      <section className="controls dl-controls">
        <div className="field"><span>קבוצות</span><Seg<string> label="קבוצות" value={kind} onChange={(v) => set('k', v === 'ins' ? '' : v)} options={[['ins', 'ביטוח'], ['fund', 'בתי השקעות']]} /></div>
        <label className="field"><span>תאריך המצבת</span>
          <select value={D} onChange={(e) => set('d', e.target.value === common ? '' : e.target.value)}>{dates.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</select></label>
        <div className="field"><span>הצגה</span><Seg<string> label="הצגה" value={withInt ? '1' : '0'} onChange={(v) => set('i', v === '1' ? '' : '0')} options={[['1', 'קרן וריבית'], ['0', 'קרן']]} /></div>
      </section>

      <section className="panel">
        <div className="hd"><h2>חומת הפירעונות</h2><div className="aside"><span>{phone ? '' : `${UNIT} · קרן מלאה, ריבית מקווקוות · `}לחיצה על קבוצה פותחת את הסולם שלה</span></div></div>
        {shown.length === 0 ? <Empty title="אין מצבות לתאריך זה" /> : phone ? (
          <MiniGrid files={files} withInt={withInt} items={shown.map((r) => ({ c: r.c, w: r.w! }))} />
        ) : <DebtLadder mode="compare" x={BK.map((b) => BK_HE[b])} parts={parts} label={`חומת הפירעונות · ${kind === 'ins' ? 'קבוצות הביטוח' : 'בתי ההשקעות'} · ${dateLabel(D)}`} height={340}
              source={`MAYA, טופס ת126 ליום ${dateLabel(D)}`} />}
        {staleCos.length > 0 && <p className="src">אין מצבת ל-{dateLabel(D)}: {staleCos.map((c) => `${c.name} (אחרונה ${dateLabel(c.walls[0].end)})`).join(' · ')}</p>}
        <DataTable rows={shown} columns={cols} rowKey={(r) => r.c.id} caption="פירעונות לפי שנה" totalLabel="סה״כ"
          export={{ name: `fox-debt-${kind}-${D}`, title: `חומת הפירעונות · ${dateLabel(D)}`, note: `${withInt ? 'קרן וריבית' : 'קרן'}, ${UNIT}. מקור: MAYA, טופס ת126` }} />
        <p className="src">שנה 1 = 12 החודשים שאחרי תאריך המצבת. קרן: כל ההצמדות (צמוד מדד, שקלי, מט"ח, אחר), לא מהוונת; ריבית: ברוטו, ללא ניכוי מס. מקור: {data.source} · עדכון {pubLabel(data.built)}</p>
      </section>

      {covRows.length > 0 && (
        <section className="panel">
          <div className="hd"><h2>12 החודשים הקרובים מול הרווח והחלוקה</h2><div className="aside"><span>{UNIT} · רווח ודיבידנד מהדוחות הכספיים</span></div></div>
          <DataTable rows={covRows} columns={covCols} rowKey={(r) => r.c.id} caption="שירות חוב מול רווח"
            export={{ name: `fox-debt-coverage-${D}`, title: `שירות חוב מול רווח · ${dateLabel(D)}`, note: 'שירות חוב: קרן וריבית בשנה הראשונה, טופס ת126. רווח LTM ודיבידנד: הדוחות הכספיים' }} />
          <p className="src">שירות החוב כולל את כל החוב שבטופס (האם, המאוחדות וחברות גיוס ההון). כתבי ההתחייבות של חברות גיוס ההון משמשים הון משני של חברת הביטוח ונפרעים ממנה; היכולת של האם לשלם תלויה בדיבידנד מחברת הביטוח, שאינו מפורסם כאן. דיבידנד: השנה המלאה האחרונה עד תאריך המצבת.</p>
        </section>
      )}

      <section className="panel">
        <div className="hd"><h2>קרן לפירעון לאורך זמן</h2><div className="aside"><span>{UNIT} · סך הקרן בטופס, כל השנים</span></div></div>
        <Chart build={() => trend} deps={[kind, cos.length]} height={260} label={`קרן לפירעון לאורך זמן · ${kind === 'ins' ? 'ביטוח' : 'בתי השקעות'}`} source="MAYA, טופס ת126" />
      </section>

      <section className="panel dl-checks">
        <div className="hd"><h2>בקרה</h2><div className="aside"><span>כל טבלה בטופס נבדקת: סכום השנים = שורת הסה"כ, קרן + ריבית = סה"כ השורה, ה = א+ב+ג+ד</span></div></div>
        <div className="dl-kpis">
          <div><span>טפסים</span><b className="num">{ck.parsed}</b><small>מתוך <span className="num">{ck.listed}</span> שנמצאו · <span className="num">{ck.replaced}</span> הוחלפו בדוח מתקן</small></div>
          <div><span>טבלאות שנבדקו</span><b className="num">{ck.tables}</b></div>
          <div><span>עברו</span><b className="num">{ck.pass_rate == null ? '–' : `${nf(ck.pass_rate, 1)}%`}</b><small><span className="num">{ck.failed.length}</span> סימונים</small></div>
          <div><span>כותרת ≠ טופס</span><b className="num">{ck.title_mismatch}</b><small>התאריך נלקח מהטופס</small></div>
          <div><span>הערות פיזור</span><b className="num">{ck.warnings.length}</b><small>טבלה ח מול מצבת החברה הבת</small></div>
        </div>
        {ck.failed.length > 0 && <ul className="dl-flags">{ck.failed.slice(0, 12).map((f, i) => (
          <li key={i}><Link to={`/debt/${f[0]}?d=${f[2]}`}>{data.companies.find((c) => c.id === f[0])?.name ?? f[0]}</Link> · <span className="num">{dateLabel(f[2])}</span> · טבלה {T_HE[f[4]]?.[0] ?? f[4]} · {f[5]}</li>))}</ul>}
        {ck.warnings.filter((w) => w[2] === D).length > 0 && <ul className="dl-flags dl-warn">{ck.warnings.filter((w) => w[2] === D).map((f, i) => (
          <li key={i}><Link to={`/debt/${f[0]}?d=${f[2]}`}>{data.companies.find((c) => c.id === f[0])?.name ?? f[0]}</Link> · {f[5]}</li>))}</ul>}
        <BsGap rows={cos.map((c) => ({ id: c.id, name: c.name, b: c.bs.find((x) => x.end === D) ?? null }))} D={D} />
        {data.none.length > 0 && <p className="src">ללא מצבת בחלון: {data.none.map((x) => x[1]).join(', ')} (ללא אג"ח רשומות, או שנמחקו מהמסחר). החלון: מ-{pubLabel(data.since)}.</p>}
      </section>
    </div>
  );
}

/** Form principal against the balance-sheet borrowings line: the gap is shown, never forced. */
function BsGap({ rows, D }: { rows: { id: string; name: string; b: Bs | null }[]; D: string }) {
  const have = rows.filter((r) => r.b);
  if (!have.length) return null;
  const bsProv = (r: { name: string; b: Bs | null }): Prov => ({ k: 'report', title: `${r.b!.labels.join(' + ')} · ${r.name} · ${dateLabel(r.b!.end)}`, value: mf(r.b!.bs), unit: UNIT, url: r.b!.url, pg: r.b!.pg, period: dateLabel(r.b!.end), note: 'מאזן מאוחד' });
  return (
    <div className="dl-bs">
      <h3>מול המאזן · {dateLabel(D)}</h3>
      <div className="scroll"><table className="tight">
        <thead><tr><th>קבוצה</th><th>קרן בטופס</th><th>שורת המאזן</th><th>פער</th><th className="wide-only">שורה</th></tr></thead>
        <tbody>{have.map((r) => (
          <tr key={r.id}><td><i className="pdot" style={{ background: idCss(r.id) }} />{r.name}</td>
            <td className="num">{mf(r.b!.form)}</td>
            <td><Sourced src={() => bsProv(r)} href={r.b!.url && r.b!.pg ? `${r.b!.url}#page=${r.b!.pg}` : null}>{mf(r.b!.bs)}</Sourced></td>
            <td className="num">{r.b!.gap_pct == null ? '–' : `${nf(r.b!.gap_pct, 1)}%`}</td>
            <td className="wide-only dl-lbl">{r.b!.labels.join(' + ')}</td></tr>))}</tbody>
      </table></div>
      <p className="src">פער = (מאזן − קרן בטופס) ÷ מאזן. הטופס: קרן חוזית לא מהוונת; המאזן: עלות מופחתת, ובשורה גם נגזרים, חכירות והתחייבויות פיננסיות אחרות. הפער מוצג, לא מתוקן.</p>
    </div>
  );
}

/* ---------- one group ---------- */
type View = 'group' | 'solo' | string;
const BY: [string, string][] = [['type', 'לפי סוג חוב'], ['link', 'לפי הצמדה']];
const TYPE_PARTS: { k: string; he: string; tables: string[]; color: string }[] = [
  { k: 'pub', he: 'אג"ח לציבור', tables: ['pub'], color: '--s1' }, { k: 'priv', he: 'אג"ח פרטיות ואשראי חוץ בנקאי', tables: ['priv'], color: '--s7' },
  { k: 'bank', he: 'אשראי בנקאי', tables: ['bank', 'bank_abroad'], color: '--s4' }, { k: 'subs', he: 'מאוחדות שאינן מדווחות (ח)', tables: ['subs'], color: '--s6' },
];
const LINK_PARTS: { k: string; he: string; cols: number[]; color: string }[] = [
  { k: 'cpi', he: 'שקלי צמוד מדד', cols: [0], color: '--s1' }, { k: 'nis', he: 'שקלי לא צמוד', cols: [1], color: '--s9' },
  { k: 'fx', he: 'מט"ח', cols: [2, 3, 4, 5], color: '--s5' }, { k: 'oth', he: 'אחר', cols: [6], color: '--neutral' },
];
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';

function DebtCompany({ id }: { id: string }) {
  const { data: idx } = useLoad<DebtIndex>('debt/index.json');
  const known = idx ? idx.companies.some((c) => c.id === id) : null;
  const { data, error } = useLoad<DebtFile>(known ? `debt/${id}.json` : null);
  const [sp, set] = useSet();
  if (known === false) return <NotFound />;
  if (error) return <ErrorBox what="מצבת ההתחייבויות" error={error} />;
  if (!data) return <Loading what="מצבת ההתחייבויות" />;
  return <CompanyView d={data} sp={sp} set={set} />;
}

function CompanyView({ d, sp, set }: { d: DebtFile; sp: URLSearchParams; set: (k: string, v: string) => void }) {
  const dates = d.views.map((v) => v.end);
  const D = sp.get('d') && dates.includes(sp.get('d')!) ? sp.get('d')! : dates[0];
  const V: View = sp.get('v') ?? 'group';
  const by = sp.get('by') === 'link' ? 'link' : 'type';
  const view = d.views.find((v) => v.end === D)!;
  const ent = (e: number) => d.entities.find((x) => x.maya_id === e)!;
  const rep = (rid: number) => d.reports.find((r) => r.rid === rid)!;
  const cells = useMemo(() => {
    const out = new Map<string, Record<string, number[]>>();
    for (const [rid, t, rk, ...v] of d.cells) { const k = `${rid}|${t}`; const o = out.get(k) ?? {}; o[rk] = v; out.set(k, o); }
    return out;
  }, [d]);
  const parentE = d.entities.find((e) => e.role === 'parent')?.maya_id;
  const atRid = (e: number) => view.rids[String(e)];
  // what the chosen view adds up: (entity, table) pairs
  const contrib: { e: number; t: string }[] = useMemo(() => {
    if (V === 'group') {
      const out: { e: number; t: string }[] = [];
      if (parentE != null && atRid(parentE)) out.push({ e: parentE, t: 'solo' }, { e: parentE, t: 'subs' });
      for (const [e, inH] of Object.entries(view.in_parent_h)) if (!inH) out.push({ e: Number(e), t: 'solo' });
      return out;
    }
    const e = V === 'solo' ? parentE : Number(V);
    return e != null && atRid(e) ? [{ e, t: 'solo' }] : [];
  }, [V, view]); // eslint-disable-line react-hooks/exhaustive-deps
  // the solo summary (ה) is split into its tables א–ד when splitting by debt type
  const leaves = (c: { e: number; t: string }): { e: number; t: string }[] => (by === 'type' && c.t === 'solo' ? ['pub', 'priv', 'bank', 'bank_abroad'].map((t) => ({ e: c.e, t })) : [c]);
  const cellOf = (e: number, t: string, rk: string) => cells.get(`${atRid(e)}|${t}`)?.[rk];
  const src = (e: number, t: string, rk: string, col: number, v: number) => () => cellProv(d.files, rep(atRid(e)), ent(e).name, t, rk, colHe(atRid(e), col), v);
  const colHe = (rid: number, j: number) => d.free[String(rid)]?.[d.cols[j]] ?? d.col_he[d.cols[j]];
  type In = { label: string; v: number; src: () => Prov };
  // one value: the parts (rows of the form) of a part of the ladder in one year bucket
  const partIn = (pk: string, bk: string): In[] => {
    const out: In[] = [];
    for (const c of contrib) for (const l of leaves(c)) {
      const tp = by === 'type' ? TYPE_PARTS.find((p) => p.tables.includes(l.t))!.k : null;
      if (by === 'type' && pk !== 'int' && tp !== pk) continue;
      for (const rk of Object.keys(cells.get(`${atRid(l.e)}|${l.t}`) ?? {})) {
        if (bucketOf(rk) !== bk) continue;
        const v = cellOf(l.e, l.t, rk)!;
        const js = pk === 'int' ? [7] : by === 'type' ? [0, 1, 2, 3, 4, 5, 6] : LINK_PARTS.find((p) => p.k === pk)!.cols;
        for (const j of js) if (v[j]) out.push({ label: `${ent(l.e).name} · טבלה ${T_HE[l.t][0]} · ${BK_HE[rk]} · ${colHe(atRid(l.e), j)}`, v: v[j], src: src(l.e, l.t, rk, j, v[j]) });
      }
    }
    return out;
  };
  // interest is taken from the tables the view sums (ה, not א–ד, to avoid counting it twice)
  const intIn = (bk: string): In[] => {
    const out: In[] = [];
    for (const c of contrib) for (const rk of Object.keys(cells.get(`${atRid(c.e)}|${c.t}`) ?? {})) {
      if (bucketOf(rk) !== bk) continue;
      const v = cellOf(c.e, c.t, rk)!;
      if (v[7]) out.push({ label: `${ent(c.e).name} · טבלה ${T_HE[c.t][0]} · ${BK_HE[rk]} · ריבית`, v: v[7], src: src(c.e, c.t, rk, 7, v[7]) });
    }
    return out;
  };
  const defs = by === 'type' ? TYPE_PARTS.map((p) => ({ k: p.k, he: p.he, color: p.color })) : LINK_PARTS.map((p) => ({ k: p.k, he: p.he, color: p.color }));
  const grid = defs.map((p) => ({ ...p, cells: BK.map((bk) => { const ins = partIn(p.k, bk); return { v: ins.reduce((s, x) => s + x.v, 0), ins }; }) })).filter((p) => p.cells.some((c) => c.v));
  const ints = BK.map((bk) => { const ins = intIn(bk); return { v: ins.reduce((s, x) => s + x.v, 0), ins }; });
  const parts: LadderPart[] = [...grid.map((p) => ({ name: p.he, color: css(p.color), data: p.cells.map((c) => m(c.v)) })),
    { name: 'ריבית', color: css('--neutral'), interest: true, data: ints.map((c) => m(c.v)) }];
  const tagD = dateLabel(D);
  const viewHe = V === 'group' ? 'מאוחד לפי הטופס' : V === 'solo' ? 'האם, סולו' : ent(Number(V))?.name ?? V;
  const cellP = (title: string, c: { v: number; ins: In[] }) => sumProv(`${title} · ${d.name} · ${viewHe} · ${tagD}`, c.v, c.ins);
  // the table under the chart: year buckets down, parts across
  type Row = { bk: string; i: number };
  const trows: Row[] = [...BK.map((bk, i) => ({ bk, i })), { bk: 'total', i: -1 }];
  const at = (cs: { v: number; ins: In[] }[], r: Row) => (r.i >= 0 ? cs[r.i] : { v: cs.reduce((s, c) => s + c.v, 0), ins: cs.flatMap((c) => c.ins) });
  const tcols: Column<Row>[] = [
    { key: 'bk', head: 'שנת פירעון', value: (r) => BK_HE[r.bk], sortable: false },
    ...grid.map((p): Column<Row> => ({ key: p.k, head: p.he, unit: 'm', sortable: false, value: (r) => (at(p.cells, r).v ? m(at(p.cells, r).v) : null), src: (r) => cellP(`${p.he} · ${BK_HE[r.bk]}`, at(p.cells, r)) })),
    { key: 'int', head: 'ריבית', unit: 'm', sortable: false, value: (r) => m(at(ints, r).v), src: (r) => cellP(`ריבית · ${BK_HE[r.bk]}`, at(ints, r)) },
    { key: 'tot', head: 'קרן וריבית', unit: 'm', sortable: false, value: (r) => m(grid.reduce((s, p) => s + at(p.cells, r).v, 0) + at(ints, r).v),
      src: (r) => sumProv(`קרן וריבית · ${BK_HE[r.bk]} · ${d.name} · ${viewHe} · ${tagD}`, grid.reduce((s, p) => s + at(p.cells, r).v, 0) + at(ints, r).v,
        [...grid.map((p) => ({ label: p.he, v: at(p.cells, r).v, src: () => cellP(`${p.he} · ${BK_HE[r.bk]}`, at(p.cells, r)) })), { label: 'ריבית', v: at(ints, r).v, src: () => cellP(`ריבית · ${BK_HE[r.bk]}`, at(ints, r)) }], 'סכום החלקים') },
  ];
  // the entities of the group at this date
  const ents = d.entities.filter((e) => atRid(e.maya_id));
  const eTot = (e: number, t: string, j: 'p' | 'i' | 'y1') => { const v = cellOf(e, t, j === 'y1' ? 'y1' : 'total'); return v ? (j === 'i' ? v[7] : v.slice(0, 7).reduce((s, x) => s + x, 0)) : 0; };
  const issues = d.reports.filter((r) => r.end === D && r.issues);
  const bsRow = d.bs.find((b) => b.end === D);
  // history: principal of the chosen view by date, one bar part per entity
  const histDates = dates.slice().reverse();
  const hist = foxOption({ x: histDates.map(dateLabel), unit: UNIT, total: true, labels: false, series: (() => {
    const s: { name: string; data: (number | null)[]; color: string; stack: boolean }[] = [];
    const pal = ['--s1', '--s7', '--s4', '--s6', '--s9'];
    const keys: { e: number; t: string; he: string }[] = [];
    for (const e of d.entities) { keys.push({ e: e.maya_id, t: 'solo', he: `${e.name} · סולו` }); if (e.role === 'parent') keys.push({ e: e.maya_id, t: 'subs', he: `${e.name} · מאוחדות (ח)` }); }
    keys.forEach((k, i) => {
      const data = histDates.map((dd) => {
        const vw = d.views.find((v) => v.end === dd)!; const rid = vw.rids[String(k.e)];
        if (!rid) return null;
        if (k.t === 'solo' && ent(k.e).role !== 'parent' && vw.in_parent_h[String(k.e)] !== false) return null;  // inside ח already
        const tv = cells.get(`${rid}|${k.t}`)?.total; return tv ? m(tv.slice(0, 7).reduce((a, b) => a + b, 0)) : null;
      });
      if (data.some((x) => x)) s.push({ name: k.he, data, color: css(pal[i % pal.length]), stack: true });
    });
    return s;
  })() });
  const exportAll = () => {
    const head = ['מנפיק', 'תפקיד', 'תאריך', 'טבלה', 'שורה', ...d.cols.map((c) => d.col_he[c]), 'אסמכתא', 'קישור'].map((h) => ({ v: h, head: true }) as XCell);
    const body: XCell[][] = d.cells.map(([rid, t, rk, ...v]) => { const r = rep(rid); return [ent(r.e).name, ROLE_HE[ent(r.e).role], dateLabel(r.end), `${T_HE[t][0]} · ${T_HE[t][1]}`, BK_HE[rk] ?? rk,
      ...v.map((x) => ({ v: x, fmt: 'n0' as const })), r.ref ?? '', { v: 'טופס', link: d.files + r.url }]; });
    downloadXlsx(`fox-debt-${d.id}`, [{ name: 'מצבת התחייבויות', rows: [head, ...body], freeze: { rows: 1, cols: 3 }, widths: [22, 12, 9, 26, 10, 11, 11, 9, 9, 9, 9, 9, 11, 11, 16, 8] }]);
  };

  return (
    <div className="dl">
      <div className="pagehead"><div><h1>חוב ופירעונות <span className="muted">· {d.name}</span></h1>
        <div className="sub"><span><Link to="/debt">כל הקבוצות</Link> · <Link to={`/company/${d.id}`}>דף החברה</Link> · מצבת התחייבויות (ת126) · {tagD}</span></div></div>
        <div className="dl-actions"><button type="button" className="btn" onClick={exportAll}>Excel</button></div>
      </div>
      <section className="controls dl-controls">
        <label className="field"><span>תאריך המצבת</span>
          <select value={D} onChange={(e) => set('d', e.target.value === dates[0] ? '' : e.target.value)}>{dates.map((x) => <option key={x} value={x}>{dateLabel(x)}</option>)}</select></label>
        <label className="field"><span>היקף</span>
          <select value={V} onChange={(e) => set('v', e.target.value === 'group' ? '' : e.target.value)}>
            <option value="group">מאוחד לפי הטופס</option><option value="solo">החברה האם, סולו</option>
            {ents.filter((e) => e.role !== 'parent').map((e) => <option key={e.maya_id} value={String(e.maya_id)}>{e.name} ({ROLE_HE[e.role]})</option>)}
          </select></label>
        <div className="field"><span>פילוח</span><Seg<string> label="פילוח" value={by} onChange={(v) => set('by', v === 'type' ? '' : v)} options={BY} /></div>
      </section>

      <section className="panel">
        <div className="hd"><h2>סולם הפירעונות · {viewHe}</h2><div className="aside"><span>{UNIT} · {tagD}</span></div></div>
        {contrib.length === 0 ? <Empty title="אין מצבת להיקף זה בתאריך זה" /> : <>
          <DebtLadder x={BK.map((b) => BK_HE[b])} parts={parts} label={`סולם הפירעונות · ${d.name} · ${viewHe} · ${tagD}`} height={320} source={`MAYA, טופס ת126 ליום ${tagD}`} />
          <DataTable rows={trows} columns={tcols} rowKey={(r) => r.bk} caption="פירעונות לפי שנה" rowClass={(r) => (r.bk === 'total' ? 'dl-total' : undefined)}
            export={{ name: `fox-debt-${d.id}-${D}`, title: `סולם הפירעונות · ${d.name} · ${viewHe} · ${tagD}`, note: `${UNIT}. מקור: MAYA, טופס ת126` }} />
        </>}
        <p className="src">{V === 'group' ? 'מאוחד לפי הטופס: האם סולו (טבלה ה) + מאוחדות שאינן תאגידים מדווחים (טבלה ח) + כל מנפיקה מדווחת שאינה כלולה כבר בטבלה ח. ' : ''}קרן לא מהוונת, ריבית ברוטו. שנה 5+ כוללת את כל השנים שאחריה.</p>
      </section>

      <section className="panel">
        <div className="hd"><h2>המנפיקות</h2><div className="aside"><span>{UNIT} · {tagD}</span></div></div>
        <div className="scroll"><table className="tight dl-ents">
          <thead><tr><th>מנפיקה</th><th>קרן, סה"כ</th><th>קרן, 12 ח׳</th><th>ריבית, סה"כ</th><th>בתצוגה המאוחדת</th><th className="wide-only">טופס</th></tr></thead>
          <tbody>{ents.flatMap((e) => (e.role === 'parent' ? ['solo', 'subs'] : ['solo']).map((t) => {
            const r = rep(atRid(e.maya_id)), has = cells.get(`${r.rid}|${t}`);
            if (!has && t === 'subs') return null;
            const inH = view.in_parent_h[String(e.maya_id)];
            const one = (j: 'p' | 'i' | 'y1') => { const rk = j === 'y1' ? 'y1' : 'total'; const v = cellOf(e.maya_id, t, rk);
              return v ? sumProv(`${j === 'i' ? 'ריבית' : 'קרן'}${j === 'y1' ? ', 12 ח׳' : ''} · ${e.name} · טבלה ${T_HE[t][0]}`, eTot(e.maya_id, t, j), (j === 'i' ? [7] : [0, 1, 2, 3, 4, 5, 6]).map((k) => ({ label: colHe(r.rid, k), v: v[k], src: src(e.maya_id, t, rk, k, v[k]) }))) : null; };
            const cellN = (j: 'p' | 'i' | 'y1') => { const p = one(j); return p && eTot(e.maya_id, t, j) ? <Sourced src={() => p}>{mf(eTot(e.maya_id, t, j))}</Sourced> : <span className="muted">–</span>; };
            return (<tr key={`${e.maya_id}${t}`}>
              <td className="dl-lbl"><b>{t === 'subs' ? `${e.name} · מאוחדות (ח)` : e.name}</b><span className="dim">{t === 'subs' ? 'חברות מאוחדות שאינן תאגידים מדווחים' : ROLE_HE[e.role]}</span></td>
              <td>{cellN('p')}</td><td>{cellN('y1')}</td><td>{cellN('i')}</td>
              <td>{e.role === 'parent' ? <span className="chip pass">נכלל</span> : inH == null ? <span className="muted">–</span> : inH
                ? <span className="chip est" title="כל עמודות הקרן של המנפיקה נכנסות בטבלה ח של החברה האם: היא כבר כלולה שם ואינה נספרת שוב (בדיקה, לא הצהרת החברה)">כלולה בטבלה ח של האם</span>
                : <span className="chip pass" title="הקרן של המנפיקה אינה נכנסת בטבלה ח של האם: נוספת לתצוגה המאוחדת">נוספת</span>}</td>
              <td className="wide-only"><a href={d.files + r.url} target="_blank" rel="noreferrer">{formName(r.end)}</a>{r.fixed && <span className="chip est">מתוקן</span>}</td>
            </tr>);
          }))}</tbody>
        </table></div>
      </section>

      {d.series && d.series.rows.length > 0 && (
        <section className="panel">
          <div className="hd"><h2>סדרות האג"ח</h2><div className="aside"><span>ערך נקוב במחזור, {UNIT} · נכון ל-{pubLabel(d.series.asof)} · מתוך רשימת ניירות הערך של כל מנפיקה</span></div></div>
          <DataTable rows={d.series.rows} rowKey={(r) => r[3]} caption="סדרות אג״ח" sort={{ key: 'par', dir: 'desc' }}
            columns={[
              { key: 'e', head: 'מנפיקה', value: (r) => ent(r[0])?.name ?? String(r[0]) },
              { key: 'n', head: 'סדרה', value: (r) => r[1] },
              { key: 'no', head: 'מס׳ נייר', value: (r) => r[3], cell: (r) => <span className="num">{r[3]}</span>, className: 'wide-only' },
              { key: 'par', head: 'ע.נ. במחזור', unit: 'm', value: (r) => (r[5] == null ? null : r[5] / 1e6), total: 'sum',
                src: (r) => ({ k: 'report', title: `ערך נקוב במחזור · ${r[1]}`, value: fmt((r[5] ?? 0) / 1e6, 'm'), unit: UNIT, url: `https://maya.tase.co.il/he/companies/${r[0]}`, pg: null,
                  doc: `${ent(r[0])?.name}, רשימת ניירות ערך (MAYA)`, note: `נשלף ${pubLabel(d.series!.asof)} · הון מונפק ונפרע · ${r[4]}` }) },
            ]} export={{ name: `fox-debt-series-${d.id}`, title: `סדרות האג"ח · ${d.name}`, note: `ע.נ. במחזור נכון ל-${pubLabel(d.series.asof)}, MAYA` }} />
          <p className="src">תמונת מצב של היום, לא לתאריך המצבת; טופס ת126 אינו מפרט סדרות. ערך נקוב בש"ח של הסדרה (לסדרה צמודה: לפני הצמדה).</p>
        </section>
      )}

      <section className="panel">
        <div className="hd"><h2>קרן לאורך זמן</h2><div className="aside"><span>{UNIT} · סך הקרן בטבלאות ה ו-ח, לפי מנפיקה</span></div></div>
        <Chart build={() => hist} deps={[d.id]} height={260} label={`קרן לאורך זמן · ${d.name}`} source="MAYA, טופס ת126" />
        <p className="src">מנפיקה שכלולה בטבלה ח של האם אינה מוצגת בנפרד באותו תאריך.</p>
      </section>

      {(bsRow || issues.length > 0 || view.warn) && (
        <section className="panel dl-checks">
          <div className="hd"><h2>בקרה</h2></div>
          {issues.length > 0 ? <ul className="dl-flags">{issues.flatMap((r) => Object.entries(r.issues!).flatMap(([t, xs]) => xs.map((x, i) => (
            <li key={`${r.rid}${t}${i}`}>{ent(r.e).name} · טבלה {T_HE[t]?.[0] ?? t} · {x} · <a href={d.files + r.url} target="_blank" rel="noreferrer">טופס</a></li>))))}</ul>
            : <p className="dl-ok">כל הטבלאות לתאריך זה עברו את הבדיקות (סכום השנים, קרן + ריבית, ה = א+ב+ג+ד).</p>}
          {view.warn && <ul className="dl-flags dl-warn">{view.warn.map((w, i) => <li key={i}>{w}: בתצוגה המאוחדת נלקח פיזור השנים של טבלה ח</li>)}</ul>}
          {bsRow && <BsGap rows={[{ id: d.id, name: d.name, b: bsRow }]} D={D} />}
        </section>
      )}
      <p className="src">מקור: {d.source} · עדכון {pubLabel(d.built)}</p>
    </div>
  );
}

/** Sum of a wall's parts in one year bucket: principal (0) or interest (1), with every form cell as an input of its source. */
function wallCell(files: string, c: IdxCo, w: Wall, bk: string, j: 0 | 1) {
  const name = (e: number) => c.entities.find((x) => x[0] === e)?.[1] ?? String(e);
  const inputs = w.parts.flatMap((p) => Object.entries(p.b).filter(([rk]) => bucketOf(rk) === bk).map(([rk, v]) => ({
    label: `${name(p.e)} · ${PART_HE[p.k]} · ${BK_HE[rk]}`, v: v[j],
    src: () => cellProv(files, { rid: p.rid, e: p.e, end: w.end, pub: '', ref: p.ref, url: p.url, fixed: false }, name(p.e), p.k === 'subs' ? 'subs' : 'solo', rk, j ? 'ריבית ברוטו' : 'קרן (כל ההצמדות)', v[j]) })));
  return { v: inputs.reduce((s, x) => s + x.v, 0), inputs };
}
/** One mini ladder per group on a common scale (phone wall, CSM capital view): CSS bars, interest hatched on top, each figure sourced. */
function MiniGrid({ files, items, withInt = true }: { files: string; items: { c: IdxCo; w: Wall }[]; withInt?: boolean }) {
  const val = (c: IdxCo, w: Wall, bk: string) => wallCell(files, c, w, bk, 0).v + (withInt ? wallCell(files, c, w, bk, 1).v : 0);
  const max = Math.max(1, ...items.flatMap(({ c, w }) => BK.map((bk) => val(c, w, bk))));
  const prov = (c: IdxCo, w: Wall, bk: string): Prov => {
    const p = wallCell(files, c, w, bk, 0), i = wallCell(files, c, w, bk, 1), t = `${c.name} · ${BK_HE[bk]} · ${dateLabel(w.end)}`;
    if (!withInt) return sumProv(`קרן · ${t}`, p.v, p.inputs);
    return sumProv(`קרן וריבית · ${t}`, p.v + i.v, [{ label: 'קרן', v: p.v, src: () => sumProv(`קרן · ${t}`, p.v, p.inputs) }, { label: 'ריבית', v: i.v, src: () => sumProv(`ריבית · ${t}`, i.v, i.inputs) }], 'קרן + ריבית');
  };
  const total = (w: Wall) => w.parts.reduce((s, p) => s + (p.b.total?.[0] ?? 0), 0);
  // the bars are narrow: billions with one decimal once any bar passes ₪1bn
  const big = max >= 1e6, short = (k: number) => (big ? nf(k / 1e6, 1) : nf(k / 1e3, 0));
  return (
    <>
    <p className="src dl-munit">{big ? 'מיליארדי ש"ח' : UNIT} · קרן{withInt ? ' וריבית (מקווקו)' : ''} לפי שנת פירעון · בכותרת: קרן, כל השנים</p>
    <ul className="dl-minis">{items.map(({ c, w }) => (
      <li key={c.id}><Link to={`/debt/${c.id}?d=${w.end}`} className="dl-mini-hd"><i className="pdot" style={{ background: idCss(c.id) }} />{c.name}<span className="num" title="קרן, כל השנים">{short(total(w))}</span></Link>
        <div className="dl-mini" role="img" aria-label={`${c.name}: פירעונות לפי שנה`}>{BK.map((bk) => {
          const p = wallCell(files, c, w, bk, 0).v, i = withInt ? wallCell(files, c, w, bk, 1).v : 0;
          return (<div key={bk} className="dl-mcol"><div className="dl-mbar" style={{ ['--c' as string]: idCss(c.id), height: `${((p + i) / max) * 100}%` }}>
            {i > 0 && <i className="dl-mi" style={{ height: `${(i / (p + i)) * 100}%` }} />}</div>
            <Sourced className="num dl-mv" src={() => prov(c, w, bk)}>{short(p + i)}</Sourced><span className="dl-mx">{BK_HE[bk].replace('שנה ', '')}</span></div>);
        })}</div></li>
    ))}</ul>
    </>
  );
}
/** The insurers' maturity walls at the latest common schedule date, small multiples with a link to /debt (CSM capital view). */
export function DebtWallStrip({ kind = 'ins' }: { kind?: 'ins' | 'fund' }) {
  const { data } = useLoad<DebtIndex>('debt/index.json');
  if (!data) return null;
  const cos = data.companies.filter((c) => c.kind === kind && c.walls.length);
  const dates = [...new Set(cos.flatMap((c) => c.walls.map((w) => w.end)))].sort().reverse();
  const D = dates.find((d) => cos.filter((c) => c.walls.some((w) => w.end === d)).length >= Math.ceil(cos.length * 0.75)) ?? dates[0];
  const items = cos.flatMap((c) => { const w = c.walls.find((x) => x.end === D); return w ? [{ c, w }] : []; });
  if (!items.length) return null;
  return (
    <section className="panel dl-strip" aria-label="חוב ופירעונות">
      <div className="dl-strip-hd"><h2>חוב ופירעונות</h2><span className="muted">חומת הפירעונות · {dateLabel(D)} · מאוחד לפי טופס ת126</span><Link to={`/debt${kind === 'fund' ? '?k=fund' : ''}`}>חוב ופירעונות ←</Link></div>
      <MiniGrid files={data.files} items={items} />
    </section>
  );
}

/* ---------- integration: a compact wall for the company page and the CSM capital view ---------- */
/** The group's maturity wall at its latest schedule, as a short strip of bars with the figures; links to /debt/:id. */
export function DebtStrip({ id }: { id: string }) {
  const { data } = useLoad<DebtIndex>('debt/index.json');
  const c = data?.companies.find((x) => x.id === id);
  const w = c?.walls[0];
  if (!data || !c || !w) return null;
  const files = data.files;
  const b = (bk: string, j: 0 | 1) => w.parts.reduce((s, p) => s + Object.entries(p.b).filter(([rk]) => bucketOf(rk) === bk).reduce((a, [, v]) => a + v[j], 0), 0);
  const max = Math.max(1, ...BK.map((bk) => b(bk, 0) + b(bk, 1)));
  const prov = (bk: string): Prov => sumProv(`קרן וריבית · ${BK_HE[bk]} · ${c.name} · ${dateLabel(w.end)}`, b(bk, 0) + b(bk, 1), w.parts.flatMap((p) => Object.entries(p.b).filter(([rk]) => bucketOf(rk) === bk).flatMap(([rk, v]) => [0, 1].map((j) => ({
    label: `${c.entities.find((e) => e[0] === p.e)?.[1]} · ${PART_HE[p.k]} · ${j ? 'ריבית' : 'קרן'}`, v: v[j],
    src: () => cellProv(files, { rid: p.rid, e: p.e, end: w.end, pub: '', ref: p.ref, url: p.url, fixed: false }, c.entities.find((e) => e[0] === p.e)?.[1] ?? '', p.k === 'subs' ? 'subs' : 'solo', rk, j ? 'ריבית ברוטו' : 'קרן', v[j]) })))));
  return (
    <section className="panel dl-strip" aria-label="חוב ופירעונות">
      <div className="dl-strip-hd"><h2>חוב ופירעונות</h2><span className="muted">פירעונות לפי שנה · {UNIT} · {dateLabel(w.end)} · קרן וריבית, מאוחד לפי טופס ת126</span><Link to={`/debt/${id}`}>חוב ופירעונות ←</Link></div>
      <div className="dl-mini" role="img" aria-label={`${c.name}: פירעונות לפי שנה`}>{BK.map((bk) => (
        <div key={bk} className="dl-mcol"><div className="dl-mbar" style={{ ['--c' as string]: idCss(id), height: `${((b(bk, 0) + b(bk, 1)) / max) * 100}%` }}><i className="dl-mi" style={{ height: `${(b(bk, 1) / Math.max(1, b(bk, 0) + b(bk, 1))) * 100}%` }} /></div>
          <Sourced className="num dl-mv" src={() => prov(bk)}>{fmt(m(b(bk, 0) + b(bk, 1)), 'm', { d: 0 })}</Sourced><span className="dl-mx">{BK_HE[bk].replace('שנה ', '')}</span></div>))}</div>
    </section>
  );
}
