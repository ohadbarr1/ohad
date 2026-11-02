import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Kpi, Loading, Panel, Seg } from '../components/ui';
import { idCss } from '../lib/identity';
import { nf, pubLabel } from '../lib/format';
import { readerHref } from '../lib/search';
import { useLoad, useRegistry } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { ST_HE, actProv, actText, docName, stmtProv, tv, unitHe, useTargets, type CredAgg, type Target, type Targets } from '../lib/targets';
import '../styles/targets.css';
import '../styles/credibility.css';

/* The management-credibility ledger (/credibility): every target whose horizon has passed, against the actual printed for the same
   definition (pipeline/build_targets.py). Status is never forced: a target the site cannot compare on its own wording says why. */

const PASSED = new Set<Target['st']>(['met', 'partial', 'missed', 'nc']);
const ORDER: Record<string, number> = { missed: 0, partial: 1, met: 2, nc: 3, open: 4, policy: 5 };
type View = 'all' | 'passed' | 'scored' | 'nc' | 'open' | 'policy';
const VIEWS = ['all', 'passed', 'scored', 'nc', 'open', 'policy'] as const;
/** published sell-side targets (consensus.json, pipeline/build_consensus.py): dated, sourced, as reported; no share price */
interface Call { c: string; broker: string; broker_he: string | null; date: string; date_kind: 'report' | 'article'; rating: string; rating_norm: string; target: number | null;
  target_printed: string | null; prev_target: number | null; action: string | null; outlet: string; kind: 'press' | 'aggregator'; title: string; src: string; alt: { outlet: string; src: string }[] | null }
interface Consensus { v: number; fetched: string; window: [string, string]; searched: string[]; none: string[]; rows: Call[] }
const RATING_HE: Record<string, string> = { buy: 'קנייה', outperform: 'תשואת יתר', hold: 'החזק', neutral: 'נייטרלי', underperform: 'תשואת חסר', sell: 'מכירה', none: '–' };
const ridOf = (u: string | null) => { const m = u?.match(/P(\d{6,8})-/); return m ? Number(m[1]) : null; };
const hitText = (a: CredAgg) => (a.hit == null ? '–' : `${nf(a.hit, 0)}%`);

export function StatusTag({ t }: { t: Target }) {
  return <span className={`tg-st ${t.st}`} title={t.st === 'nc' ? t.why ?? undefined : t.st === 'partial' ? 'בתוך הטווח, מתחת לקצהו העליון' : undefined}>{ST_HE[t.st]}</span>;
}
/** the target sentence as printed, with its statement and page */
function Said({ d, t, name }: { d: Targets; t: Target; name: string }) {
  const z = t.st1, a = t.st0;
  return (
    <div className="cr-said">
      <Sourced className="cr-l" src={() => stmtProv(d, t, name)}>{t.l}{t.e && t.e !== 'הקבוצה' ? ` · ${t.e}` : ''}</Sourced>
      {t.q && <q>{t.q}</q>}
      <span className="dim">{a && a[0] !== z?.[0] ? <><span className="num">{pubLabel(a[0])}</span> ← </> : null}{z?.[0] && <span className="num">{pubLabel(z[0])}</span>}
        {z?.[1] != null && <> · <Link to={readerHref(z[1], z[2])}>{docName(d, z[1])}{z[2] ? <>, {t.src === 'pres' ? 'שקף' : 'עמ׳'} <span className="num">{z[2]}</span></> : null}</Link></>}
        {t.rev ? <> · עודכן <span className="num">{t.rev}</span>×</> : null}</span>
    </div>
  );
}
function Actual({ t, name }: { t: Target; name: string }) {
  if (t.act) {
    const pages = t.act.in.filter((x) => x[3] != null);
    const link = (x: (typeof pages)[number], i: number) => { const rid = ridOf(x[2]); return <span key={i}>{i ? ', ' : ''}{rid ? <Link to={readerHref(rid, x[3])}><span className="num">{x[3]}</span></Link> : x[2] ? <a href={`${x[2]}#page=${x[3]}`} target="_blank" rel="noreferrer"><span className="num">{x[3]}</span></a> : <span className="num">{x[3]}</span>}</span>; };
    const tag = t.act.prog ? ' · התקדמות, לא נמדד' : t.act.ref ? ' · להשוואה בלבד' : '';
    return <><Sourced className="num" src={() => actProv(t, name)!}>{actText(t)}</Sourced><span className="dim">FY'{String(t.act.y).slice(2)}{pages.length ? <> · עמ׳ {pages.map(link)}</> : null}{t.act.def === 'core' ? ' · הגדרת החברה' : ''}{tag}</span></>;
  }
  if (t.st === 'nc') return <span className="cr-why">{t.why}</span>;
  return <span className="muted">–</span>;
}

