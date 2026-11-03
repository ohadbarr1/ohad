import { cssColor, palette } from '../lib/theme';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { foxOption } from '../lib/foxchart';
import { idColor } from '../lib/identity';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { nf, pct } from '../lib/format';
import type { Prov } from '../lib/prov';
import { amt, cellProv, type Cell } from '../lib/ifrsStd';
import { StdCell } from './csm/StdView';
import { useParam } from './csm/params';
import '../styles/ifrsStd.css';

/* Investment houses by activity (pipeline/build_houses.py -> houses.json): segment revenue, result, margin and AUM per house, the
   revenue-to-profit walk of one period, and the bridge from the regulator's pension and provident figures to the reported revenue. */

type S = Record<string, Cell>;
interface Bridge { q: string; reg_aum: number; posted: number | null; implied: number | null; fees: number; fy_reg: number | null; gap_deposit_other: number | null; seg: Cell | null; seg_minus_fees: number | null; total: Cell | null; other_segments: number | null }
interface House { id: string; name: string; note: string | null; reports: Record<string, number>; keys: string[]; rev: Record<string, S>; profit: Record<string, S>; exp: Record<string, S>; fees: Record<string, S>;
  margin: Record<string, S>; aum: Record<string, S>; names: Record<string, string[]>; aum_names: Record<string, string[]>; group: Record<string, S>; bridge: Bridge[]; nf: { m: string; s: string; why: string; rp: string }[] }
interface HousesFile { built: string; unit: string; source: string; codes: Record<string, string>; group_he: Record<string, string>; bridge_note: string; isa_note: string; houses: House[] }

const ORDER = ['provident_pension', 'investment_management', 'mutual_funds', 'etf', 'portfolio_management', 'brokerage', 'alternatives', 'credit', 'insurance_agency', 'investment_banking', 'other', 'adjustments'];
const keyHe = (k: string) => { const [w, d] = k.split('|'); return w === 'fy' ? `FY${d.slice(2)}` : w === 'q' ? `Q${Math.ceil(Number(d.slice(5, 7)) / 3)}'${d.slice(2, 4)}` : `${Number(d.slice(5, 7))}M'${d.slice(2, 4)}`; };
const v = (c: Cell | undefined | null) => (c ? c[0] : null);

/** /industry/houses: the economics of the listed investment houses beyond pension and provident funds. */
export function IndustryHouses() {
  const { data: D, error } = useLoad<HousesFile>('houses.json');
  const [hid, setHid] = useParam<string>('h', 'meitav');
  const [win, setWin] = useParam<string>('w', 'fy|2025');
  if (error) return <ErrorBox what="בתי ההשקעות" error={error} />;
  if (!D) return <Loading what="בתי ההשקעות" />;
  const H = D.houses.find((h) => h.id === hid) ?? D.houses[0];
  const wins = ['fy|2025', 'fy|2024', 'ytd|2026-06', 'ytd|2025-06', 'q|2026-06', 'q|2026-03'];
  const W = H.keys.includes(win) || wins.includes(win) ? win : 'fy|2025';
  return (
    <div className="houses">
      <Panel title="בתי השקעות · כלכלה לפי פעילות" aside={<span className="muted">מיליוני ש"ח · נכסים: מיליארדי ש"ח</span>}>
        <div className="std-tools">
          <Seg label="בית השקעות" value={H.id} options={D.houses.map((h) => [h.id, h.name])} onChange={setHid} />
          <Seg label="תקופה" value={W} options={wins.map((k) => [k, keyHe(k)])} onChange={setWin} />
        </div>
        <Compare D={D} W={W} />
      </Panel>
      <HousePanel D={D} H={H} W={W} />
      <Walk D={D} H={H} W={W} />
      <BridgePanel D={D} H={H} />
      <p className="src">{D.source}. {D.isa_note}</p>
    </div>
  );
}

