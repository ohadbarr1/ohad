import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../../components/Chart';
import { Sourced } from '../../components/Source';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/ui';
import { foxOption } from '../../lib/foxchart';
import { useSource } from '../../lib/prov';
import { MODULES, RISK_HE, dLab, latestWith, showV, solvProv, useSolvency, type SolvCell, type SolvFile, type SolvSens } from '../../lib/solvency';
import { cssColor } from '../../lib/theme';
import { usePhone } from '../../lib/useMedia';
import '../../styles/solvency.css';

type Col = { c: string; d: string };
const NEG = new Set(['m_div', 'm_lac_dt', 'm_lac_tp']);
const TIER_ROWS: [string, string][] = [['t1', 'רובד 1'], ['t1r', 'מתוכו רובד 1 נוסף'], ['t2', 'רובד 2'], ['t3', 'רובד 3'], ['of_w', 'סך הון עצמי לעניין SCR'], ['scr_w', 'SCR'], ['sr_w', 'יחס כושר פירעון']];
const SRC = 'דוחות כושר פירעון כלכלי (Solvency II), MAYA';
const dirOf = (l: string) => (/ירידה|קיטון|הפחתה/.test(l) ? 'ירידה' : /עלי|גידול|תוספת/.test(l) ? 'עלייה' : '');
const MM = 'מיליוני ש"ח';

/** SCR by risk module, own funds by tier and the solvency sensitivities, read from the separate economic-solvency reports.
 *  Industry: every insurer at its latest report, or one insurer over time. Company (`company`): that insurer over time. */
export function ScrComposition({ ids, name, company }: { ids: string[]; name: (id: string) => string; company?: string }) {
  const S = useSolvency();
  const [mode, setMode] = useState<'latest' | 'hist'>('latest');
  const [who, setWho] = useState('');
  if (S.error) return <ErrorBox what="דוחות כושר פירעון" error={S.error} />;
  if (!S.data) return <Loading what="הרכב SCR" />;
  const D = S.data;
  const have = ids.filter((c) => D.companies[c]);
  if (company && !D.companies[company]) return null;
  if (!have.length && !company) return <Panel title="הרכב SCR לפי מודול סיכון"><Empty title="אין דוחות כושר פירעון מחולצים" /></Panel>;
  const one = company ?? (who || have.find((c) => latestWith(D, c, 'm_market') && Object.keys(D.companies[c]).length > 8) || have[0]);
  const hist = mode === 'hist' || !!company;
  const colsFor = (key: string): Col[] => (hist ? Object.keys(D.companies[one] ?? {}).filter((d) => D.companies[one][d][key]).sort().map((d) => ({ c: one, d }))
    : have.map((c) => ({ c, d: latestWith(D, c, key) })).filter((x): x is Col => !!x.d));
  const picker = !company && (
    <div className="sv-pick">
      <Seg<'latest' | 'hist'> label="תצוגה" value={mode} onChange={setMode} options={[['latest', 'כל החברות · דוח אחרון'], ['hist', 'חברה לאורך זמן']]} />
      {hist && <select aria-label="חברה" value={one} onChange={(e) => setWho(e.target.value)}>{have.map((c) => <option key={c} value={c}>{name(c)}</option>)}</select>}
    </div>
  );
  const body = (
    <>
      <Modules D={D} cols={colsFor('m_market')} hist={hist} name={name} picker={picker} />
      <div className="csm-grid">
        <Tiers D={D} cols={colsFor('of_w')} hist={hist} name={name} />
        <Sens D={D} rows={D.sens.filter((r) => (hist ? r.c === one : have.includes(r.c)))} hist={hist} name={name} />
      </div>
      {company && <div className="src sv-more"><Link to="/industry/csm?view=capital">כושר פירעון והרכב SCR, כל המבטחות</Link></div>}
    </>
  );
  return company ? <section className="kpi-sec" aria-label="כושר פירעון"><h2 className="band">כושר פירעון<span className="muted">דוחות כושר פירעון כלכלי · חברת הביטוח</span></h2>{body}</section> : body;
}

const colLab = (x: Col, hist: boolean, name: (id: string) => string) => (hist ? dLab(x.d) : `${name(x.c)} ${dLab(x.d)}`);
const cell = (D: SolvFile, x: Col, k: string): SolvCell | undefined => D.companies[x.c]?.[x.d]?.[k];
const bn = (y: SolvCell | undefined) => (y ? +(y.v / 1000).toFixed(2) : null);
const ViewSeg = ({ v, set }: { v: 'chart' | 'table'; set: (v: 'chart' | 'table') => void }) => <Seg<'chart' | 'table'> label="תצוגה" value={v} onChange={set} options={[['chart', 'גרף'], ['table', 'טבלה']]} />;