/** one target row: on a phone a card, on a desktop a table row */
function Row({ d, t, name, phone, co }: { d: Targets; t: Target; name: (id: string) => string; phone: boolean; co: boolean }) {
  const goal = <><span className="num">{tv(t)}</span>{unitHe(t) && unitHe(t) !== '%' ? <span className="dim">{unitHe(t)}</span> : null}</>;
  if (phone) return (
    <li className={`cr-card ${t.st}`}>
      <header>{co && <><i className="pdot" style={{ background: idCss(t.c) }} /><b>{name(t.c)}</b></>}<span className="cr-h num">{t.h}</span><StatusTag t={t} /></header>
      <Said d={d} t={t} name={name(t.c)} />
      <div className="cr-kv"><div><span className="l">יעד</span>{goal}</div><div><span className="l">בפועל</span><Actual t={t} name={name(t.c)} /></div></div>
    </li>
  );
  return (
    <tr className={t.st}>
      {co && <td className="lbl"><i className="pdot" style={{ background: idCss(t.c) }} /><Link to={`/company/${t.c}`}>{name(t.c)}</Link></td>}
      <td className="lbl wide"><Said d={d} t={t} name={name(t.c)} /></td>
      <td>{t.h ? <span className="num">{t.h}</span> : <span className="muted">מדיניות</span>}</td>
      <td>{goal}</td>
      <td><Actual t={t} name={name(t.c)} /></td>
      <td><StatusTag t={t} /></td>
    </tr>
  );
}

function List({ d, rows, name, phone, co }: { d: Targets; rows: Target[]; name: (id: string) => string; phone: boolean; co: boolean }) {
  if (!rows.length) return <Empty title="אין יעדים במצב הזה" />;
  if (phone) return <ul className="cr-cards">{rows.map((t, i) => <Row key={i} d={d} t={t} name={name} phone co={co} />)}</ul>;
  return (
    <div className="scroll"><table className="tg-t cr-t">
      <thead><tr>{co && <th>חברה</th>}<th>יעד, כפי שהוצהר</th><th>אופק</th><th>יעד</th><th>בפועל</th><th>סטטוס</th></tr></thead>
      <tbody>{rows.map((t, i) => <Row key={i} d={d} t={t} name={name} phone={false} co={co} />)}</tbody>
    </table></div>
  );
}

