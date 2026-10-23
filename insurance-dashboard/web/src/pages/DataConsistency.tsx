import { DataTable } from '../components/DataTable';
import { ErrorBox, Loading, Panel } from '../components/ui';
import { nf, pubLabel } from '../lib/format';
import { useLoad } from '../lib/useData';

/* /data · consistency (lane Q): the last run of pipeline/check_consistency.py. One entity, period and metric shows one figure on every
   page that serves it; what differs is either a labelled basis difference (listed with its reason) or a conflict that fails the gate. */

interface Row { entity: string; metric: string; period: string; a: string; va: number; b: string; vb: number; diff?: number; reason?: string }
interface Fund { entity: string; metric: string; period: string; xbrl: number; page: number; row: string | null; alt?: boolean; ok: boolean; basis: string | null }
export interface Consistency {
  built: string; window: string[]; pairs: number; passed: number; surfaces: Record<string, string>; metrics: Record<string, string>;
  by_pair: [string, string, number][]; exceptions: Record<string, { n: number; reason: string | null; rows: Row[] }>; conflicts: Row[]; older: number;
  stale_allow?: string[][]; notes?: string[]; fund_roles: { n: number; bad: number; rows: Fund[] };
}

const KIND_HE: Record<string, string> = { filer: 'ישות מדווחת אחרת', std: 'IFRS 4 מול IFRS 17', restated: 'הוצג מחדש בדוח מאוחר', alt: 'שורת הרווח לתקופה', allow: 'רשימת חריגים מאומתת' };
/** 2026Q2 → Q2'26 · 2025FY → FY'25 · LTM2026Q2 → LTM Q2'26 */
const per = (p: string): string => (p.startsWith('LTM') ? `LTM ${per(p.slice(3))}` : /^\d{4}(FY|H\d)$/.test(p) ? `${p.slice(4)}'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const amt = (v: number, m: string) => (m === 'eps' ? nf(v, 2) : nf(v, Math.abs(v) < 100 ? 1 : 0));

export function ConsistencyPanel({ name }: { name: (id: string) => string }) {
  const r = useLoad<Consistency>('consistency.json');
  if (r.error) return <Panel title="עקביות בין עמודים"><ErrorBox what="בדיקת העקביות" error={r.error} /></Panel>;
  if (!r.data) return <Panel title="עקביות בין עמודים"><Loading what="בדיקת העקביות" /></Panel>;
  const d = r.data, S = (s: string) => d.surfaces[s] ?? s, M = (m: string) => d.metrics[m] ?? m;
  const exc = Object.entries(d.exceptions).map(([k, x]) => ({ k, ...x }));
  const nExc = exc.reduce((t, x) => t + x.n, 0);
  const win = d.window.length ? `${per(d.window[0])}–${per(d.window[d.window.length - 1])}` : '';
  const bad = d.fund_roles.rows.filter((x) => !x.ok && !x.basis).length;
  return (
    <Panel title="עקביות בין עמודים" className="dq-cons" aside={<span>check_consistency · <span className="num">{pubLabel(d.built)}</span> · {win}</span>}>
      <div className="cons-kpis">
        <div><span className="l">זוגות שהושוו</span><span className="v num">{nf(d.pairs, 0)}</span></div>
        <div><span className="l">שווים בתוך עיגול</span><span className="v num">{nf(d.passed, 0)}</span></div>
        <div><span className="l">הבדלי בסיס מסומנים</span><span className="v num">{nf(nExc, 0)}</span></div>
        <div><span className="l">סתירות</span><span className={`v num ${d.conflicts.length ? 'neg' : ''}`}>{nf(d.conflicts.length, 0)}</span>{!d.conflicts.length && <span className="chip pass">ללא סתירה</span>}</div>
        <div><span className="l">בתי השקעות · מיפוי שורות</span><span className={`v num ${bad ? 'neg' : ''}`}>{d.fund_roles.n - bad}/{d.fund_roles.n}</span></div>
        {d.older > 0 && <div><span className="l">לפני החלון</span><span className="v num muted">{nf(d.older, 0)}</span><span className="chip est">אזהרה</span></div>}
      </div>

      {d.conflicts.length > 0 && (
        <DataTable caption="סתירות בין עמודים" rows={d.conflicts} rowKey={(x) => `${x.entity}${x.metric}${x.period}${x.a}${x.b}`} export={{ name: 'fox-conflicts', title: 'סתירות בין עמודים', note: `check_consistency · ${pubLabel(d.built)}` }} columns={[
          { key: 'e', head: 'חברה', value: (x) => name(x.entity) },
          { key: 'm', head: 'מדד', value: (x) => M(x.metric) },
          { key: 'p', head: 'תקופה', value: (x) => x.period, text: (x) => per(x.period), cell: (x) => <span className="num">{per(x.period)}</span> },
          { key: 'a', head: 'עמוד א', value: (x) => S(x.a), cell: (x) => <>{S(x.a)} <span className="num">{amt(x.va, x.metric)}</span></> },
          { key: 'b', head: 'עמוד ב', value: (x) => S(x.b), cell: (x) => <>{S(x.b)} <span className="num">{amt(x.vb, x.metric)}</span></> },
          { key: 'd', head: 'הפרש', value: (x) => x.va - x.vb, unit: 'm', tone: true },
        ]} />
      )}

      <DataTable caption="הבדלי בסיס מסומנים" rows={exc} rowKey={(x) => x.k} export={{ name: 'fox-consistency-basis', title: 'הבדלי בסיס מסומנים', note: `check_consistency · ${pubLabel(d.built)}` }} columns={[
        { key: 'k', head: 'סוג', value: (x) => KIND_HE[x.k] ?? x.k, cell: (x) => <>{KIND_HE[x.k] ?? x.k}<span className="dim mono" dir="ltr">{x.k}</span></> },
        { key: 'n', head: 'זוגות', value: (x) => x.n, unit: 'int' },
        { key: 'r', head: 'הסבר', tdClass: () => 'notecell', value: (x) => x.reason ?? x.rows.map((y) => y.reason).join(' · '), cell: (x) => <span className="note">{x.reason ?? x.rows.map((y) => y.reason).join(' · ')}</span> },
        { key: 'ex', head: 'לדוגמה', className: 'c-ex', tdClass: () => 'notecell', value: (x) => x.rows[0]?.entity ?? '', cell: (x) => { const y = x.rows[0]; return y ? <span className="note">{name(y.entity)} · {M(y.metric)} · <span className="num">{per(y.period)}</span>: {S(y.a)} <span className="num">{amt(y.va, y.metric)}</span> / {S(y.b)} <span className="num">{amt(y.vb, y.metric)}</span></span> : null; } },
      ]} />

      <details className="cons-more">
        <summary>מיפוי שורות בבתי ההשקעות: רווח ורווח כולל לבעלי המניות בדף החברה מול XBRL, ארבעה רבעונים</summary>
        <DataTable caption="מיפוי שורות בבתי ההשקעות" rows={d.fund_roles.rows} rowKey={(x) => `${x.entity}${x.metric}${x.period}`} columns={[
          { key: 'e', head: 'בית השקעות', value: (x) => name(x.entity) },
          { key: 'm', head: 'מדד', value: (x) => M(x.metric) },
          { key: 'p', head: 'תקופה', value: (x) => x.period, text: (x) => per(x.period), cell: (x) => <span className="num">{per(x.period)}</span> },
          { key: 'x', head: 'XBRL', value: (x) => x.xbrl, unit: 'm' },
          { key: 'g', head: 'דף החברה', value: (x) => x.page, unit: 'm' },
          { key: 'row', head: 'שורה בדוח', value: (x) => x.row ?? '', cell: (x) => <span className="muted">{x.row ?? '–'}{x.alt ? ' (שורת הסיכום)' : ''}</span> },
          { key: 'ok', head: 'מצב', value: (x) => (x.ok ? 1 : 0), cell: (x) => <span className={`chip ${x.ok ? 'pass' : x.basis ? 'est' : 'bad'}`} title={x.basis ?? undefined}>{x.ok ? 'תואם' : x.basis ? 'בסיס שונה' : 'סתירה'}</span> },
        ]} />
      </details>
      <div className="src">
        עמודים שהושוו: {d.by_pair.slice(0, 8).map(([a, b, n]) => `${S(a)} ↔ ${S(b)} (${nf(n, 0)})`).join(' · ')}.
        {' '}שני נתונים באותה רמת דיוק חייבים להיות זהים; בין אלפים למיליונים מותר חצי יחידה לכל רכיב מעוגל.
        {(d.notes ?? []).length > 0 && <> · {d.notes!.join(' · ')}</>}
      </div>
    </Panel>
  );
}