/** Every house in one window: revenue, segment results, profit, and the pension-and-provident share. */
function Compare({ D, W }: { D: HousesFile; W: string }) {
  const tot = (h: House, m: 'rev' | 'profit') => h[m].total?.[W];
  const prov = (h: House) => h.rev.provident_pension?.[W] ?? h.rev.investment_management?.[W];
  return (
    <div className="scroll"><table className="std-grid">
      <thead><tr><th>בית השקעות</th><th className="num">הכנסות המגזרים</th><th className="num">תוצאת המגזרים</th><th className="num">שוליים</th><th className="num">רווח לפני מס</th><th className="num">רווח לבעלי המניות</th><th className="num">גמל ופנסיה מההכנסות</th><th className="num">נכסי גמל ופנסיה</th></tr></thead>
      <tbody>{D.houses.map((h) => {
        const r = tot(h, 'rev'), p = tot(h, 'profit'), g = prov(h);
        const aumK = Object.keys(h.aum.provident_pension ?? {}).sort().pop();
        return <tr key={h.id}><th>{h.name}</th>
          <td className="num"><StdCell c={r} title={`הכנסות המגזרים · ${h.name} · ${keyHe(W)}`} why="לא הודפס לתקופה" /></td>
          <td className="num"><StdCell c={p} title={`תוצאת המגזרים · ${h.name} · ${keyHe(W)}`} why="לא הודפס לתקופה" /></td>
          <td className="num">{r && p && r[0] ? <Sourced src={() => calc(`שוליים · ${h.name} · ${keyHe(W)}`, p[0] / r[0] * 100, 'תוצאת המגזרים ÷ הכנסות המגזרים', [['תוצאה', p], ['הכנסות', r]], '%')}>{pct(p[0] / r[0] * 100, 0)}</Sourced> : '–'}</td>
          <td className="num"><StdCell c={h.group.profit_before_tax?.[W]} title={`רווח לפני מס · ${h.name} · ${keyHe(W)}`} /></td>
          <td className="num"><StdCell c={h.group.profit_attributable?.[W]} title={`רווח לבעלי המניות · ${h.name} · ${keyHe(W)}`} /></td>
          <td className="num">{g && r && r[0] ? <Sourced src={() => calc(`גמל ופנסיה מההכנסות · ${h.name}`, g[0] / r[0] * 100, 'הכנסות מגזר הגמל והפנסיה ÷ הכנסות המגזרים', [['גמל ופנסיה', g], ['סה"כ', r]], '%')}>{pct(g[0] / r[0] * 100, 0)}</Sourced> : '–'}</td>
          <td className="num">{aumK ? <StdCell c={h.aum.provident_pension![aumK]} title={`נכסי גמל ופנסיה · ${h.name} · ${aumK}`} /> : '–'}</td></tr>;
      })}</tbody>
    </table></div>
  );
}

function calc(title: string, value: number, formula: string, inputs: [string, Cell][], unit = 'מיליוני ש"ח'): Prov {
  return { k: 'calc', title, value: unit === '%' ? pct(value, 1) : amt(value), unit: unit === '%' ? undefined : unit, formula, inputs: inputs.map(([label, c]) => ({ label, v: amt(c[0]), src: () => cellProv(c, `${title} · ${label}`) })) };
}