/** "אמינות יעדים": hit rates per company and per year the targets were set, and every passed target with its target and actual pages */
export function Credibility() {
  const tg = useTargets(), reg = useRegistry();
  const phone = usePhone();
  const [sp, setSp] = useSearchParams();
  const co = sp.get('co') ?? '';
  const view = (VIEWS.find((v) => v === sp.get('v')) ?? 'all') as View;
  const cons = useLoad<Consensus>('consensus.json');
  const set = (k: string, v: string, def = '') => setSp((p) => { const n = new URLSearchParams(p); if (v === def) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const d = tg.data, cred = d?.cred;
  const rows = useMemo(() => (d?.rows ?? []).filter((t) => !co || t.c === co)
    .filter((t) => (view === 'all' ? true : view === 'passed' ? PASSED.has(t.st) : view === 'scored' ? ['met', 'partial', 'missed'].includes(t.st) : t.st === view))
    .sort((a, b) => (view === 'all' ? ORDER[a.st] - ORDER[b.st] : 0) || (view === 'open' ? (a.h ?? 0) - (b.h ?? 0) : (b.h ?? 0) - (a.h ?? 0)) || ORDER[a.st] - ORDER[b.st] || a.c.localeCompare(b.c)), [d, co, view]);
  const npol = (d?.rows ?? []).filter((t) => t.st === 'policy' && (!co || t.c === co)).length;

  if (tg.error) return <ErrorBox what="היעדים" error={tg.error} />;
  if (!d || !reg.data) return <Loading what="אמינות היעדים" />;
  if (!cred) return <Empty title="אין דירוג יעדים בקובץ" />;
  const cos = Object.keys(cred.companies).filter((c) => cred.companies[c].n + cred.companies[c].nc + cred.companies[c].open > 0);
  const a = co ? cred.companies[co] : cred.all;
  return (
    <div className="cr">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="shield" /></span>אמינות יעדים</h1>
        <div className="sub"><span className="num">{cred.all.n}</span> יעדים נמדדו מול הבפועל · <span className="num">{cred.all.nc}</span> לא ניתנים להשוואה · <span className="num">{cred.all.open}</span> פתוחים · <span className="num">{d.rows.filter((t) => t.st === 'policy').length}</span> מדיניות קבועה · כל יעד וכל בפועל עם העמוד</div></div></div>

      <section className="kpis cr-kpis">
        <Kpi label={`שיעור עמידה${co ? ` · ${name(co)}` : ''}`} value={<span className="num">{a ? hitText(a) : '–'}</span>} sub={<>n = <span className="num">{a?.n ?? 0}</span> · בטווח או מעליו</>} />
        <Kpi label="הושג" value={<span className="num">{a?.met ?? 0}</span>} sub="מעל היעד או קצה הטווח" tone="pos" />
        <Kpi label="חלקית" value={<span className="num">{a?.partial ?? 0}</span>} sub="בתוך הטווח" />
        <Kpi label="לא הושג" value={<span className="num">{a?.missed ?? 0}</span>} sub="מתחת ליעד" tone={a?.missed ? 'neg' : undefined} />
        <Kpi label="לא ניתן להשוואה" value={<span className="num">{a?.nc ?? 0}</span>} sub="הגדרה אחרת, או שהבפועל לא נקלט" />
      </section>

      <Panel title="לפי חברה ולפי שנת ההצהרה" aside={<span>שיעור עמידה = (הושג + חלקית) ÷ נמדדו</span>}>
        {phone ? <ul className="cr-cocards">{cos.map((c) => { const x = cred.companies[c]; return (
          <li key={c} className={co === c ? 'on' : ''}><div className="cr-cohd"><button type="button" className="thsel" onClick={() => set('co', co === c ? '' : c)}><i className="pdot" style={{ background: idCss(c) }} />{name(c)}</button><b className="num">{hitText(x)}</b><span className="dim">n = <span className="num">{x.n}</span>{x.nc ? <> · <span className="num">{x.nc}</span> ל״נ</> : null} · <span className="num">{x.open}</span> פתוחים</span></div>
            <div className="cr-eras">{Object.entries(x.eras).filter(([, e]) => e.n + e.nc > 0).map(([y, e]) => <span key={y} className="chip" title={`${e.met} הושג · ${e.partial} חלקית · ${e.missed} לא הושג · ${e.nc} לא ניתן להשוואה`}><span className="num">{y}</span>: <span className="num">{e.n ? `${e.met + e.partial}/${e.n}` : '–'}</span>{e.nc ? <span className="dim"> +{e.nc} ל״נ</span> : null}</span>)}</div></li>); })}</ul>
        : <div className="scroll"><table className="cr-co">
          <thead><tr><th>חברה</th><th>נמדדו</th><th>הושג</th><th>חלקית</th><th>לא הושג</th><th>לא ניתן</th><th>פתוח</th><th>שיעור</th><th>לפי שנת ההצהרה</th></tr></thead>
          <tbody>{cos.map((c) => { const x = cred.companies[c]; return (
            <tr key={c} className={co === c ? 'on' : ''}>
              <td className="lbl"><button type="button" className="thsel" onClick={() => set('co', co === c ? '' : c)}><i className="pdot" style={{ background: idCss(c) }} />{name(c)}</button></td>
              <td><span className="num">{x.n}</span></td><td><span className="num pos">{x.met || ''}</span></td><td><span className="num">{x.partial || ''}</span></td><td><span className="num neg">{x.missed || ''}</span></td><td><span className="num">{x.nc || ''}</span></td><td><span className="num muted">{x.open || ''}</span></td>
              <td><span className="num"><b>{hitText(x)}</b></span></td>
              <td className="cr-eras">{Object.entries(x.eras).filter(([, e]) => e.n + e.nc > 0).map(([y, e]) => <span key={y} className="chip" title={`${e.met} הושג · ${e.partial} חלקית · ${e.missed} לא הושג · ${e.nc} לא ניתן להשוואה`}><span className="num">{y}</span>: <span className="num">{e.n ? `${e.met + e.partial}/${e.n}` : '–'}</span>{e.nc ? <span className="dim"> +{e.nc} ל״נ</span> : null}</span>)}</td>
            </tr>); })}</tbody>
        </table></div>}
        <div className="src">שנת ההצהרה = השנה שבה היעד הוצג לראשונה (אין מקור חופשי לתקופות כהונת המנכ״לים). נמדד רק יעד עם אופק שעבר, מול הבפועל באותה הגדרה שבנוסח היעד: רווח מדווח מול יעד רווח, רווח ליבה לפי הגדרת החברה מול יעד ליבה, יחס כושר פירעון באותו בסיס. מדיניות חלוקה ויעדים ללא אופק לא נמדדים.</div>
      </Panel>

      <Panel title={co ? `יעדים · ${name(co)}` : 'יעדים'} aside={<Seg<View> label="מצב" value={view} onChange={(v) => set('v', v, 'all')} options={[['all', `הכל (${d.rows.filter((t) => !co || t.c === co).length})`], ['passed', 'האופק עבר'], ['scored', 'נמדדו'], ['nc', 'לא ניתן להשוואה'], ['open', 'פתוחים'], ['policy', `מדיניות (${npol})`]]} />}>
        {co && <div className="cr-filter"><span className="chip" aria-pressed="true">{name(co)}</span><button type="button" className="chip" onClick={() => set('co', '')}>כל החברות</button></div>}
        <List d={d} rows={rows} name={name} phone={phone} co={!co} />
        <div className="src">יעד: כפי שהודפס בדוח או במצגת, עם העמוד. בפועל: כפי שהודפס לשנת היעד, עם העמוד (קישור לעמוד בקורא); נגזר (תשואה להון) עם הנוסחה ורכיביה. חלקית = בתוך הטווח שהוצהר, מתחת לקצהו העליון. פתוח: האופק טרם הגיע (לצדו השנה האחרונה שדווחה, לא נמדד). מדיניות: מדיניות קבועה ללא אופק, לא נמדדת.</div>
      </Panel>

      <Calls data={cons.data} error={cons.error} co={co} name={name} phone={phone} />
    </div>
  );
}

/** the compact ledger on a company page: its hit rate and its passed targets, newest horizon first */
export function CredibilityPanel({ id, name }: { id: string; name: string }) {
  const tg = useTargets();
  const phone = usePhone();
  const d = tg.data, x = d?.cred?.companies[id];
  if (!d || !x || x.n + x.nc === 0) return null;
  const rows = d.rows.filter((t) => t.c === id && PASSED.has(t.st)).sort((a, b) => (b.h ?? 0) - (a.h ?? 0) || ORDER[a.st] - ORDER[b.st]).slice(0, 6);
  return (
    <Panel title="אמינות יעדים" aside={<span>שיעור עמידה <b className="num">{hitText(x)}</b> · n = <span className="num">{x.n}</span>{x.nc ? <> · <span className="num">{x.nc}</span> לא ניתנים להשוואה</> : null} · <Link className="cr-all" to={`/credibility?co=${id}`}>כל היעדים</Link></span>}>
      <List d={d} rows={rows} name={() => name} phone={phone} co={false} />
    </Panel>
  );
}

/** "תחזיות ומחירי יעד מפורסמים": the sell-side targets and ratings as the press and IR pages published them, dated and linked.
    Fundamentals only: no share price beside them and no upside; a target is a published figure, not fox's view. */
function Calls({ data, error, co, name, phone }: { data: Consensus | null; error: string | null; co: string; name: (id: string) => string; phone: boolean }) {
  if (error || !data) return null;
  const rows = data.rows.filter((r) => !co || r.c === co).sort((a, b) => b.date.localeCompare(a.date) || a.c.localeCompare(b.c));
  const none = data.none.filter((c) => !co || c === co);
  const tgt = (r: Call) => (r.target != null ? <><span className="num">{nf(r.target, r.target % 1 ? 2 : 0)}</span> ₪</> : <span className="muted">–</span>);
  const prev = (r: Call) => (r.prev_target != null ? <span className="dim">קודם <span className="num">{nf(r.prev_target, r.prev_target % 1 ? 2 : 0)}</span> ₪</span> : null);
  const src = (r: Call) => <><a href={r.src} target="_blank" rel="noreferrer">{r.outlet}</a>{r.kind === 'aggregator' ? <span className="dim">טבלת דירוגים מצרפית</span> : null}{r.alt?.map((a) => <a key={a.src} className="dim" href={a.src} target="_blank" rel="noreferrer">{a.outlet}</a>)}</>;
  return (
    <Panel title="תחזיות ומחירי יעד מפורסמים" aside={<span>מחיר יעד והמלצה כפי שפורסמו, עם התאריך והמקור · נאסף <span className="num">{pubLabel(data.fetched)}</span></span>}>
      {!rows.length ? <Empty title="לא נמצא מחיר יעד מפורסם בשנה האחרונה" /> : phone ? (
        <ul className="cr-cards">{rows.map((r, i) => (
          <li key={i} className="cr-card"><header>{!co && <><i className="pdot" style={{ background: idCss(r.c) }} /><b>{name(r.c)}</b></>}<span className="cr-h num">{pubLabel(r.date)}</span></header>
            <div className="cr-kv"><div><span className="l">בית השקעות</span>{r.broker_he ?? r.broker}</div><div><span className="l">המלצה</span>{RATING_HE[r.rating_norm] ?? r.rating}</div>
              <div><span className="l">מחיר יעד</span>{tgt(r)}{prev(r)}</div><div><span className="l">מקור</span>{src(r)}</div></div></li>))}</ul>
      ) : (
        <div className="scroll"><table className="tg-t cr-t cr-calls">
          <thead><tr>{!co && <th>חברה</th>}<th>תאריך</th><th>בית השקעות</th><th>המלצה</th><th>מחיר יעד</th><th>מקור</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              {!co && <td className="lbl"><i className="pdot" style={{ background: idCss(r.c) }} /><Link to={`/company/${r.c}`}>{name(r.c)}</Link></td>}
              <td><span className="num">{pubLabel(r.date)}</span><span className="dim">{r.date_kind === 'article' ? 'תאריך הכתבה' : 'תאריך הדוח'}</span></td>
              <td>{r.broker_he ?? r.broker}{r.broker_he ? <span className="dim" dir="ltr">{r.broker}</span> : null}</td>
              <td>{RATING_HE[r.rating_norm] ?? r.rating}<span className="dim">{r.rating}</span></td>
              <td>{tgt(r)}{prev(r)}{r.target_printed ? <span className="dim">כפי שפורסם: {r.target_printed}</span> : null}</td>
              <td className="wide">{src(r)}<span className="dim">{r.title}</span></td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="src">נאספו מכתבות ומעמודי משקיעים פומביים (גלובס, כלכליסט, TheMarker, ביזפורטל, פאנדר ועוד) לחלון <span className="num">{pubLabel(data.window[0])}</span>–<span className="num">{pubLabel(data.window[1])}</span>; כל שורה אומתה מול העמוד, ונתון שלא אומת לא נכלל. מחיר יעד בש״ח כפי שפורסם (אגורות ÷ 100). fox אינו מציג מחיר מניה ואינו מחשב פוטנציאל: אלה תחזיות של אחרים, לא המלצה.{none.length ? <> לא נמצא מחיר יעד מפורסם בחלון: {none.map(name).join(', ')}.</> : null}</div>
    </Panel>
  );
}
