import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BasisToggle, CompareAdd, FundsHead } from '../components/FundsNav';
import { WatchStar, monthsIn } from '../components/FundsTime';
import { MgrChip } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel } from '../components/ui';
import { useFunds } from '../lib/useData';
import type { Prov } from '../lib/prov';
import { nf, sn } from '../lib/format';
import { fundP, monthIn } from '../lib/market';
import { NET_LABEL, NET_NOTE, grossProv, netProv, pc, refOf, useBasis, type FundX, type FundsFile } from '../lib/funds';
import { deltaOf, markSeen, mergeWatch, normWatch, outflowStreak, retBetween, ddNow, toggleWatch, ymL, type WSnap, type WatchStore } from '../lib/fundsTime';
import { snapOf, useClosed, useHists, useWatch, yOf } from '../lib/fundsTimeLoad';
import { today } from '../lib/visits';
import { useActiveDoor } from '../components/home/doorState';
import { useMine } from '../lib/mine';
import { useStored } from '../lib/local';
import '../styles/lens.css';
import '../styles/market.css';
import '../styles/funds-time.css';

/* /funds/watch, "המעקב שלי" (funds plan #23): the tracks this browser follows, and what changed since the last look: the return since then,
   the month's return, the LTM percentile, the fee; flags for a quartile move, the bottom quartile on 3Y, a fall from the peak and three
   months of net outflows. Private: kept in this browser only (localStorage), with a JSON file to take it elsewhere. The look ends when the
   reader leaves the page: the snapshots then become today's.
   W5 saver (red team 3): in the saver door, an empty list with products on /my starts from those products, once (fox:watch:seeded),
   and the month's return gives way to the last 12 months (a one-month move is noise for a saver). Agent and Pro are unchanged. */

