import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { Spark } from '../components/Spark';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { nf, pubLabel, sn } from '../lib/format';
import { idCss } from '../lib/identity';
import { usePhone } from '../lib/useMedia';
import {
  SEG_HE, SIG_ORDER, ST_HE, UNIT_OF, evaluate, headline, isData, pctProv, pctText, readParams, ruleText, trendText,
  type Cell, type FragFile, type Row, type Seg as FSeg, type SegId, type SigDef, type SigId,
} from '../lib/fragility';
import { fprov, useFragility, warmProv } from '../lib/fragilityLoad';
import '../styles/fragility.css';

/* A10 · /fragility, the Fragility Monitor: managers × seven signals, each cell a state chip, its figure, a sparkline and the peer
   percentile; the detail of a cell states its rule, its inputs and every segment, each figure opening its source. No composite: a
   manager's status is the list of its signals in watch / alert. The thresholds are labelled assumptions, overridable in the URL.
   Not a navigation item: reached from /savings, /scenarios, search and the company homes. */

type Kind = 'all' | 'ins' | 'house';
const KIND_HE: Record<Row['kind'], string> = { insurance_group: 'ביטוח', fund_house: 'בית השקעות' };

function StChip({ st, small }: { st: Cell['st']; small?: boolean }) {
  return <span className={`fr-st st-${st}${small ? ' sm' : ''}`}><i aria-hidden="true" />{ST_HE[st]}</span>;
}

/** one cell of the grid: the state (selects the detail), the figure (opens its source), the run behind it, the percentile */
function GridCell({ F, rows, r, s, on, pick }: { F: FragFile; rows: Row[]; r: Row; s: SigDef; on: boolean; pick: () => void }) {
  const c = r.sig[s.id], x = c.seg ? c.segs[c.seg] : undefined;
  const label = `${r.name} · ${s.he}: ${ST_HE[c.st]}${x ? `, ${headline(s.id, x)}` : ''}`;
  return (
    <div className={`fr-c st-${c.st}${on ? ' on' : ''}`}>
      <button type="button" className="fr-pick" aria-pressed={on} aria-label={label} onClick={pick}><StChip st={c.st} small /></button>
      {x && isData(c.st) ? (
        <>
          <span className="fr-v"><Sourced src={() => fprov(x.prov!)}>{headline(s.id, x)}</Sourced>{c.seg && SEG_HE[c.seg] && <small>{c.seg === 'gem' ? 'גמל' : SEG_HE[c.seg].split(' ')[0]}</small>}</span>
          <span className="fr-sp"><Spark data={(x.ser ?? []).map((p) => p[1])} w={64} h={18} /></span>
          {pctText(x) && <Sourced className="fr-p" src={() => pctProv(F, s, c.seg as SegId, rows, r.c)}>{pctText(x)!}</Sourced>}
        </>
      ) : <span className="fr-why">{c.stale ? 'ישן' : c.st === 'na' ? '' : 'חסר'}</span>}
    </div>
  );
}

function Flags({ r }: { r: Row }) {
  if (!r.flags.length) return <span className="muted">ללא אותות</span>;
  return <span className="fr-flags">{r.flags.map((f) => <span key={f.sig} className={`fr-flag st-${f.st}`}>{SIG_SHORT[f.sig]}</span>)}</span>;
}
const SIG_SHORT: Record<SigId, string> = { flow: 'ניוד', fee: 'דמי ניהול', perf: 'ביצועים', cost: 'עלויות', solv: 'כושר פירעון', csm: 'CSM', scen: 'תרחיש' };