function Modules({ D, cols, hist, name, picker }: { D: SolvFile; cols: Col[]; hist: boolean; name: (id: string) => string; picker: ReactNode }) {
  const { open } = useSource();
  const phone = usePhone();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const mods = MODULES.filter(([k]) => cols.some((x) => cell(D, x, k)));
  const src = (x: Col, k: string, l: string) => { const y = cell(D, x, k)!; return solvProv(D, y, `${l} · ${name(x.c)} · ${dLab(x.d)}`, x.d, MM, showV(k, y.v)); };
  let pos = 0;
  return (
    <Panel title="הרכב SCR לפי מודול סיכון" aside={<><span>מיליארדי ש"ח · פיזור והתאמות בשלילה</span><ViewSeg v={view} set={setView} /></>}>
      {picker}
      {!cols.length ? <Empty title="הדוחות של חברה זו אינם מפרטים מודולים" /> : view === 'chart' ? (
        <Chart label="הרכב SCR לפי מודול סיכון" height={phone ? 320 : 340} deps={[cols.map((x) => x.c + x.d).join(), hist]} source={SRC}
          build={() => foxOption({ x: cols.map((x) => colLab(x, hist, name)), unit: 'מיליארדי ש"ח', legend: true, labels: false, full: true, total: true, rotate: !hist ? 30 : undefined,
            series: mods.map(([k, l]) => ({ name: l, kind: 'bar' as const, stack: true, color: cssColor(NEG.has(k) ? '--neutral' : `--s${++pos}`), opacity: NEG.has(k) ? 0.5 : undefined, dec: 1, data: cols.map((x) => bn(cell(D, x, k))) })) })}
          onPoint={(si, di) => { const m = mods[si], x = cols[di]; if (m && x && cell(D, x, m[0])) open(src(x, m[0], `SCR · ${m[1]}`)); }} />
      ) : (
        <div className="scroll"><table className="tight sv-t">
          <thead><tr><th>מודול</th>{cols.map((x) => <th key={x.c + x.d}>{colLab(x, hist, name)}</th>)}</tr></thead>
          <tbody>
            {[...mods, ['bscr', 'BSCR'] as [string, string], ['scr_w', 'SCR, עם הוראות מעבר'] as [string, string]].map(([k, l]) => (
              <tr key={k} className={NEG.has(k) ? 'neg' : k === 'bscr' || k === 'scr_w' ? 'tot' : ''}><td>{l}</td>
                {cols.map((x) => { const y = cell(D, x, k); return <td key={x.c + x.d}>{y ? <Sourced className="num" src={() => src(x, k, k.startsWith('m_') ? `SCR · ${l}` : l)}>{showV(k, y.v)}</Sourced> : <span className="muted">–</span>}{y?.i && <span className="sv-img" title="נקרא מתמונה">◫</span>}</td>; })}
              </tr>))}
          </tbody>
        </table></div>
      )}
      <div className="src">מודולים לפני פיזור, כפי שהודפסו; סכום העמודה בגרף ≈ ה-SCR (ללא התאמות שלא פורטו) · טבלה: מיליוני ש"ח · {SRC}</div>
    </Panel>
  );
}

function Tiers({ D, cols, hist, name }: { D: SolvFile; cols: Col[]; hist: boolean; name: (id: string) => string }) {
  const { open } = useSource();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  // tier 1 as printed in total; where only the basic tier-1 row is printed (no restricted row) it is all of tier 1
  const get = (x: Col, k: string) => (k === 't1' ? cell(D, x, 't1') ?? (cell(D, x, 't1r') ? undefined : cell(D, x, 't1b')) : cell(D, x, k));
  const src = (x: Col, k: string, l: string) => { const y = get(x, k)!; return solvProv(D, y, `${l} · ${name(x.c)} · ${dLab(x.d)}`, x.d, k === 'sr_w' ? '%' : MM, showV(k, y.v)); };
  const ser = ([['t1', 'רובד 1', '--s1'], ['t2', 'רובד 2', '--s3'], ['t3', 'רובד 3', '--s5']] as const).filter(([k]) => cols.some((x) => get(x, k)));
  const keys: [string, string][] = [...ser.map(([k, l]) => [k, l] as [string, string]), ['scr_w', 'SCR']];
  return (
    <Panel title="הון עצמי לפי רובד, מול SCR" aside={<ViewSeg v={view} set={setView} />}>
      {!cols.length ? <Empty title="אין פירוט רבדים" /> : view === 'chart' ? (
        <Chart label="הון עצמי לפי רובד מול SCR" height={300} deps={[cols.map((x) => x.c + x.d).join(), hist]} source={SRC}
          build={() => foxOption({ x: cols.map((x) => colLab(x, hist, name)), unit: 'מיליארדי ש"ח', legend: true, labels: false, full: true, rotate: !hist ? 30 : undefined,
            series: [...ser.map(([k, l, c]) => ({ name: l, kind: 'bar' as const, stack: true, color: cssColor(c), dec: 1, data: cols.map((x) => bn(get(x, k))) })),
              { name: 'SCR', kind: 'bar' as const, color: cssColor('--neutral'), opacity: 0.6, dec: 1, data: cols.map((x) => bn(cell(D, x, 'scr_w'))) }] })}
          onPoint={(si, di) => { const m = keys[si], x = cols[di]; if (m && x && get(x, m[0])) open(src(x, m[0], m[1])); }} />
      ) : (
        <div className="scroll"><table className="tight sv-t">
          <thead><tr><th />{cols.map((x) => <th key={x.c + x.d}>{colLab(x, hist, name)}</th>)}</tr></thead>
          <tbody>{TIER_ROWS.filter(([k]) => cols.some((x) => get(x, k))).map(([k, l]) => <tr key={k} className={k === 'of_w' || k === 'sr_w' ? 'tot' : k === 't1r' ? 'sub' : ''}><td>{l}</td>{cols.map((x) => { const y = get(x, k); return <td key={x.c + x.d}>{y ? <Sourced className="num" src={() => src(x, k, l)}>{showV(k, y.v)}</Sourced> : <span className="muted">–</span>}</td>; })}</tr>)}</tbody>
        </table></div>
      )}
      <div className="src">עם הוראות מעבר, כפי שהודפס · רובד 1 כולל רובד 1 נוסף · {SRC}</div>
    </Panel>
  );
}

function Sens({ D, rows, hist, name }: { D: SolvFile; rows: SolvSens[]; hist: boolean; name: (id: string) => string }) {
  const { cols, risks } = useMemo(() => {
    const last = new Map<string, string>();
    rows.forEach((r) => { if ((last.get(r.c) ?? '') < r.d) last.set(r.c, r.d); });
    const use = hist ? rows : rows.filter((r) => last.get(r.c) === r.d);
    const cs: Col[] = [...new Set(use.map((r) => `${r.c}|${r.d}`))].map((k) => { const [c, d] = k.split('|'); return { c, d }; }).sort((a, b) => (hist ? a.d.localeCompare(b.d) : 0)).slice(hist ? -5 : 0);
    const keyOf = (r: SolvSens) => `${r.risk}|${dirOf(r.l)}`;
    const ks = [...new Set(use.map(keyOf))].sort((a, b) => Object.keys(RISK_HE).indexOf(a.split('|')[0]) - Object.keys(RISK_HE).indexOf(b.split('|')[0]) || a.localeCompare(b));
    return { cols: cs, risks: ks.map((k) => ({ k, rows: use.filter((r) => keyOf(r) === k) })) };
  }, [rows, hist]);
  const sign = (v: number) => `${v > 0 ? '+' : ''}${v}`;
  return (
    <Panel title="רגישות יחס כושר הפירעון" aside={<span>נקודות אחוז · כפי שהודפס</span>}>
      {!cols.length ? <Empty title="לא הודפסה טבלת רגישות" /> : (
        <div className="scroll"><table className="tight sv-t">
          <thead><tr><th>תרחיש</th>{cols.map((x) => <th key={x.c + x.d}>{colLab(x, hist, name)}</th>)}</tr></thead>
          <tbody>{risks.map(({ k, rows: rs }) => (
            <tr key={k}><td>{RISK_HE[k.split('|')[0]]}{k.split('|')[1] && ` · ${k.split('|')[1]}`}<small className="muted sv-sc">{rs[rs.length - 1]?.l}</small></td>
              {cols.map((x) => { const mine = rs.filter((r) => r.c === x.c && r.d === x.d).sort((a, b) => a.b.localeCompare(b.b));
                return <td key={x.c + x.d}>{mine.length ? mine.map((r, j) => <span key={j}>{j > 0 && <span className="muted"> · </span>}<Sourced className="num" src={() => solvProv(D, r, `רגישות: ${r.l} · ${name(r.c)} · ${dLab(r.d)}`, r.d, 'נקודות אחוז', sign(r.v), r.b === 'wo' ? 'ללא הוראות מעבר' : r.b === 'w' ? 'עם הוראות מעבר' : '')}>{sign(r.v)}</Sourced>{r.b === 'wo' && <small className="muted"> ללא</small>}</span>) : <span className="muted">–</span>}</td>; })}
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="src">השפעה על היחס בנקודות אחוז, לפי נוסח התרחיש בכל דוח (בלחיצה); תרחישים שונים בין חברות אינם בני השוואה מלאה · {SRC}</div>
    </Panel>
  );
}
