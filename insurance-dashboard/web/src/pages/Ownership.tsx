import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, type Column } from '../components/DataTable';
import { Sheet } from '../components/Sheet';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { nf, pubLabel } from '../lib/format';
import { idCss } from '../lib/identity';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { cellProv, CHANNEL_HE, monthLabel, pctTxt, TYPE_HE, type Cell, type IndexRow, type OwnIndex } from './ownershipData';
import '../styles/ownership.css';

/** heat 0..1: square root, so a 1% holding still reads next to a 40% one; 12% and above is full */
const heat = (v: number | null) => (v == null || v <= 0 ? 0 : Math.min(1, Math.sqrt(v / 12)));

/** Who owns whom: the cross-holdings of the 17 groups (MAYA interested parties + mutual-fund holdings), and each listed group's holders. */
export function Ownership() {
  const { data, error } = useLoad<OwnIndex>('ownership/index.json');
  const [sp, setSp] = useSearchParams();
  const phone = usePhone();
  const [self, setSelf] = useState(false);
  const sel = sp.get('cell');  // "holder~company"
  const pick = (x: Cell | null) => setSp((p) => { const q = new URLSearchParams(p); if (x) q.set('cell', `${x.h}~${x.c}`); else q.delete('cell'); return q; }, { replace: true });

  const byKey = useMemo(() => new Map((data?.matrix.cells ?? []).map((x) => [`${x.h}~${x.c}`, x])), [data]);
  const cur = sel ? byKey.get(sel) ?? null : null;
  const entity = (id: string) => data?.companies.find((r) => r.id === id)?.entity ?? id;

  if (error) return <ErrorBox what="נתוני הבעלות" error={error} />;
  if (!data) return <Loading what="נתוני בעלות" />;
  const { names, matrix } = data;
  const rows = matrix.rows.filter((h) => matrix.cells.some((x) => x.h === h && (self || !x.self)));
  const colTotal = (c: string) => matrix.cells.filter((x) => x.c === c && !x.self).reduce((s, x) => s + (x.pct ?? 0), 0);
  const rowTotal = (h: string) => matrix.cells.filter((x) => x.h === h && !x.self).reduce((s, x) => s + (x.pct ?? 0), 0);
  const asof = data.companies.map((r) => r.asof).filter(Boolean).sort().pop();
  const fundMonth = data.companies.map((r) => r.funds_month).filter(Boolean).sort().pop();

  const detail = cur && <CellDetail x={cur} names={names} entity={entity(cur.c)} />;
  return (
    <div className="own">
      <div className="pagehead">
        <div>
          <h1>בעלות</h1>
          <div className="sub">
            <span>מי מחזיק במי בין 17 הקבוצות</span>
            {asof && <span className="chip">בעלי עניין: {pubLabel(asof)}</span>}
            {fundMonth && <span className="chip">קרנות: {monthLabel(fundMonth)}</span>}
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="hd">
          <h2>החזקות צולבות</h2>
          <div className="aside">
            <label className="own-tg"><input type="checkbox" checked={self} onChange={(e) => setSelf(e.target.checked)} /> כולל החזקה בתוך הקבוצה</label>
          </div>
        </div>
        <p className="own-lead">שורה: הקבוצה המחזיקה (ביטוח, גמל, פנסיה, קרנות) · עמודה: החברה המוחזקת · % מההון</p>
        <div className={`own-mx-wrap${cur && !phone ? ' with' : ''}`}>
          <div className="scroll own-mx-scroll">
            <table className="own-mx" aria-label="החזקות צולבות בין הקבוצות, אחוז מההון">
              <thead>
                <tr>
                  <th className="own-corner" scope="col"><span>מחזיקה ↓ · מוחזקת ←</span></th>
                  {matrix.cols.map((c) => (
                    <th key={c} scope="col" className="own-col" style={{ ['--id' as string]: idCss(c) }}>
                      <Link to={`/ownership/${c}`} title={`בעלי המניות של ${names[c] ?? c}`}>{names[c] ?? c}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h}>
                    <th scope="row" className="own-row"><span className="own-dot" style={{ background: idCss(h) }} />{names[h] ?? h}<small className="num">{rowTotal(h) ? nf(rowTotal(h), 1) : ''}</small></th>
                    {matrix.cols.map((c) => {
                      const x = byKey.get(`${h}~${c}`);
                      if (!x || (x.self && !self)) return <td key={c} className={h === c ? 'own-diag' : ''} />;
                      const k = heat(x.pct), on = cur === x;
                      return (
                        <td key={c} className={`own-cell${x.basis === 'funds' ? ' fo' : ''}${x.self ? ' slf' : ''}${on ? ' on' : ''}`}>
                          <button type="button" style={{ ['--k' as string]: String(k) }} className={k > 0.55 ? 'ink' : ''} onClick={() => pick(on ? null : x)}
                            aria-pressed={on} aria-label={`${names[h] ?? h} ב${names[c] ?? c}: ${pctTxt(x.pct)}${x.basis === 'funds' ? ', קרנות בלבד' : ''}`}>
                            <span className="num">{x.pct == null ? '–' : nf(x.pct, x.pct < 1 ? 2 : 1)}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="own-row own-tot">סך מ-17 הקבוצות</th>
                  {matrix.cols.map((c) => <td key={c} className="own-tot num">{colTotal(c) ? nf(colTotal(c), 1) : '–'}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          {!phone && <aside className="own-side" aria-live="polite">{detail ?? <p className="muted">בחרו תא לפירוט: מי מחזיק, באיזה ערוץ, נכון לאיזה תאריך, ומקור.</p>}</aside>}
        </div>
        <div className="own-legend">
          <span><i className="sw ip" /> בעל עניין: כל הערוצים, לפי הבורסה</span>
          <span><i className="sw fo" /> קרנות נאמנות וסל בלבד (מתחת לסף בעל עניין)</span>
          <span className="muted">גמל, פנסיה ונוסטרו מתחת ל-5% אינם מדווחים לפי חברה</span>
        </div>
      </section>
      {phone && <Sheet open={!!cur} onClose={() => pick(null)} title="פירוט החזקה">{detail}</Sheet>}

      <section className="panel">
        <div className="hd"><h2>בעלי המניות לפי חברה</h2><div className="aside">לחצו על חברה לבעלי המניות לאורך זמן</div></div>
        <CompaniesTable rows={data.companies.filter((r) => r.listed)} names={names} phone={phone} />
      </section>

      <Disclaimers d={data.disclaimers} source={data.source} built={data.built} />
    </div>
  );
}

function CellDetail({ x, names, entity }: { x: Cell; names: Record<string, string>; entity: string }) {
  return (
    <div className="own-det">
      <div className="own-det-hd">
        <span className="own-dot" style={{ background: idCss(x.h) }} /><b>{names[x.h] ?? x.h}</b><span className="muted">מחזיקה ב</span>
        <span className="own-dot" style={{ background: idCss(x.c) }} /><b>{names[x.c] ?? x.c}</b>
      </div>
      <div className="own-det-v">
        <Sourced src={() => cellProv(names, x, entity)} href={x.src}>{pctTxt(x.pct, x.basis === 'funds' ? 2 : 2)}</Sourced>
        <span className="muted">מההון · {x.basis === 'ip' ? `בעל עניין, יתרות עד ${pubLabel(x.date)}` : `קרנות נאמנות וסל, דוח ${monthLabel(x.date)}`}</span>
      </div>
      {x.self && <p className="chip est">החזקה בתוך הקבוצה</p>}
      <ul className="own-parts">
        {x.parts.map((p, i) => (
          <li key={i}>
            <span className="own-pn">{p.name ?? '—'}<small>{p.channel ? CHANNEL_HE[p.channel] : ''}{x.basis === 'funds' && p.funds ? ` · ${p.funds} קרנות` : ''}</small></span>
            <span className="num own-pv">{pctTxt(p.cap, x.basis === 'funds' ? 3 : 2)}</span>
            {x.basis === 'ip' && <span className="num own-pd">{pubLabel(p.date)}</span>}
          </li>
        ))}
      </ul>
      <div className="own-det-go">
        <Link className="btn" to={`/ownership/${x.c}`}>כל בעלי המניות של {names[x.c] ?? x.c}</Link>
        <a className="own-src" href={x.src} target="_blank" rel="noreferrer">{x.basis === 'ip' ? 'בעלי עניין במאיה' : 'קרנות מחזיקות במאיה'} ↗</a>
      </div>
    </div>
  );
}

function CompaniesTable({ rows, names, phone }: { rows: IndexRow[]; names: Record<string, string>; phone: boolean }) {
  const cols: Column<IndexRow>[] = [
    { key: 'co', head: 'חברה', value: (r) => names[r.id] ?? r.id, cell: (r) => <Link className="own-co" to={`/ownership/${r.id}`}><span className="own-dot" style={{ background: idCss(r.id) }} />{names[r.id] ?? r.id}{r.parent_note && <small className="muted"> · אטראו</small>}</Link> },
    { key: 'ctl', head: 'שליטה', title: 'סך בעלי השליטה, % מההון', value: (r) => r.controlling, unit: 'pct', d: 1 },
    { key: 'ins', head: 'מוסדיים', title: 'מוסדיים וקרנות גידור שהם בעלי עניין, % מההון', value: (r) => r.institutional, unit: 'pct', d: 1 },
    { key: 'pub', head: 'ציבור', value: (r) => r.public, unit: 'pct', d: 1 },
    ...(phone ? [] : [
      { key: 'top', head: 'המחזיק הגדול', value: (r: IndexRow) => r.top?.name ?? null, cell: (r: IndexRow) => r.top ? <span>{r.top.name} <span className="num muted">{pctTxt(r.top.cap, 1)}</span> <small className="muted">{TYPE_HE[r.top.type]}</small></span> : '–' },
      { key: 'fnd', head: 'קרנות', title: 'קרנות נאמנות וסל, % מההון (דוח חודשי)', value: (r: IndexRow) => r.funds_pct, unit: 'pct' as const, d: 1 },
      { key: 'q', head: 'רבעונים', title: 'דוחות מצבת החזקות (ת077) בהיסטוריה', value: (r: IndexRow) => r.quarters, unit: 'int' as const },
    ]),
    { key: 'asof', head: 'נכון ל', value: (r) => r.asof, cell: (r) => <span className="num muted">{pubLabel(r.asof)}</span> },
  ];
  if (!rows.length) return <Empty title="אין נתוני בעלות" />;
  return <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} sort={{ key: 'ctl', dir: 'desc' }} caption="בעלי המניות לפי חברה"
    export={{ name: 'fox-ownership', title: 'בעלות · בעלי המניות לפי חברה', note: 'MAYA, בעלי עניין והתפלגות החזקות' }} />;
}

export function Disclaimers({ d, source, built }: { d: OwnIndex['disclaimers']; source: string; built: string }) {
  return (
    <footer className="own-foot">
      <p><b>מקור:</b> {source}. נבנה {pubLabel(built)}.</p>
      <details>
        <summary>הצהרה משפטית של הבורסה</summary>
        <p><b>בעלי עניין:</b> {d.ip}</p>
        <p><b>החזקות קרנות:</b> {d.funds} <a href={d.terms} target="_blank" rel="noreferrer">הסכם השימוש</a></p>
      </details>
    </footer>
  );
}