/** the detail of one manager × signal: the rule, the segments, every figure with its source, the state history */
function Detail({ F, rows, r, s, p }: { F: FragFile; rows: Row[]; r: Row; s: SigDef; p: Record<string, number> }) {
  const c = r.sig[s.id];
  const segs = Object.entries(c.segs) as [SegId, FSeg][];
  useEffect(() => { warmProv(c.segs); }, [c]);
  const extra = (k: SegId, x: FSeg) => {
    const out: JSX.Element[] = [];
    if (s.id === 'flow' && x.lens) out.push(<span key="l">{x.lens.q}: העברות נטו <Sourced src={() => fprov(x.lens!.prov)}>{x.lens.tr == null ? '–' : `${sn(x.lens.tr / 1000, 2)}`}</Sourced> מיליארד ש"ח{x.lens.fs != null && <>, נתח מהצבירה נטו <span className="num">{`${nf(x.lens.fs, 1)}%`}</span></>}</span>);
    if (s.id === 'flow' && x.provA && x.x?.a0 != null) out.push(<span key="a">נכסים בתחילת החלון <Sourced src={() => fprov(x.provA!)}>{nf((x.x.a0 as number) / 1000, 1)}</Sourced> מיליארד · <span className="num">{nf(((x.x.v3 as number) / (x.x.a0 as number)) * 100, 2)}%</span> מהנכסים · <span className="num">{String(x.x.run)}</span> חלונות 3M שליליים ברצף</span>);
    if (s.id === 'fee' && x.provM) out.push(<span key="m">חציון השינוי אצל העמיתים <Sourced src={() => fprov(x.provM!)}>{`${sn(x.x?.med as number, 1)} נ״ב`}</Sourced>; פער <span className="num">{x.x?.rel == null ? '–' : `${sn(x.x.rel as number, 1)} נ״ב`}</span></span>);
    if (s.id === 'perf' && x.own != null) out.push(<span key="o">שארפ 3Y משוקלל <span className="num">{nf(x.own, 2)}</span> מול חציון עמיתים משוקלל <span className="num">{nf(x.peer!, 2)}</span> · <span className="num">{x.nt}</span> מסלולים</span>);
    if (s.id === 'cost' && x.q != null) out.push(<span key="q">הרבעון האחרון: <span className="num">{`${nf(x.q, 1)}%`}</span></span>);
    if (s.id === 'solv' && x.target) out.push(<span key="t">{x.target.label} {x.target.period}: <span className="num">{`${nf(x.target.v, x.target.v % 1 ? 1 : 0)}%`}</span> · מרווח <Sourced src={() => fprov(x.prov!)}>{`${sn(x.x?.h as number, 1)} נ״א`}</Sourced>{x.target.est && <> · <span className="chip est">{x.target.est}</span></>}</span>);
    if (s.id === 'csm' && x.C != null) out.push(<span key="c">CSM ברוטו <span className="num">{nf(x.C, 0)}</span> ÷ שחרור <span className="num">{nf(x.R!, 0)}</span> מיליוני ש"ח</span>);
    if (s.id === 'scen' && x.pre) out.push(<span key="p" className="fr-pre">{x.pre.map((q) => <span key={q.id} className={q.id === x.worst ? 'w' : ''}>{q.he} <span className="num">{q.v == null ? '–' : sn(q.v, 1)}</span></span>)}{x.lines && <span className="dim">רגישויות ליום {pubLabel(x.lines)}</span>}</span>);
    void k;
    return out;
  };
  return (
    <Panel className="fr-detail" title={<><Link to={`/company/${r.c}`}>{r.name}</Link> · {s.he}</>} aside={<StChip st={c.st} />}>
      <div className="fr-rule">
        <div><span className="fr-st st-watch sm"><i aria-hidden="true" />מעקב</span>{ruleText(s.rule.watch, p)}</div>
        <div><span className="fr-st st-alert sm"><i aria-hidden="true" />התראה</span>{ruleText(s.rule.alert, p)}</div>
        <div className="dim"><span className="chip est">הנחה</span> הספים הם הנחות של fox, לא תקן; ניתנים לשינוי למטה. מקור: {s.src}</div>
      </div>
      {!isData(c.st) && c.why && <p className="fr-nod" role="note">{ST_HE[c.st]}: {c.why}</p>}
      <div className="fr-segs" role="table" aria-label={`${r.name} · ${s.he} לפי מגזר`}>
        <div className="fr-sr hd" role="row"><span role="columnheader">מגזר</span><span role="columnheader">מצב</span><span role="columnheader">{s.metric}</span><span role="columnheader">מגמה</span><span role="columnheader">מיקום</span><span role="columnheader">נכון ל</span></div>
        {segs.map(([k, x]) => (
          <div key={k} className={`fr-sr${k === c.seg ? ' drv' : ''}`} role="row">
            <span role="cell">{SEG_HE[k] || 'החברה'}</span>
            <span role="cell"><StChip st={x.st} small /></span>
            {isData(x.st) ? (
              <>
                <span role="cell"><Sourced src={() => fprov(x.prov!)}>{headline(s.id, x)}</Sourced> <small className="dim">{UNIT_OF[s.id]}</small></span>
                <span role="cell">{x.provT ? <Sourced src={() => fprov(x.provT!)}>{trendText(s.id, x)}</Sourced> : s.id === 'flow' && x.provP ? <Sourced src={() => fprov(x.provP!)}>{trendText(s.id, x)}</Sourced> : <span>{trendText(s.id, x)}</span>} <Spark data={(x.ser ?? []).map((q) => q[1])} w={72} h={20} /></span>
                <span role="cell">{pctText(x) ? <Sourced src={() => pctProv(F, s, k, rows, r.c)}>{pctText(x)!}</Sourced> : '–'}{x.n ? <small className="dim"> מתוך {x.n}</small> : null}</span>
                <span role="cell" className="num">{x.asof}</span>
              </>
            ) : <span role="cell" className="fr-why2">{x.why}</span>}
            {isData(x.st) && extra(k, x).length > 0 && <div className="fr-ex" role="cell">{extra(k, x)}</div>}
            {isData(x.st) && x.h && x.h.length > 1 && <div className="fr-hist" role="cell" aria-label="מצב לפי תקופה">{x.h.slice(-12).map((h) => <span key={h[0]} className={`st-${h[2]}`} title={`${h[0]}: ${ST_HE[h[2]]}`}><i aria-hidden="true" /><small>{histLabel(s.id, h[0])}</small></span>)}</div>}
          </div>
        ))}
      </div>
      <p className="fr-links"><Link to={`/feed?co=${r.c}&t=fragility`}>האירועים בפיד</Link>{s.id === 'scen' && <Link to="/scenarios">חדר התרחישים</Link>}{(s.id === 'flow' || s.id === 'fee' || s.id === 'cost') && <Link to={`/savings?g=${encodeURIComponent(r.name)}`}>עדשת החיסכון</Link>}{s.id === 'perf' && <Link to="/funds">המסלולים</Link>}{(s.id === 'solv' || s.id === 'csm') && <Link to={`/company/${r.c}/ifrs17`}>IFRS 17 · הון</Link>}</p>
    </Panel>
  );
}
const histLabel = (sig: SigId, k: string) => (sig === 'flow' || sig === 'perf' ? `${k.slice(4)}/${k.slice(2, 4)}` : sig === 'solv' ? `${k.slice(5, 7)}/${k.slice(2, 4)}` : k.endsWith('FY') ? `FY'${k.slice(2, 4)}` : `${k.slice(4)}'${k.slice(2, 4)}`);

/** the thresholds: every one a labelled assumption; a change goes into the URL (and a shared link carries it) */
function Params({ F, p, changed, set, reset }: { F: FragFile; p: Record<string, number>; changed: string[]; set: (k: string, v: string) => void; reset: () => void }) {
  return (
    <details className="fr-params" open={changed.length > 0}>
      <summary>ספים <span className="chip est">הנחות</span>{changed.length > 0 && <span className="chip">{nf(changed.length, 0)} שונו</span>}</summary>
      <div className="fr-pgrid">
        {SIG_ORDER.map((sid) => {
          const ks = Object.entries(F.params).filter(([, d]) => d.sig === sid);
          return (
            <fieldset key={sid}><legend>{F.sigs.find((x) => x.id === sid)!.he}</legend>
              {ks.map(([k, d]) => (
                <label key={k} className={changed.includes(k) ? 'chg' : ''}><span>{d.he}</span>
                  <input type="number" inputMode="decimal" step={d.v % 1 ? 0.05 : 1} value={p[k]} onChange={(e) => set(k, e.target.value)} aria-label={`${d.he} (${d.u})`} /><small>{d.u}{changed.includes(k) && <> · ברירת מחדל {nf(d.v, d.v % 1 ? 2 : 0)}</>}</small></label>
              ))}
            </fieldset>
          );
        })}
      </div>
      {changed.length > 0 && <button type="button" className="btn" onClick={reset}>חזרה לספים של fox</button>}
    </details>
  );
}

export function Fragility() {
  const { data: F, error } = useFragility();
  const [sp, setSp] = useSearchParams();
  const phone = usePhone();
  const detailRef = useRef<HTMLDivElement>(null);
  const kind = ((['all', 'ins', 'house'] as const).find((k) => k === sp.get('k')) ?? 'all') as Kind;
  const only = sp.get('f') === '1';
  const { p, changed } = useMemo(() => (F ? readParams(F, sp) : { p: {}, changed: [] as string[] }), [F, sp]);
  const rows = useMemo(() => (F ? evaluate(F, p) : []), [F, p]);
  const selC = sp.get('c'), selS = (SIG_ORDER.find((s) => s === sp.get('s')) ?? null) as SigId | null;
  const setParam = (k: string, v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v == null || v === '') n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const pick = (c: string, s: SigId) => { setSp((prev) => { const n = new URLSearchParams(prev); if (n.get('c') === c && n.get('s') === s) { n.delete('s'); } else { n.set('c', c); n.set('s', s); } return n; }, { replace: true }); };
  const firstPick = useRef(true);
  useEffect(() => { if (selC && selS && !firstPick.current) detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); firstPick.current = false; }, [selC, selS]);

  if (error) return <ErrorBox what="מוניטור השבריריות" error={error} />;
  if (!F) return <Loading what="מוניטור השבריריות" />;
  if (!F.rows.length) return <Empty title="אין מנהלים עם נתונים" />;
  const shown = rows.filter((r) => (kind === 'all' || (kind === 'ins') === (r.kind === 'insurance_group')) && (!only || r.flags.length > 0));
  const sigs = SIG_ORDER.map((id) => F.sigs.find((s) => s.id === id)!);
  const selRow = rows.find((r) => r.c === selC);
  const nAlert = rows.filter((r) => r.flags.some((f) => f.st === 'alert')).length, nWatch = rows.filter((r) => r.flags.length && !r.flags.some((f) => f.st === 'alert')).length;
  const setP = (k: string, v: string) => setParam(k, v === '' || Number(v) === F.params[k].v ? null : v);
  const reset = () => setSp((prev) => { const n = new URLSearchParams(prev); Object.keys(F.params).forEach((k) => n.delete(k)); return n; }, { replace: true });
  const detail = selRow && selS ? <div ref={detailRef}><Detail F={F} rows={rows} r={selRow} s={F.sigs.find((x) => x.id === selS)!} p={p} /></div> : null;

  return (
    <div className="fr">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="shield" /></span>מוניטור שבריריות</h1>
        <div className="sub"><span><span className="num">{rows.length}</span> מנהלים · <span className="num">7</span> אותות</span><span>·</span><span>אין ציון מצרפי</span><span>·</span>
          <span>רשות <span className="num">{F.asof.reg}</span> · דוחות <span className="num">{F.asof.lens}</span></span><span>·</span>
          <Link to="/scenarios">חדר התרחישים</Link><Link to="/savings">עדשת החיסכון</Link><Link to="/feed?t=fragility">מה השתנה</Link></div>
      </div></div>

      <div className="fr-bar">
        <Seg<Kind> label="סוג מנהל" value={kind} options={[['all', 'הכל'], ['ins', 'מבטחות'], ['house', 'בתי השקעות']]} onChange={(v) => setParam('k', v === 'all' ? null : v)} />
        <button type="button" className={`chip${only ? ' on' : ''}`} aria-pressed={only} onClick={() => setParam('f', only ? null : '1')}>רק עם אותות</button>
        <span className="fr-sum"><span className="fr-flag st-alert">{nf(nAlert, 0)} בהתראה</span><span className="fr-flag st-watch">{nf(nWatch, 0)} במעקב בלבד</span></span>
      </div>
      <Params F={F} p={p} changed={changed} set={setP} reset={reset} />

      {phone ? (
        <ul className="fr-cards">
          {shown.map((r) => (
            <li key={r.c} className="fr-card">
              <div className="fr-ch"><Link to={`/company/${r.c}`}><i className="pdot" style={{ background: idCss(r.c) }} />{r.name}</Link><small className="dim">{KIND_HE[r.kind]}</small><Flags r={r} /></div>
              {sigs.some((s) => r.sig[s.id].st === 'na') && <small className="dim">לא רלוונטי: {sigs.filter((s) => r.sig[s.id].st === 'na').map((s) => s.short).join(', ')}</small>}
              <div className="fr-cg">{sigs.filter((s) => r.sig[s.id].st !== 'na').map((s) => (
                <div key={s.id} className="fr-cgc"><span className="fr-sl">{s.short}</span><GridCell F={F} rows={rows} r={r} s={s} on={selC === r.c && selS === s.id} pick={() => pick(r.c, s.id)} /></div>
              ))}</div>
              {selC === r.c && selS && detail}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="fr-scroll">
            <table className="fr-grid">
              <caption className="sr-only">מוניטור שבריריות: מנהלים מול שבעה אותות; בכל תא מצב, ערך, מגמה ומיקום בין העמיתים</caption>
              <thead><tr><th scope="col">מנהל</th>{sigs.map((s) => <th key={s.id} scope="col" title={s.metric}>{s.he}<small>{s.metric}{UNIT_OF[s.id] ? ` · ${UNIT_OF[s.id]}` : ''}</small></th>)}<th scope="col">אותות</th></tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.c} className={selC === r.c ? 'sel' : ''}>
                  <th scope="row"><Link to={`/company/${r.c}`}><i className="pdot" style={{ background: idCss(r.c) }} />{r.name}</Link><small className="dim">{KIND_HE[r.kind]}</small></th>
                  {sigs.map((s) => <td key={s.id}><GridCell F={F} rows={rows} r={r} s={s} on={selC === r.c && selS === s.id} pick={() => pick(r.c, s.id)} /></td>)}
                  <td><Flags r={r} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {detail}
        </>
      )}
      {!shown.length && <Empty title="אין מנהלים בסינון הזה" />}
      <p className="fr-foot dim">P = מיקום בין המנהלים באותו מוצר (100 = הטוב ביותר). "חסר" = נתון חסר; "ישן" = נתון ישן מהסף (יחס כושר פירעון ישן מ-{nf(F.stale_ratio_m, 0)} חודשים לפני {F.asof.lens}); אף אחד מהם אינו "תקין". לא נכללו: {F.skipped.map((x) => `${F.cos[x.c] ?? x.c} (${x.why})`).join(' · ')}.</p>
    </div>
  );
}
export default Fragility;