/** One house: its segments in the window, their margin and assets, and the segments' revenue over time. */
function HousePanel({ D, H, W }: { D: HousesFile; H: House; W: string }) {
  const phone = usePhone();
  const codes = ORDER.filter((c) => H.rev[c] || H.profit[c]);
  const total = H.rev.total?.[W];
  const aumAt = (c: string) => { const s = H.aum[c] ?? {}; const end = W.split('|')[0] === 'fy' ? `${W.split('|')[1]}-12` : W.split('|')[1]; return s[end] ? [end, s[end]] as const : null; };
  const qk = H.keys.filter((k) => k.startsWith('q|'));
  const fy = H.keys.filter((k) => k.startsWith('fy|'));
  const xs = qk.length >= 4 ? qk : fy;
  return (
    <Panel title={`${H.name} · מגזרים`} aside={<span className="muted">{keyHe(W)}</span>}>
      {codes.length === 0 ? <Empty title="הדוח אינו מציג מגזרי פעילות" /> : (
        <div className="scroll"><table className="std-grid">
          <thead><tr><th>פעילות</th><th>כפי שהודפס</th><th className="num">הכנסות</th><th className="num">חלק מההכנסות</th><th className="num">תוצאה</th><th className="num">שוליים</th><th className="num">נכסים מנוהלים</th></tr></thead>
          <tbody>{[...codes, 'total'].map((c) => { const r = H.rev[c]?.[W], a = aumAt(c); return <tr key={c} className={c === 'total' ? 'tot' : ''}>
            <th>{D.codes[c] ?? c}</th><td>{(H.names[c] ?? []).join(' · ')}</td>
            <td className="num"><StdCell c={r} title={`הכנסות · ${D.codes[c]} · ${H.name} · ${keyHe(W)}`} why="לא הודפס לתקופה" /></td>
            <td className="num">{r && total && total[0] && c !== 'total' ? pct(r[0] / total[0] * 100, 0) : ''}</td>
            <td className="num"><StdCell c={H.profit[c]?.[W]} title={`תוצאת המגזר · ${D.codes[c]} · ${H.name} · ${keyHe(W)}`} why="לא הודפס לתקופה" /></td>
            <td className="num"><StdCell c={H.margin[c]?.[W] ?? (c === 'total' && r && H.profit.total?.[W] && r[0] ? [H.profit.total[W][0] / r[0] * 100, null, null, 1, [[1, H.profit.total[W][0], H.profit.total[W][1], H.profit.total[W][2], 'תוצאה'], [1, r[0], r[1], r[2], 'הכנסות']]] as Cell : undefined)} title={`שוליים · ${D.codes[c]} · ${H.name}`} fmt={(x) => pct(x, 0)} /></td>
            <td className="num">{a ? <StdCell c={a[1]} title={`נכסים מנוהלים · ${D.codes[c]} · ${H.name} · ${a[0]}`} /> : ''}</td></tr>; })}</tbody>
        </table></div>
      )}
      {H.note && <p className="src">{H.note}.</p>}
      {codes.length > 0 && <Chart label={`${H.name} · הכנסות לפי מגזר`} height={phone ? 260 : 300} deps={[H.id]} source={`${H.name}, ביאור מגזרי פעילות`} asof={keyHe(xs[xs.length - 1] ?? W)}
        build={() => foxOption({ x: xs.map(keyHe), unit: 'מיליוני ש"ח', legend: true, labels: false, full: true,
          series: codes.filter((c) => c !== 'adjustments').map((c, i) => ({ name: D.codes[c], kind: 'bar' as const, stack: true, color: palette()[i % 11], data: xs.map((k) => v(H.rev[c]?.[k])) })) })} />}
      <AumTable D={D} H={H} />
    </Panel>
  );
}

function AumTable({ D, H }: { D: HousesFile; H: House }) {
  const codes = ORDER.filter((c) => H.aum[c]).concat(H.aum.total ? ['total'] : []);
  const ends = [...new Set(codes.flatMap((c) => Object.keys(H.aum[c])))].sort().slice(-6);
  if (!codes.length) return null;
  return (
    <>
      <h3 className="std-h3">נכסים מנוהלים · מיליארדי ש"ח</h3>
      <div className="scroll"><table className="std-grid">
        <thead><tr><th>פעילות</th>{ends.map((e) => <th key={e} className="num">{e.slice(5)}/{e.slice(2, 4)}</th>)}</tr></thead>
        <tbody>{codes.map((c) => <tr key={c}><th title={(H.aum_names[c] ?? []).join(' · ')}>{D.codes[c] ?? c}</th>{ends.map((e) => <td key={e} className="num"><StdCell c={H.aum[c][e]} title={`נכסים מנוהלים · ${D.codes[c]} · ${H.name} · ${e}`} why="לא הודפס לתאריך" /></td>)}</tr>)}</tbody>
      </table></div>
    </>
  );
}

