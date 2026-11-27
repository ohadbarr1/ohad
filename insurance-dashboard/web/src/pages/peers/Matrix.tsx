import { useMemo, useState } from 'react';
import { Sourced } from '../../components/Source';
import { idCss } from '../../lib/identity';
import { basisShort, BBY, boardMetrics, boardRows, defRead, fmtRead, medianProv, pairRead, shOf, unitRead, type BMetric, type BoardOut } from '../../lib/peerBoard';
import { toneOf } from '../../lib/peerWords';
import { isChg, qlab, type QRead } from '../../lib/quarters';
import { ctxOf, type BoardData } from './BoardLens';
import '../../styles/peerboard.css';

/* "הקבוצה במבט אחד" (spec p6 §3.5, §13.1, §14.1 N7): companies × a section's metrics, desktop only, beside the board. Every cell is the
   board's own figure (lib/peerBoard boardRows: the same carry rule, the star, the "†"), drawn through <Sourced>; the median row carries
   its n and opens its parts. A column head selects the metric and its reading for the board and sorts (first click: best first, so the
   cheapest first on a multiple; tester B15); a company's name opens the company sheet. Quartile heat by place (n ≥ 3, metrics with a
   direction). A section has at most twelve columns; more than eleven are set dense; no sideways scroll at 1280 or 1440. */

export type SecId = 'mix' | 'mkt' | 'biz' | 'sav' | 'ins';
export const SECS: [SecId, string][] = [['mix', 'עיקרי'], ['mkt', 'המניה'], ['biz', 'העסק'], ['sav', 'חיסכון'], ['ins', 'ביטוח']];
const LEVELS: Record<SecId, string[]> = {
  mix: ['mcap', 'pe', 'pb', 'pbc', 'maum', 'dy', 'tr', 'np', 'roe', 'isrm', 'nm', 'csm', 'csmeq', 'aum', 'sr'],
  mkt: ['mcap', 'pe', 'pb', 'pbc', 'maum', 'dy', 'tr'],
  biz: ['np', 'roe', 'rev', 'isrm', 'nm', 'csm', 'csmeq', 'aum', 'eq', 'sr', 'nbrel'],
  sav: ['oaum', 'oshare', 'odep', 'otr', 'onet', 'onetr', 'owdr', 'pout'],
  ins: ['rlife', 'rhealth', 'rpc', 'mhealth', 'mpc', 'gpc'],
};
const MAX = 12;
/** a section's columns: its levels the set has, then the paired change after each level while the section stays at twelve columns or fewer
 *  (the YoY beside an LTM level is LTM against LTM; beside a balance, quarter end against quarter end: 14.3 rule 2) */
export function secCols(sec: SecId, has: (k: string) => boolean): [BMetric, QRead][] {
  const lv = LEVELS[sec].filter(has).map((k) => BBY.get(k)!).slice(0, MAX);
  const out: [BMetric, QRead][] = lv.map((m) => [m, defRead(m)]);
  if (sec === 'mix') return out;
  for (const m of lv) {
    const pr = pairRead(m);
    if (!pr || out.length >= MAX) continue;
    const i = out.findIndex(([x]) => x === m);
    out.splice(i + 1, 0, [m, pr]);
  }
  return out;
}

