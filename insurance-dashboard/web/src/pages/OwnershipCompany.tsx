import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { DataTable, type Column } from '../components/DataTable';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Seg } from '../components/ui';
import { MINUS, nf, pubLabel } from '../lib/format';
import { foxOption, type FoxSeries } from '../lib/foxchart';
import { idColor, idCss } from '../lib/identity';
import { cssColor, palette } from '../lib/theme';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { Disclaimers } from './Ownership';
import {
  CHANNEL_HE, ipProv, monthLabel, nameOf, pctTxt, qLabel, reportProv, TYPE_HE,
  type Change, type FundMgr, type Holder, type OwnCompany, type OwnIndex, type Series,
} from './ownershipData';
import '../styles/ownership.css';

const TOP = 6;
const signed = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? MINUS : ''}${nf(Math.abs(v), d)}`);

/** One listed group: today's holders (MAYA), the quarterly holdings reports over time (ת077), QoQ changes, and the funds holding the share. */
export function OwnershipCompany() {
  const { id = '' } = useParams();
  const idx = useLoad<OwnIndex>('ownership/index.json');
  const row = idx.data?.companies.find((r) => r.id === id);
  const { data, error } = useLoad<OwnCompany>(row ? `ownership/${id}.json` : null);
  const phone = usePhone();
  const [all, setAll] = useState<'main' | 'all'>('main');

  if (idx.error) return <ErrorBox what="נתוני הבעלות" error={idx.error} />;
  if (!idx.data) return <Loading what="נתוני בעלות" />;
  const names = idx.data.names;
  if (!row) return (
    <div className="own">
      <Head id={id} names={names} />
      <Empty title={names[id] ? 'אין נתוני בעלות לחברה זו' : 'החברה אינה ברשימה'}>{names[id] && <p>החברה אינה רשומה למסחר בבורסה, ולכן אין לה רשימת בעלי עניין במאיה.</p>}<Link to="/ownership">כל הקבוצות ›</Link></Empty>
    </div>
  );
  if (error) return <ErrorBox what="בעלי המניות" error={error} />;
  if (!data) return <Loading what="בעלי המניות" />;
  const s = data.split;
  const holders = data.holders.filter((h) => all === 'all' || h.main);
  return (
    <div className="own">
      <Head id={id} names={names} c={data} />
      <div className="kpis own-kpis">
        <Kpi l="בעלי שליטה" v={s.controlling} sub={s.controlling_asof ? `נכון ל-${pubLabel(s.controlling_asof)}` : undefined} c={data} />
        <Kpi l="בעלי עניין" v={s.interested} c={data} />
        <Kpi l="מוסדיים (בעלי עניין)" v={s.institutional} c={data} />
        <Kpi l="ציבור" v={s.public} sub={s.asof ? `נכון ל-${pubLabel(s.asof)}` : undefined} c={data} />
      </div>

      <History c={data} names={names} phone={phone} />

      <section className="panel">
        <div className="hd">
          <h2>בעלי עניין היום</h2>
          <div className="aside">
            <Seg label="ניירות" value={all} onChange={setAll} options={[['main', 'מניה'], ['all', 'כל הניירות']]} />
            <a className="own-src" href={data.maya_url} target="_blank" rel="noreferrer">במאיה ↗</a>
          </div>
        </div>
        <HoldersTable c={data} rows={holders} names={names} phone={phone} />
      </section>

      {data.funds && <Funds f={data.funds} names={names} c={data} phone={phone} />}

      {data.indices.length > 0 && (
        <section className="panel own-idx">
          <div className="hd"><h2>מדדים</h2><span className="aside num">{data.indices.length}</span></div>
          <div className="own-chips">{data.indices.map((x) => <span key={x} className="chip">{x}</span>)}</div>
        </section>
      )}

      <Disclaimers d={idx.data.disclaimers} source={idx.data.source} built={idx.data.built} />
    </div>
  );
}

function Head({ id, names, c }: { id: string; names: Record<string, string>; c?: OwnCompany }) {
  return (
    <div className="pagehead">
      <div>
        <h1><span className="own-dot lg" style={{ background: idCss(id) }} />{names[id] ?? id} <span className="muted">· בעלות</span></h1>
        <div className="sub">
          {c && <span>{c.entity}</span>}
          {c?.parent_note && <span className="chip est">{c.parent_note}</span>}
          <Link to="/ownership" className="chip">החזקות צולבות ›</Link>
          {names[id] && <Link to={`/company/${id}`} className="chip">דף החברה ›</Link>}
        </div>
      </div>
    </div>
  );
}

function Kpi({ l, v, sub, c }: { l: string; v: number | null; sub?: string; c: OwnCompany }) {
  return (
    <div className="kpi">
      <span className="l">{l}</span>
      <span className="v">{v == null ? '–' : <Sourced src={() => ({ k: 'report', title: `${l} · % מההון`, value: pctTxt(v), url: c.maya_url, pg: null, doc: `התפלגות החזקות, ${c.entity}`, period: sub, srcType: 'MAYA · דף החברה באתר הבורסה (התפלגות החזקות)' })} href={c.maya_url}>{nf(v, 1)}%</Sourced>}</span>
      {sub && <span className="s num">{sub}</span>}
    </div>
  );
}

/* ---------- history: the quarterly holdings reports ---------- */
function History({ c, names, phone }: { c: OwnCompany; names: Record<string, string>; phone: boolean }) {
  const h = c.history;
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const { top, rest } = useMemo(() => {
    const ser = h.series.filter((x) => x.pts.some((v) => (v ?? 0) > 0));
    return { top: ser.slice(0, TOP), rest: ser.slice(TOP) };
  }, [h.series]);
  if (!h.quarters.length) return (
    <section className="panel"><div className="hd"><h2>לאורך זמן</h2></div><Empty title="אין דוחות מצבת החזקות בתקופה">לא נמצאו דוחות ת077 בשלוש השנים האחרונות.</Empty></section>
  );
  const x = h.quarters.map(qLabel);
  const pal = palette();
  const colorOf = (s: Series, i: number) => (s.group ? idColor(s.group) : s.type === 'controlling' ? cssColor('--fg') : pal[(i + 4) % pal.length]);
  const others = h.quarters.map((_, qi) => { const v = rest.reduce((a, s) => a + (s.pts[qi] ?? 0), 0); return v ? Math.round(v * 100) / 100 : null; });
  const series: FoxSeries[] = [
    ...top.map((s, i) => ({ name: label(s, names), data: s.pts, color: colorOf(s, i), kind: 'line' as const, area: true, stack: true })),
    ...(others.some((v) => v) ? [{ name: 'בעלי עניין אחרים', data: others, color: cssColor('--neutral'), kind: 'line' as const, area: true, stack: true }] : []),
    { name: 'ציבור', data: h.reports.map((r) => r.public), color: cssColor('--panel3'), kind: 'line' as const, area: true, stack: true },
    { name: 'סך בעלי שליטה', data: h.reports.map((r) => r.controlling), color: cssColor('--accent'), kind: 'line' as const, dashed: true },
  ];
  const last = h.reports[h.reports.length - 1];
  return (
    <section className="panel">
      <div className="hd">
        <h2>לאורך זמן <span className="muted own-h2s">% מההון בסוף כל רבעון</span></h2>
        <div className="aside"><Seg label="תצוגה" value={view} onChange={setView} options={[['chart', 'גרף'], ['table', 'טבלה']]} /></div>
      </div>
      {view === 'chart'
        ? <Chart label={`בעלות לאורך זמן · ${names[c.id] ?? c.id}`} height={phone ? 300 : 360} deps={[c.id, h.quarters.length]}
            source={`MAYA · ת077, ${h.reports.length} דוחות, אחרון ${qLabel(last.q)}`}
            build={() => ({ ...foxOption({ x, series, unit: '% מההון', legend: true, labels: false, full: true }), yAxis: [{ type: 'value', max: 100, name: '% מההון', axisLabel: { formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { type: 'dashed', color: cssColor('--line') } } }] })} />
        : <HistoryTable c={c} names={names} series={[...top, ...rest]} />}
      <div className="own-hist-foot">
        {h.changes.length > 0 && <Changes ch={h.changes} names={names} q0={h.quarters[h.quarters.length - 2]} q1={h.quarters[h.quarters.length - 1]} />}
        <div className="own-reports">
          <b>הדוחות</b>
          <div className="own-chips">
            {h.reports.slice().reverse().map((r) => <a key={r.rid} className="chip" href={r.file ?? r.url} target="_blank" rel="noreferrer" title={`אסמכתא ${r.rid}, פורסם ${pubLabel(r.published)}`}>{qLabel(r.q)}</a>)}
          </div>
        </div>
      </div>
    </section>
  );
}

const label = (s: Series, names: Record<string, string>) => {
  const n = nameOf(names, s);
  return s.group ? `${n} (כל הגופים)` : n.length > 26 ? `${n.slice(0, 25)}…` : n;
};

function HistoryTable({ c, names, series }: { c: OwnCompany; names: Record<string, string>; series: Series[] }) {
  const h = c.history;
  const qs = h.quarters.map((q, i) => ({ q, i })).slice(-8);
  type R = { s: Series | null; kind: 'holder' | 'public' | 'ctl' };
  const rows: R[] = [...series.map((s) => ({ s, kind: 'holder' as const })), { s: null, kind: 'ctl' }, { s: null, kind: 'public' }];
  const cols: Column<R>[] = [
    { key: 'n', head: 'מחזיק', value: (r) => (r.s ? nameOf(names, r.s) : r.kind === 'ctl' ? 'סך בעלי שליטה' : 'ציבור'),
      cell: (r) => r.s ? <span className="own-co">{r.s.group && <span className="own-dot" style={{ background: idCss(r.s.group) }} />}{nameOf(names, r.s)}{r.s.type === 'controlling' && <span className="chip own-ctl">שליטה</span>}</span> : <b>{r.kind === 'ctl' ? 'סך בעלי שליטה' : 'ציבור'}</b> },
    ...qs.map(({ q, i }) => ({
      key: q, head: qLabel(q), unit: 'pct' as const, d: 2,
      value: (r: R) => (r.s ? r.s.pts[i] : r.kind === 'ctl' ? h.reports[i].controlling : h.reports[i].public),
      src: (r: R) => {
        const v = r.s ? r.s.pts[i] : r.kind === 'ctl' ? h.reports[i].controlling : h.reports[i].public;
        if (v == null) return null;
        const parts = r.s?.parts[q];
        const note = r.kind === 'public' ? 'ציבור = 100 פחות סך החזקות בעלי העניין בטופס (סעיף א, % הון)' : parts && parts.length > 1 ? parts.map((p) => `${p.name} ${pctTxt(p.cap)}`).join(' · ') : parts?.[0]?.type;
        return reportProv(`${r.s ? nameOf(names, r.s) : r.kind === 'ctl' ? 'סך בעלי שליטה' : 'ציבור'} · ${qLabel(q)}`, pctTxt(v), h.reports[i], c.entity, note || undefined);
      },
      href: () => h.reports[i].file ?? h.reports[i].url,
    })),
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r, i) => r.s?.key ?? `${r.kind}${i}`} caption="בעלות לאורך זמן"
    rowClass={(r) => (r.s ? undefined : 'own-sum')}
    export={{ name: `fox-ownership-${c.id}-history`, title: `בעלות לאורך זמן · ${names[c.id] ?? c.id}`, note: 'MAYA, דוחות מצבת החזקות בעלי עניין (ת077), % מההון' }} />;
}

function Changes({ ch, names, q0, q1 }: { ch: Change[]; names: Record<string, string>; q0: string; q1: string }) {
  return (
    <div className="own-chg">
      <b>שינויים <span className="num">{qLabel(q0)} → {qLabel(q1)}</span></b>
      <ul>
        {ch.slice(0, 8).map((x) => (
          <li key={x.key}>
            {x.group && <span className="own-dot" style={{ background: idCss(x.group) }} />}
            <span className="own-chg-n">{nameOf(names, x)}</span>
            <span className="num muted">{pctTxt(x.from)} → {pctTxt(x.to)}</span>
            <span className={`num ${(x.d ?? 0) > 0 ? 'pos' : 'neg'}`}>{signed(x.d)} נק׳</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- today ---------- */
function HoldersTable({ c, rows, names, phone }: { c: OwnCompany; rows: Holder[]; names: Record<string, string>; phone: boolean }) {
  const cols: Column<Holder>[] = [
    { key: 'n', head: 'מחזיק', value: (h) => h.name, cell: (h) => (
      <span className="own-co" title={h.remark ?? undefined}>
        {h.group && <span className="own-dot" style={{ background: idCss(h.group) }} />}{h.name}
        {h.group && !h.self && <small className="muted"> · {names[h.group]}</small>}
        {h.remark && <sup className="own-rm" aria-label="הערה">*</sup>}
      </span>) },
    { key: 't', head: 'סוג', value: (h) => TYPE_HE[h.type], cell: (h) => <span className={`chip own-t-${h.type}`}>{TYPE_HE[h.type]}</span> },
    ...(phone ? [] : [{ key: 'ch', head: 'ערוץ', value: (h: Holder) => (h.channel ? CHANNEL_HE[h.channel] : null) }]),
    { key: 'cap', head: '% הון', value: (h) => h.cap, unit: 'pct', d: 2, src: (h) => ipProv(c, h), href: () => c.maya_url },
    ...(phone ? [] : [
      { key: 'vote', head: '% הצבעה', value: (h: Holder) => h.vote, unit: 'pct' as const, d: 2, src: (h: Holder) => ipProv(c, h, 'vote'), href: () => c.maya_url },
      { key: 'sec', head: 'נייר', value: (h: Holder) => h.security },
    ]),
    { key: 'd', head: 'יתרה ליום', value: (h) => h.date, cell: (h) => <span className="num muted">{pubLabel(h.date)}</span> },
  ];
  if (!rows.length) return <Empty title="אין בעלי עניין רשומים" />;
  return <DataTable rows={rows} columns={cols} rowKey={(h, i) => `${h.name}|${h.security}|${i}`} sort={{ key: 'cap', dir: 'desc' }} caption="בעלי עניין"
    export={{ name: `fox-ownership-${c.id}`, title: `בעלי עניין · ${names[c.id] ?? c.id}`, note: `MAYA, נכון ל-${pubLabel(c.split.asof)}` }} />;
}

function Funds({ f, names, c, phone }: { f: NonNullable<OwnCompany['funds']>; names: Record<string, string>; c: OwnCompany; phone: boolean }) {
  const prov = (r: FundMgr) => ({ k: 'calc' as const, title: `${r.manager ?? 'מנהל לא מזוהה'} · קרנות ב${names[c.id] ?? c.id}`, value: pctTxt(r.pct, 3), formula: 'יחידות בקרנות המנהל ÷ הון מונפק ונפרע × 100',
    inputs: [{ label: 'יחידות', v: nf(r.qty, 0) }, { label: 'הון מונפק ונפרע', v: nf(f.issued, 0) }, { label: 'קרנות', v: String(r.funds) }],
    note: `דוח חודשי ${monthLabel(f.month)} של מנהלי הקרנות, כפי שפורסם במאיה.` });
  const cols: Column<FundMgr>[] = [
    { key: 'm', head: 'מנהל הקרנות', value: (r) => r.manager ?? 'לא מזוהה', cell: (r) => <span className="own-co">{r.group && <span className="own-dot" style={{ background: idCss(r.group) }} />}{r.manager ?? 'לא מזוהה'}</span> },
    { key: 'n', head: 'קרנות', value: (r) => r.funds, unit: 'int' },
    { key: 'p', head: '% הון', value: (r) => r.pct, unit: 'pct', d: 2, src: prov, href: () => f.src, derived: () => true, total: 'sum' },
    ...(phone ? [] : [{ key: 'v', head: 'שווי, מיליוני ש"ח', value: (r: FundMgr) => r.nis_m, unit: 'n' as const, d: 1, total: 'sum' as const }]),
  ];
  return (
    <section className="panel">
      <div className="hd">
        <h2>קרנות נאמנות וסל מחזיקות <span className="muted own-h2s">דוח {monthLabel(f.month)}</span></h2>
        <div className="aside"><span className="num">{f.n} קרנות · {nf(f.total_pct, 1)}% מההון</span><a className="own-src" href={f.src} target="_blank" rel="noreferrer">במאיה ↗</a></div>
      </div>
      <DataTable rows={f.by_manager} columns={cols} rowKey={(r, i) => `${r.manager}${i}`} sort={{ key: 'p', dir: 'desc' }} totalLabel="סך הכול" caption="קרנות מחזיקות לפי מנהל"
        export={{ name: `fox-ownership-${c.id}-funds`, title: `קרנות מחזיקות · ${names[c.id] ?? c.id}`, note: `MAYA, דוח חודשי ${monthLabel(f.month)}` }} />
      {f.unmapped > 0 && <p className="muted own-note num">{f.unmapped} קרנות ללא שיוך למנהל.</p>}
    </section>
  );
}