/** From revenue to the shareholders' profit in one window: every step printed, every residual a labelled difference. */
function Walk({ D, H, W }: { D: HousesFile; H: House; W: string }) {
  const G = H.group;
  const rev = G.revenue_total?.[W] ?? H.rev.total?.[W];
  const seg = H.profit.total?.[W];
  const op = G.operating_profit?.[W], pbt = G.profit_before_tax?.[W], net = G.net_profit?.[W], att = G.profit_attributable?.[W], tax = G.tax_expense?.[W];
  type Row = { label: string; c?: Cell | null; d?: [number, string, [string, Cell][]] | null; lead?: boolean; sub?: boolean };
  const diff = (a: Cell | null | undefined, b: Cell | null | undefined, why: string, la: string, lb: string): Row['d'] => (a && b ? [a[0] - b[0], why, [[la, a], [lb, b]]] : null);
  const rows: Row[] = [
    { label: 'הכנסות', c: rev, lead: true },
    { label: 'עלויות המגזרים (הפרש)', d: diff(seg, rev, 'תוצאת המגזרים פחות ההכנסות', 'תוצאת המגזרים', 'הכנסות') },
    { label: 'תוצאת המגזרים', c: seg, lead: true },
    ...ORDER.filter((c) => H.profit[c]?.[W]).map((c) => ({ label: `${D.codes[c]}`, c: H.profit[c][W], sub: true })),
    { label: 'לא מוקצה ואחר (הפרש)', d: diff(op ?? pbt, seg, op ? 'רווח תפעולי פחות תוצאת המגזרים' : 'רווח לפני מס פחות תוצאת המגזרים', op ? 'רווח תפעולי' : 'רווח לפני מס', 'תוצאת המגזרים') },
    ...(op ? [{ label: 'רווח תפעולי', c: op, lead: true }, { label: 'מימון, כלולות ואחר (הפרש)', d: diff(pbt, op, 'רווח לפני מס פחות רווח תפעולי', 'רווח לפני מס', 'רווח תפעולי') }] : []),
    { label: 'רווח לפני מס', c: pbt, lead: true },
    tax ? { label: 'מסים על ההכנסה', c: tax } : { label: 'מסים (הפרש)', d: diff(net, pbt, 'רווח נקי פחות רווח לפני מס', 'רווח נקי', 'רווח לפני מס') },
    { label: 'רווח נקי', c: net, lead: true },
    { label: 'זכויות שאינן מקנות שליטה (הפרש)', d: diff(att, net, 'רווח לבעלי המניות פחות רווח נקי', 'לבעלי המניות', 'רווח נקי') },
    { label: 'רווח לבעלי המניות', c: att, lead: true },
  ];
  const lines = ['commissions_expense', 'agent_commissions', 'salaries_expense', 'selling_marketing', 'g_and_a', 'amortisation_intangibles', 'depreciation_amortisation', 'credit_interest_income', 'credit_funding_expense', 'legal_claims_refund', 'legal_claims_finance_net', 'finance_expense']
    .filter((m) => G[m]?.[W]);
  if (!rev) return <Panel title={`${H.name} · מהכנסות לרווח`}><Empty title="לא הודפסו הכנסות לתקופה" /></Panel>;
  return (
    <Panel title={`${H.name} · מהכנסות לרווח`} aside={<span className="muted">{keyHe(W)} · מיליוני ש"ח</span>}>
      <div className="grid21">
        <div className="scroll"><table className="std-grid">
          <tbody>{rows.filter((r) => r.c || r.d).map((r, i) => <tr key={i} className={r.lead ? 'tot' : r.sub ? 'sub' : ''}><th>{r.label}</th>
            <td className="num">{r.c ? <StdCell c={r.c} title={`${r.label} · ${H.name} · ${keyHe(W)}`} /> : r.d ? <Sourced className="std-der" src={() => calc(`${r.label} · ${H.name} · ${keyHe(W)}`, r.d![0], r.d![1], r.d![2])}>{amt(r.d[0])}</Sourced> : ''}</td>
            <td className="num">{rev && (r.c || r.d) && rev[0] ? pct(((r.c ? r.c[0] : r.d![0]) / rev[0]) * 100, 0) : ''}</td></tr>)}</tbody>
        </table></div>
        {lines.length > 0 && <div className="scroll"><table className="std-grid">
          <thead><tr><th>שורות עלות שהודפסו</th><th className="num">{keyHe(W)}</th><th className="num">מההכנסות</th></tr></thead>
          <tbody>{lines.map((m) => <tr key={m}><th>{D.group_he[m] ?? m}</th><td className="num"><StdCell c={G[m][W]} title={`${D.group_he[m]} · ${H.name} · ${keyHe(W)}`} /></td><td className="num">{pct(G[m][W][0] / rev[0] * 100, 0)}</td></tr>)}</tbody>
        </table></div>}
      </div>
    </Panel>
  );
}

/** Regulator assets x posted fee -> the managing company's reported fees -> the house's pension-and-provident segment -> its total revenue. */
function BridgePanel({ D, H }: { D: HousesFile; H: House }) {
  const phone = usePhone();
  if (!H.bridge.length) return <Panel title={`${H.name} · מהרגולטור לדוח`}><Empty title={H.id === 'ibi' ? 'אין לבית ההשקעות פעילות גמל ופנסיה' : 'אין לחברה המנהלת דמי ניהול מדווחים בסדרה של fox'} /></Panel>;
  const B = H.bridge.slice(-8);
  const reg = (b: Bridge, label: string, val: number | null, formula: string): Prov => ({ k: 'calc', title: `${label} · ${H.name} · ${keyHe(b.q)}`, value: amt(val), unit: 'מיליוני ש"ח', formula,
    inputs: [{ label: 'נכסים ממוצעים ברבעון, גמל-נט ופנסיה-נט (מיליוני ש"ח)', v: nf(b.reg_aum, 0) }, { label: 'דמי ניהול ממוצעים מצבירה, הרגולטור (%)', v: b.posted == null ? '–' : nf(b.posted, 3) }] });
  const rows: [string, (b: Bridge) => JSX.Element | string][] = [
    ['דמי ניהול מנכסים לפי הרגולטור (נכסים × דמי ניהול ÷ 4)', (b) => (b.implied == null ? '–' : <Sourced className="std-der" src={() => reg(b, 'דמי ניהול מנכסים לפי הרגולטור', b.implied, 'נכסים ממוצעים × דמי ניהול ממוצעים ÷ 4')}>{amt(b.implied)}</Sourced>)],
    ['+ דמי ניהול מהפקדות ואחר (הפרש)', (b) => (b.gap_deposit_other == null ? '–' : <span className="std-der">{amt(b.gap_deposit_other)}</span>)],
    ['= דמי ניהול שהחברה המנהלת דיווחה', (b) => amt(b.fees)],
    ['+ הכנסות נוספות במגזר (הפרש)', (b) => (b.seg_minus_fees == null ? '–' : <span className="std-der">{amt(b.seg_minus_fees)}</span>)],
    ['= הכנסות מגזר הגמל והפנסיה', (b) => (b.seg ? <StdCell c={b.seg} title={`הכנסות מגזר הגמל והפנסיה · ${H.name} · ${keyHe(b.q)}`} /> : '–')],
    ['+ שאר המגזרים (הפרש)', (b) => (b.other_segments == null ? '–' : <span className="std-der">{amt(b.other_segments)}</span>)],
    ['= הכנסות המגזרים', (b) => (b.total ? <StdCell c={b.total} title={`הכנסות המגזרים · ${H.name} · ${keyHe(b.q)}`} /> : '–')],
    ['תשואת דמי ניהול על נכסי הרגולטור (שנתי, %)', (b) => (b.fy_reg == null ? '–' : nf(b.fy_reg, 3))],
  ];
  return (
    <Panel title={`${H.name} · מהרגולטור לדוח`} aside={<span className="muted">רבעונים · מיליוני ש"ח</span>}>
      <div className="scroll"><table className="std-grid hs-bridge">
        <thead><tr><th>שלב</th>{B.map((b) => <th key={b.q} className="num">{keyHe(b.q)}</th>)}</tr></thead>
        <tbody>{rows.map(([l, f], i) => <tr key={i} className={l.startsWith('=') ? 'tot' : ''}><th className="lbl">{l}</th>{B.map((b) => <td key={b.q} className="num">{f(b)}</td>)}</tr>)}</tbody>
      </table></div>
      <Chart label={`${H.name} · דמי ניהול גמל ופנסיה: לפי הרגולטור מול מדווח`} height={phone ? 220 : 240} deps={[H.id]} source="הרשות לשוק ההון (גמל-נט, פנסיה-נט); דוחות החברה המנהלת ובית ההשקעות" asof={keyHe(B[B.length - 1].q)}
        build={() => foxOption({ x: B.map((b) => keyHe(b.q)), unit: 'מיליוני ש"ח', legend: true, labels: false, full: true, series: [
          { name: 'לפי הרגולטור', kind: 'line' as const, color: cssColor('--muted'), dashed: true, data: B.map((b) => b.implied) },
          { name: 'דווח (חברה מנהלת)', kind: 'bar' as const, color: idColor(H.id), data: B.map((b) => b.fees) },
          { name: 'מגזר הגמל והפנסיה', kind: 'line' as const, color: cssColor('--accent'), data: B.map((b) => v(b.seg)) }] })} />
      <p className="src">{D.bridge_note}</p>
    </Panel>
  );
}