export function Matrix({ d, onCo }: { d: BoardData; onCo: (e: string) => void }) {
  const { book } = d;
  const sec = (SECS.find(([s]) => s === d.get('sec'))?.[0] ?? 'mix') as SecId;
  const avail = useMemo(() => new Set(boardMetrics(d.ents.map(d.kindOf)).map((m) => m.key)), [d]);
  const cols = useMemo(() => secCols(sec, (k) => avail.has(k)), [sec, avail]);
  const ctx = useMemo(() => ctxOf(d), [d]);
  const B: BoardOut[] = useMemo(() => cols.map(([m, r]) => boardRows(ctx, m, r)), [cols, ctx]);
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const si = sort && sort.i < cols.length ? sort : null;
  const order = [...d.order];
  if (si) {
    const b = B[si.i];
    const v = (e: string) => { const r = b.rows.find((x) => x.e === e); return r && !r.out && r.v != null && Number.isFinite(r.v) ? r.v : null; };
    order.sort((a, c) => { const x = v(a), y = v(c); return x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * si.dir; });
  }
  const name = (e: string) => book.short(e);
  const pick = (i: number) => {
    const [m, r] = cols[i], best: 1 | -1 = m.better === 'lo' ? 1 : -1;
    setSort(si?.i === i ? { i, dir: (si.dir * -1) as 1 | -1 } : { i, dir: best });
    d.put('bm', m.key);
    d.put('rd', r === defRead(m) ? null : r);
  };
  const dense = cols.length > 11;
  return (
    <section className="panel p6-mx" aria-label="הקבוצה במבט אחד">
      <div className="p6-mx-hd">
        <h2>הקבוצה במבט אחד <small>· כותרת: בוחרת מדד וממיינת · שם: מול הקבוצה · מספר: המקור</small></h2>
        <div className="p6-seg" id="sec-seg" role="group" aria-label="קבוצת מדדים">
          {SECS.filter(([s]) => s === 'mix' || secCols(s, (k) => avail.has(k)).length).map(([s, l]) => (
            <button key={s} type="button" aria-pressed={s === sec} onClick={() => { setSort(null); d.put('sec', s === 'mix' ? null : s); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="p6-mx-w">
        <table className={`p6-mxt${dense ? ' dense' : ''}`} id="matrix" data-cols={cols.length} data-sec={sec}>
          <thead>
            <tr>
              <th className="ent" scope="col">חברה</th>
              {cols.map(([m, r], i) => {
                const sel = m.key === d.bm && r === d.rd;
                return (
                  <th key={`${m.key}.${r}`} scope="col" className={sel ? 'sel' : undefined} data-m={m.key} data-rd={r} aria-sort={si?.i === i ? (si.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" title={m.l} onClick={() => pick(i)}>
                      <span>{shOf(m)}{isChg(r) ? ' YoY' : ''}{si?.i === i ? (si.dir > 0 ? ' ▲' : ' ▼') : ''}</span>
                      <small>{isChg(r) ? basisShort(m, r, d.q) : `${unitRead(m, r)}${m.type === 'flow' || (m.type === 'ratio' && r === 'ltm') ? ' · LTM' : m.type === 'ret' ? ' · 12M' : ''}`}</small>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {order.map((e) => (
              <tr key={e} data-e={e} className={e === d.focus ? 'focus' : undefined}>
                <th scope="row" className="ent"><button type="button" className="p6-ent" onClick={() => onCo(e)} aria-haspopup="dialog" title="מול הקבוצה"><i className="sq" style={{ background: idCss(e) }} />{name(e)}</button></th>
                {cols.map(([m, r], i) => {
                  const b = B[i], x = b.rows.find((y) => y.e === e)!, n = b.n, has = x.v != null && Number.isFinite(x.v);
                  const pc = has && !x.out && x.place != null && n > 1 ? 1 - (x.place - 1) / (n - 1) : null;
                  const band = pc == null || n < 3 || !m.better ? '' : pc >= 0.75 ? 'q4' : pc >= 0.5 ? 'q3' : pc > 0.25 ? 'q2' : 'q1';
                  const sel = m.key === d.bm && r === d.rd;
                  const cls = [band, sel ? 'sel' : '', x.out ? 'outc' : ''].filter(Boolean).join(' ') || undefined;
                  const tone = isChg(r) || m.u === 'pctx' ? toneOf(x.v) : null;
                  const title = x.out ? `${qlab(x.q)} · טרם דיווחה: לא בדירוג ולא בחציון` : x.stale ? `טרם דווח על ${qlab(d.q)}: ${qlab(x.q)}` : undefined;
                  return (
                    <td key={`${m.key}.${r}`} className={cls}>
                      {has ? <Sourced className={`num${tone ? ` ${tone}` : ''}${x.stale ? ' st' : ''}`} src={x.val.prov} title={title}>{fmtRead(m, r, x.v!)}{x.dag ? '†' : ''}{x.stale ? '*' : ''}</Sourced>
                        : <span className="mut" title={x.val.why ?? 'אין נתון'}>–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="ent">חציון<sup className="p6-n">n</sup></th>
              {cols.map(([m, r], i) => {
                const b = B[i];
                return <td key={`${m.key}.${r}`} data-n={b.med.n}>{b.med.v == null || b.med.n < 2 ? <span className="mut">–</span>
                  : <><Sourced className="num" src={() => medianProv(b, name)}>{fmtRead(m, r, b.med.v)}</Sourced><sup className="p6-n">{b.med.n}</sup></>}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
