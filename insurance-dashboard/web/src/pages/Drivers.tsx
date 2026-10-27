import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Panel } from '../components/ui';
import { useLoad, useRegistry } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { ltsProv, warmRep } from '../lib/lens';
import type { Prov } from '../lib/prov';
import {
  METHOD_HE, QUALITY_HE, driversPath, edgesOf, elasticityRows, fmt, fmtS, toProv,
  type DriverFile, type ElRow, type LtsResolver, type NodeV, type ProvJ, type Quality,
} from '../lib/drivers';
import '../styles/drivers.css';

/* A1 · /drivers/:id: the calibrated elasticities of one company (pipeline/build_drivers.py → drivers/<id>.json). Every figure opens its
   source: the identity's printed inputs, the regression's window and fit, the disclosure's report and page. Not in the navigation. */

const lts: LtsResolver = (j) => ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
const src = (j: ProvJ) => (): Prov => toProv(j, lts);
/** every managing company whose printed components a figure of the file cites, so they load before a sheet opens */
function ltsCos(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => ltsCos(y, out));
  else if (x && typeof x === 'object') { const o = x as Record<string, unknown>; if (o.k === 'lts' && typeof o.c === 'string') out.add(o.c); Object.values(o).forEach((y) => ltsCos(y, out)); }
  return out;
}
const dec = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : 3);
const Q = ({ q }: { q: Quality }) => <span className={`dr-q ${q}`}>{QUALITY_HE[q]}</span>;

function Val({ r }: { r: ElRow }) {
  const e = r.e!;
  if (r.v == null) return <span className="dr-miss" title={e.why ?? e.note}>–</span>;
  return <Sourced src={src(e.prov)} className={r.est ? 'dr-est' : ''}>{fmtS(r.v, dec(r.v))}</Sourced>;
}
function Meta({ r }: { r: ElRow }) {
  const e = r.e!;
  const bits: string[] = [];
  if (e.n != null && e.quality !== 'missing') bits.push(`n = ${e.n}`);
  if (e.window) bits.push(e.window);
  if (e.fit) bits.push(`R² ${fmt(e.fit.r2, 2)} · t ${fmt(e.fit.t, 1)}`);
  if (e.range && e.range[0] !== e.range[1]) bits.push(`טווח ${fmtS(e.range[0], dec(e.range[0]))} עד ${fmtS(e.range[1], dec(e.range[1]))}`);
  return <span className="dr-meta">{bits.map((b, i) => <span key={i} className={/\d/.test(b) && !/[֐-׿]/.test(b) ? 'num' : ''}>{b}</span>)}</span>;
}
const why = (r: ElRow) => r.note ?? (r.e?.quality === 'missing' || r.v == null ? r.e?.why : undefined);

function Table({ rows, phone, seg }: { rows: ElRow[]; phone: boolean; seg?: boolean }) {
  if (!rows.length) return <Empty title="אין קשרים מכוילים בחלק זה" />;
  if (phone) return (
    <ul className="dr-cards">{rows.map((r, i) => (
      <li key={i} className={r.e?.quality}>
        <div className="dr-l"><b>{r.label}</b>{seg && r.seg ? <span className="dim"> · {r.seg}</span> : null}</div>
        <div className="dr-v"><bdi className="dim">{r.shock}</bdi><span className="dim">←</span><Val r={r} /><span className="dim">{r.unit}</span></div>
        <div className="dr-m">{METHOD_HE[r.e!.method]} · <Q q={r.e!.quality} /> <Meta r={r} /></div>
        {why(r) && <div className="dr-why">{why(r)}</div>}
      </li>))}</ul>
  );
  return (
    <table className="dr-t">
      <thead><tr>{seg && <th>מוצר</th>}<th>קשר</th><th>זעזוע</th><th>השפעה</th><th>יחידה</th><th>שיטה</th><th>איכות</th><th>n · חלון · התאמה</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} className={r.e?.quality}>
          {seg && <td className="lbl">{r.seg}</td>}
          <td className="lbl">{r.label}{why(r) && <span className="dr-why">{why(r)}</span>}</td>
          <td><bdi>{r.shock}</bdi></td>
          <td className="v"><Val r={r} /></td>
          <td className="dim">{r.unit}</td>
          <td>{r.est ? 'אומדן' : METHOD_HE[r.e!.method]}</td>
          <td><Q q={r.e!.quality} /></td>
          <td><Meta r={r} /></td>
        </tr>))}</tbody>
    </table>
  );
}

const NODES: [string, string, number][] = [
  ['revenue', 'הכנסות מדמי ניהול, פנסיה וגמל · LTM', 0], ['op_profit', 'רווח תפעולי, פנסיה וגמל · LTM', 0], ['net_profit', 'רווח נקי · LTM', 0], ['equity', 'הון ממוצע', 0],
  ['roe', 'תשואה להון · LTM', 1], ['tax_eff', 'שיעור מס אפקטיבי', 1], ['ke', 'מחיר ההון', 2], ['pb', 'מכפיל הון מוצדק', 2], ['csm', 'CSM', 0], ['csm_release_rate', 'קצב שחרור CSM', 1],
  ['own_funds', 'הון עצמי לכושר פירעון', 0], ['scr', 'SCR', 0], ['solv_w', 'יחס כושר פירעון, עם', 0], ['solv_wo', 'יחס כושר פירעון, ללא', 0], ['target_board_w', 'יעד דירקטוריון, עם', 0],
  ['target_board_wo', 'יעד דירקטוריון, ללא', 0], ['target_div_w', 'סף דיבידנד, עם', 0], ['debt_total', 'קרן חוב', 0], ['debt_cpi', 'מתוכה צמודת מדד', 0], ['debt_y1', 'פירעונות 12 חודשים', 0],
];
const unitOf = (n: NodeV) => (n.unit === '%' ? '%' : n.unit === 'x' ? 'x' : '');