const DD_FLAG = -10;
export function FundsWatch() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const [w, setW] = useWatch();
  const [b] = useBasis();
  const [msg, setMsg] = useState<string | null>(null);
  const [door] = useActiveDoor();
  const saver = door !== 'agent' && door !== 'pro';
  const [mine] = useMine();
  const [seeded, setSeeded] = useStored<boolean>('watch:seeded', false);
  useEffect(() => {
    if (!saver || seeded || !data || w.items.length || !Array.isArray(mine) || !mine.length) return;
    let n: WatchStore = w;
    mine.forEach((m) => { const f = data.funds.find((x) => x.k === m.k) as FundX | undefined; if (f) n = toggleWatch(n, f.k, f.name, snapOf(f, data.asof, b), today()); });
    setSeeded(true);
    if (n.items.length) { setW(n); setMsg(`המוצרים שלך מ"המוצרים שלי" נוספו למעקב (${n.items.length}).`); }
  }, [saver, seeded, data, w.items.length, mine]);  // eslint-disable-line react-hooks/exhaustive-deps
  const keys = w.items.map((i) => i.k);
  const missing = data ? keys.filter((k) => !data.funds.some((f) => f.k === k)) : [];
  const closed = useClosed(missing.length > 0);
  const fundOf = (k: string): FundX | undefined => data?.funds.find((f) => f.k === k) ?? closed?.find((f) => f.k === k);
  const hs = useHists(keys);
  const asof = data?.asof ?? 0;
  const now = useMemo(() => { const m = new Map<string, WSnap>(); if (!data) return m; w.items.forEach((i) => { const f = data.funds.find((x) => x.k === i.k); if (f) m.set(i.k, snapOf(f, asof, b)); }); return m; }, [data, w, asof, b]);
  // the look ends when the reader leaves: what was shown becomes the new baseline (the marks stay up while the page is open)
  const ref = useRef({ w, now, asof }); ref.current = { w, now, asof };
  useEffect(() => {
    const mark = () => { if (ref.current.asof) setW(markSeen(ref.current.w, ref.current.now, ref.current.asof)); };
    addEventListener('pagehide', mark);
    return () => { removeEventListener('pagehide', mark); mark(); };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ ...normWatch(w), exported: today(), note: 'רשימת מעקב פרטית: מסלולים וצילום המצב בביקור האחרון' }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `funds-watch-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200_000) { setMsg('הקובץ גדול מדי לרשימת מעקב'); return; }
    file.text().then((t) => { const before = w.items.length, next = mergeWatch(w, JSON.parse(t)); setW(next); setMsg(`נוספו ${next.items.length - before} מסלולים`); }).catch(() => setMsg('הקובץ אינו רשימת מעקב תקינה'));
  };
  const fresh = w.items.filter((i) => now.get(i.k) && i.base && now.get(i.k)!.asof > i.base.asof).length;
  return (
    <>
      <FundsHead title="המעקב שלי" sub={<>מה השתנה במסלולים שבמעקב מאז הביקור הקודם{data ? <> · נתוני <span className="num">{ymL(asof)}</span></> : null} · פרטי לדפדפן הזה</>} tools={<BasisToggle real={false} />} />
      <section className="kpis">
        <div className="kpi"><div className="l">במעקב</div><div className="v num">{w.items.length}</div><div className="s">מסלולים</div></div>
        <div className="kpi"><div className="l">עם חודש חדש</div><div className="v num">{fresh}</div><div className="s">מאז הביקור הקודם</div></div>
        <div className="kpi"><div className="l">בסיס</div><div className="v">{b === 'net' ? NET_LABEL : 'ברוטו'}</div><div className="s">אחוזון ותשואה</div></div>
      </section>
      {!w.items.length ? (
        <Empty title="עוד אין מסלולים במעקב" icon="funds">{saver ? <>מוסיפים מוצרים ב<Link to="/my">המוצרים שלי</Link>, והם יופיעו כאן. </> : null}בכרטיס של כל מסלול, במפה ובאחוזונים יש כפתור ☆ מעקב. הרשימה נשמרת רק בדפדפן הזה, ואפשר לייבא קובץ שיוצא ממכשיר אחר.</Empty>
      ) : !data ? <Loading what="המסלולים שבמעקב" /> : (
        <Panel title={<>מאז הביקור הקודם <Tip k="rank" /></>} aside={<span>הביקור נרשם כשיוצאים מהעמוד</span>}>
          <div className="fwatch">
            {w.items.map((i) => {
              const f = fundOf(i.k), h = hs.h[i.k], cur = now.get(i.k) ?? null, d = deltaOf(i, cur);
              if (!f) return <article key={i.k} className="fw-card"><header><b>{i.name}</b></header><p className="muted">{closed ? 'המסלול אינו בנתוני הרשות.' : 'טוען…'}</p></article>;
              const R = refOf(f), y = h ? yOf(h, b) : null;
              const since = h && i.base && cur && cur.asof > i.base.asof ? retBetween(h.p, y!, i.base.asof, cur.asof) : null;
              const tail = h ? ddNow(y!) : null;
              const out = h ? outflowStreak(h) : 0;
              const flags: [string, string, () => Prov][] = [];
              if (d?.qMove) flags.push([d.qMove[1] < d.qMove[0] ? 'pos' : 'neg', `רבעון LTM: ${d.qMove[0]} → ${d.qMove[1]}`, () => pctP(f, i.base!, cur!)]);
              if (d?.bottom3) flags.push(['neg', 'ברבע התחתון ב-3Y', () => ({ k: 'calc', title: `אחוזון 3Y${b === 'net' ? ', נטו' : ''} · ${f.name}`, value: nf(cur!.pct3!, 0), formula: 'אחוזון בקטגוריה על התשואה השנתית ל-3 שנים, מחושב בבניית הנתונים (funds.json pr/pn). רבע תחתון: מתחת ל-25', inputs: [] })]);
              if (tail?.dd_cur != null && tail.dd_cur <= DD_FLAG) flags.push(['neg', `${nf(tail.dd_cur, 1)}% מתחת לשיא`, () => ({ k: 'calc', est: b === 'net', title: `מתחת לשיא · ${f.name}`, value: pc(tail.dd_cur), formula: 'המרחק של מדד התשואה המצטברת מהשיא הגבוה בהיסטוריה. מסומן מ-10% ומעלה', note: b === 'net' ? NET_NOTE : undefined, inputs: monthsIn(R, h!, h!.p.slice(-Math.max(1, (tail.dd_len ?? 0) + 1)), b) })]);
              if (out >= 3) flags.push(['neg', `${out} חודשי יציאה נטו`, () => ({ k: 'calc', title: `חודשים רצופים של תזרים שלילי · ${f.name}`, value: nf(out, 0), unit: 'חודשים', formula: 'הפקדות − משיכות + העברות נטו < 0, בחודשים האחרונים ברצף (DEPOSITS, WITHDRAWLS, INTERNAL_TRANSFERS)',
                inputs: h!.p.slice(-out).flatMap((p) => (['dep', 'wd', 'tr'] as const).map((c) => monthIn(R, c, p, h![c]?.[h!.p.indexOf(p)] ?? null))) })]);
              if (f.gone) flags.push(['neg', `נסגר${f.end ? ` · ${ymL(f.end)}` : ''}`, () => ({ k: 'calc', title: `מסלול שנסגר · ${f.name}`, value: f.end ? ymL(f.end) : '–', formula: 'החודש האחרון שבו פורסמו נתונים למסלול (funds/closed.json)', inputs: [] })]);
              return (
                <article key={i.k} className={`fw-card${d?.fresh ? ' fresh' : ''}`}>
                  <header><Link to={`/funds/${f.k}`}>{f.name}</Link><span className="fw-acts">{!f.gone && <CompareAdd k={f.k} name={f.name} small />}<WatchStar f={f} asof={asof} small /></span></header>
                  <div className="fw-sub"><MgrChip grp={f.grp} mgr={f.mgr} short /><span className="muted">{f.prod} · {f.track}</span>{d?.fresh && <span className="chip est">{d.months === 1 ? 'חודש חדש' : `${d.months} חודשים חדשים`}</span>}{!i.base && <span className="chip">ביקור ראשון</span>}</div>
                  <dl className="fw-kv">
                    <div><dt>מאז הביקור</dt><dd>{since ? <Sourced src={() => ({ k: 'calc', est: b === 'net', title: `תשואה מאז הביקור הקודם${b === 'net' ? ', נטו' : ''} · ${f.name}`, value: pc(since.r), formula: '(1 + r₁) × … × (1 + rₙ) − 1 על החודשים שפורסמו מאז החודש שנראה בביקור הקודם', note: b === 'net' ? NET_NOTE : undefined, inputs: monthsIn(R, h!, since.ps, b) })}><span className="num">{pc(since.r, 2)}</span></Sourced> : <span className="muted">–</span>}</dd></div>
                    {saver ? <div><dt>12 חודשים</dt><dd>{(b === 'net' ? f.net?.y12 : f.y12) == null ? <span className="muted">–</span> : <Sourced src={() => (b === 'net' ? netProv(f, 'y12', asof, f.net?.y12 ?? null) : grossProv(f, 'y12', asof))}><span className="num">{pc((b === 'net' ? f.net?.y12 : f.y12) ?? null, 2)}</span></Sourced>}</dd></div> :
                    <div><dt>החודש האחרון</dt><dd>{cur?.m1 == null ? <span className="muted">–</span> : <Sourced src={() => (b === 'net' ? netProv(f, 'm1', asof, cur.m1) : fundP(R, asof, 'MONTHLY_YIELD', 'תשואה חודשית', pc(cur.m1)))}><span className="num">{pc(cur.m1, 2)}</span></Sourced>}</dd></div>}
                    <div><dt>אחוזון LTM</dt><dd>{cur?.pct == null ? <span className="muted">–</span> : <Sourced src={() => (i.base ? pctP(f, i.base, cur) : pctP(f, cur, cur))}><span className="num">{nf(cur.pct, 0)}</span></Sourced>}{cur?.pctN ? <span className="dim"> מתוך <span className="num">{cur.pctN}</span></span> : null}{d?.dPct ? <span className={`fw-d ${d.dPct > 0 ? 'pos' : 'neg'}`}>{d.dPct > 0 ? '▲' : '▼'} <span className="num">{nf(Math.abs(d.dPct), 0)}</span> מאז</span> : null}</dd></div>
                    <div><dt>דמי ניהול</dt><dd>{cur?.fee == null ? <span className="muted">–</span> : <Sourced src={() => (d?.dFee ? feeP(f, i.base!, cur) : fundP(R, asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(cur.fee!, 2) + '%'))}><span className="num">{nf(cur.fee, 2)}%</span></Sourced>}{d?.dFee ? <span className={`fw-d ${d.dFee < 0 ? 'pos' : 'neg'}`}>{d.dFee > 0 ? '▲' : '▼'} <span className="num">{nf(Math.abs(d.dFee), 2)}</span> נ"א</span> : null}</dd></div>
                  </dl>
                  {flags.length > 0 && <div className="fw-flags">{flags.map(([t, l, src]) => <Sourced key={l} className={`chip ${t}`} src={src}>{l}</Sourced>)}</div>}
                  <div className="fw-foot muted">{i.base ? <>הביקור הקודם: נתוני <span className="num">{ymL(i.base.asof)}</span></> : 'אין עדיין ביקור קודם'}{i.at ? <> · במעקב מ-<span className="num">{i.at.split('-').reverse().join('.')}</span></> : ''}</div>
                </article>
              );
            })}
          </div>
          <div className="fnote">אחוזון: בקטגוריה של המסלול, על תשואת LTM {b === 'net' ? 'נטו' : 'ברוטו'}, מחושב בבניית הנתונים; שינוי מוצג רק מול ביקור על אותו בסיס. סימונים: מעבר רבעון, רבע תחתון ב-3Y, 10% ומעלה מתחת לשיא, שלושה חודשים ויותר של תזרים שלילי. אין כאן המלצה: אלה עובדות על המסלולים שבחרתם לעקוב אחריהם.</div>
        </Panel>
      )}
      <Panel title="הרשימה שלי" aside={<span>נשמרת רק בדפדפן הזה</span>}>
        <div className="fw-io">
          <button type="button" className="chip" onClick={exportFile} disabled={!w.items.length}>ייצוא לקובץ JSON</button>
          <label className="chip fw-imp">ייבוא מקובץ<input type="file" accept="application/json,.json" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {w.items.length > 0 && <button type="button" className="chip" onClick={() => { if (confirm('לנקות את כל רשימת המעקב בדפדפן הזה?')) setW({ v: 1, items: [] }); }}>ניקוי הרשימה</button>}
          {msg && <span role="status" className="muted">{msg}</span>}
        </div>
        <div className="fnote">שום דבר מהרשימה לא נשלח לשרת. הקובץ כולל את המסלולים ואת מה שנראה בביקור האחרון, כדי שמכשיר אחר ימשיך מאותה נקודה.</div>
      </Panel>
    </>
  );

  function pctP(f: FundX, a: WSnap, c: WSnap): Prov {
    return { k: 'calc', title: `אחוזון LTM${c.b === 'net' ? ', נטו' : ''} בקטגוריה · ${f.name}`, value: c.pct == null ? '–' : nf(c.pct, 0), formula: 'אחוזון בקטגוריה על תשואת 12 החודשים, מחושב בבניית הנתונים (funds.json pr / pn): 100 = הגבוה בקטגוריה',
      inputs: [{ label: `${ymL(c.asof)}`, v: c.pct == null ? '–' : nf(c.pct, 0) }, ...(a !== c ? [{ label: `בביקור הקודם · ${ymL(a.asof)}`, v: a.pct == null ? '–' : nf(a.pct, 0) }] : []), { label: 'מסלולים מדורגים', v: c.pctN == null ? '–' : nf(c.pctN, 0) }] };
  }
  function feeP(f: FundX, a: WSnap, c: WSnap): Prov {
    return { k: 'calc', title: `שינוי בדמי הניהול מצבירה מאז הביקור · ${f.name}`, value: `${sn((c.fee ?? 0) - (a.fee ?? 0), 2)} נ"א`, formula: 'דמי הניהול מצבירה הממוצעים בפועל היום, פחות אלה שנראו בביקור הקודם',
      inputs: [{ label: ymL(c.asof), v: nf(c.fee ?? 0, 2) + '%', src: () => fundP(refOf(f), c.asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(c.fee ?? 0, 2) + '%') }, { label: ymL(a.asof), v: nf(a.fee ?? 0, 2) + '%', src: () => fundP(refOf(f), a.asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(a.fee ?? 0, 2) + '%') }] };
  }
}