export function Drivers() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const reg = useRegistry();
  const phone = usePhone();
  const F = useLoad<DriverFile>(id ? driversPath(id) : null);
  const f = F.data;
  useEffect(() => { if (f) ltsCos(f).forEach((c) => warmRep(c)); }, [f]);
  const rows = useMemo(() => (f ? elasticityRows(f) : []), [f]);
  const cos = reg.data ?? [];
  if (!id) return (
    <div className="dr">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="sliders" /></span>מנגנונים: גמישויות לפי חברה</h1><div className="sub">שכבת המנגנונים: כל קשר עם שיטה, n, חלון ומקור</div></div></div>
      <Panel><ul className="dr-cos">{cos.map((c) => <li key={c.id}><Link to={`/drivers/${c.id}`}>{c.name_he}</Link></li>)}</ul></Panel>
    </div>
  );
  if (F.error) return <ErrorBox what="קובץ המנגנונים" error={F.error} />;
  if (!f) return <Loading what="המנגנונים" />;
  const all = edgesOf(f), miss = all.filter((e) => e.quality === 'missing').length;
  const by = (q: string) => all.filter((e) => e.quality === q).length;
  const sav = rows.filter((r) => r.sec === 'sav'), grp = rows.filter((r) => r.sec === 'grp'), ins = rows.filter((r) => r.sec === 'ins');
  const nodes = NODES.filter(([k]) => f.nodes[k]?.v != null);
  return (
    <div className="dr">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="sliders" /></span>מנגנונים: גמישויות · {f.meta.name}</h1>
        <div className="sub">בסיס <span className="num">{f.meta.base.q}</span> · LTM <span className="num">{f.meta.base.ltm[0]}–{f.meta.base.ltm[3]}</span> · <span className="num">{all.length}</span> קשרים: <span className="num">{by('high')}</span> איכות גבוהה, <span className="num">{by('medium')}</span> בינונית, <span className="num">{by('low')}</span> נמוכה, <span className="num">{miss}</span> חסרים עם סיבה · ש"ח במיליונים, לפני מס אלא אם צוין</div>
      </div>
        <label className="dr-pick"><span className="dim">חברה</span>
          <select value={id} onChange={(e) => nav(`/drivers/${e.target.value}`)}>{cos.map((c) => <option key={c.id} value={c.id}>{c.name_he}</option>)}</select></label>
      </div>
      {f.meta.company === 'more_gemel' && <div className="dr-note">נתוני החיסכון הם של קבוצת מור ברשות, משותפים לקובץ של <Link to="/drivers/more">מור</Link>; אין דוחות כספיים נפרדים</div>}

      {nodes.length > 0 && <Panel title="ערכי בסיס">
        <dl className="dr-nodes">{nodes.map(([k, he, d]) => { const n = f.nodes[k]; return (
          <div key={k}><dt>{he}</dt><dd><Sourced src={src(n.prov)}>{fmt(n.v, d)}{unitOf(n)}</Sourced><span className="dim num">{n.period}</span></dd></div>); })}</dl>
      </Panel>}

      <Panel title="חיסכון ארוך טווח: לכל מוצר" aside={<span>מגזרי, לפני מס · נכסים: רשות שוק ההון · הכנסות והוצאות: דוחות החברות המנהלות</span>}>
        <Table rows={sav} phone={phone} seg />
      </Panel>
      <Panel title="קבוצה: מימון, מס, תשואה להון, שווי">
        <Table rows={grp} phone={phone} />
      </Panel>
      {f.meta.kind === 'insurance_group' && <Panel title="מבטחת: רגישויות שגולו" aside={<span>כפי שהודפסו (דוח + עמוד) · אומדן = הארכה לינארית לזעזוע הסטנדרטי, לא ברירת המחדל של ההפצה</span>}>
        <Table rows={ins} phone={phone} />
      </Panel>}

      <Panel title="בדיקות זהות" aside={<span><span className="num">{f.checks.filter((c) => c.ok).length}/{f.checks.length}</span> מתאימות</span>}>
        <ul className="dr-checks">{f.checks.map((c) => (
          <li key={c.id} className={c.ok ? 'ok' : c.level}><span className="dr-ck">{c.ok ? '✓' : c.level === 'warn' ? '!' : '✗'}</span>{c.he}: <span className="num">{fmt(c.lhs, 2)}</span> מול <span className="num">{fmt(c.rhs, 2)}</span> <span className="dim">(סבולת <span className="num">{fmt(c.tol, 2)}</span>)</span></li>))}
          {f.notes.map((n) => <li key={n.id} className="warn"><span className="dr-ck">!</span>{n.he}</li>)}</ul>
      </Panel>
    </div>
  );
}
