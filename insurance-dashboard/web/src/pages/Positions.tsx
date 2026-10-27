import { useEffect, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Kpi, Loading, Panel, Pick } from '../components/ui';
import { idCss } from '../lib/identity';
import { nf } from '../lib/format';
import { warmRep, type LensData } from '../lib/lens';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import {
  CONF_HE, DIR_HE, FST_HE, OUT_HE, companiesHe, daysTo, fmtD, fmtN, fmtV, opHe, perLabel, pubLabel, stateOf, today, unitHe, usePositions, valueProv,
  type Conf, type PFals, type PTrig, type Position, type PositionsFile,
} from '../lib/positions';
import '../styles/positions.css';

/* The position book (module A6): /positions lists the published positions, /positions/<id> is one tear sheet. Positions are written by
   the owner (pipeline/position.py) and frozen in an append-only ledger; the engine scores them against the published data and never
   closes one. Drafts appear only in a --drafts dev build of positions.json. */

const days = (n: number | null) => (n == null ? '–' : n === 0 ? 'היום' : n > 0 ? <>בעוד <span className="num">{nf(n, 0)}</span> ימים</> : <>לפני <span className="num">{nf(-n, 0)}</span> ימים</>);
const hitText = (h: number | null) => (h == null ? '–' : `${nf(h, 0)}%`);

function CoChips({ F, p }: { F: PositionsFile; p: Position }) {
  return <>{p.company.map((c) => c === 'industry' ? <span key={c} className="ps-co">ענפי</span> : <Link key={c} className="ps-co" to={`/company/${c}`}><i className="pdot" style={{ background: idCss(c) }} />{F.cos[c] ?? c}</Link>)}</>;
}
function StateTag({ p }: { p: Position }) {
  const s = stateOf(p);
  return <span className={`ps-st ${s.k}`}>{s.he}</span>;
}
function DriftMark({ p }: { p: Position }) {
  const fired = p.triggers.filter((t) => t.fired);
  if (!p.triggers.length) return <span className="muted">–</span>;
  const top = [...p.triggers].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
  return (
    <span className={`ps-drift${fired.length ? ' on' : ''}`} title={top.label}>
      <i aria-hidden="true" />{fired.length ? <><span className="num">{fired.length}/{p.triggers.length}</span> עברו סף</> : 'בתוך הסף'}
      {top.dpp != null && <span className="dim">{top.threshold_pct != null
        ? <><span className="num">{top.dpct != null ? `${nf(top.dpct, 1)}%` : '–'}</span> מתוך <span className="num">{nf(top.threshold_pct, 0)}%</span></>
        : <><span className="num">{fmtD(top.dpp, top.unit === 'm' ? 'm' : 'pp', top.threshold_pp)}</span> מתוך <span className="num">{nf(top.threshold_pp ?? 0, (top.threshold_pp ?? 1) < 0.1 ? 2 : 1)}</span>{top.unit === 'm' ? ' מיליוני ש"ח' : ' נק׳'}</>}</span>}
    </span>
  );
}
function FalsSummary({ p }: { p: Position }) {
  const met = p.falsifiers.filter((f) => f.st === 'met').length;
  return <span className={`ps-fs${met ? ' met' : ''}`}><span className="num">{met}/{p.falsifiers.length}</span> התקיימו</span>;
}

/* ---------------------------------------------------------------------------------------------------------- the list */
export function Positions() {
  const { data: F, error } = usePositions();
  const phone = usePhone();
  const [sp, setSp] = useSearchParams();
  const co = sp.get('co') ?? '', conf = (sp.get('conf') ?? '') as Conf | '';
  const set = (k: string, v: string) => setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  const list = useMemo(() => (F?.positions ?? []).filter((p) => (!co || p.company.includes(co)) && (!conf || p.confidence === conf)), [F, co, conf]);
  if (error) return <ErrorBox what="ספר העמדות" error={error} />;
  if (!F) return <Loading what="ספר העמדות" />;
  const t = today();
  const open = list.filter((p) => p.outcome.st === 'open').sort((a, b) => (a.next_review ?? '9').localeCompare(b.next_review ?? '9') || a.horizon.localeCompare(b.horizon));
  const closed = list.filter((p) => p.outcome.st !== 'open').sort((a, b) => (b.outcome.date ?? '').localeCompare(a.outcome.date ?? ''));
  const cos = [...new Set(F.positions.flatMap((p) => p.company))].sort((a, b) => (F.cos[a] ?? a).localeCompare(F.cos[b] ?? b, 'he'));
  const h = F.hit;
  const nPub = F.positions.filter((p) => p.status === 'published').length;
  return (
    <div className="ps">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="check" /></span>ספר העמדות</h1>
        <div className="sub"><span><span className="num">{h.open}</span> פתוחות</span><span>·</span><span><span className="num">{h.n}</span> סגורות</span><span>·</span>
          <span>שיעור פגיעה <b className="num">{hitText(h.hit)}</b> (n = <span className="num">{h.confirmed + h.falsified}</span>)</span><span>·</span><span>כל מספר נפתח במקור</span></div></div></div>
      {F.drafts && <p className="ps-banner" role="note"><span className="chip ps-draft">טיוטות</span> בנייה לפיתוח (<bdi className="mono" dir="ltr">--drafts</bdi>): עמדות מועמדות שלא פורסמו. הן אינן בספר, אינן בפיד, והשער חוסם פריסה של הקובץ הזה.</p>}
      {F.abstain.phoenix && <p className="ps-banner" role="note">{F.abstain.phoenix}{F.withheld ? <> · <span className="num">{F.withheld}</span> עמדות מוחזקות</> : null}</p>}

      <section className="kpis ps-kpis">
        <Kpi label="שיעור פגיעה" value={hitText(h.hit)} sub={<>אושרו ÷ (אושרו + הופרכו) · n = <span className="num">{h.confirmed + h.falsified}</span></>} />
        <Kpi label="אושרו" value={h.confirmed} tone="pos" />
        <Kpi label="הופרכו" value={h.falsified} tone={h.falsified ? 'neg' : undefined} />
        <Kpi label="פג תוקף · נמשכו" value={<>{h.expired} · {h.withdrawn}</>} sub="מחוץ לשיעור" />
        <Kpi label="פגיעה לפי ביטחון" value={<span className="ps-bc">{(['high', 'medium', 'low'] as Conf[]).map((k) => <span key={k}>{hitText(h.by_conf[k].hit)}</span>)}</span>} sub={<>גבוה · בינוני · נמוך</>} />
      </section>

      {F.positions.length > 0 && (
        <section className="controls ps-controls" aria-label="סינון">
          <Pick label="חברה" cap="חברה" value={co} onChange={(v) => set('co', v)} options={[['', 'כל החברות'], ...cos.map((c) => [c, F.cos[c] ?? c] as [string, string])]} />
          <div className="ps-chips" role="group" aria-label="ביטחון">
            <button type="button" className={`chip${!conf ? ' on' : ''}`} aria-pressed={!conf} onClick={() => set('conf', '')}>כל רמות הביטחון</button>
            {(['high', 'medium', 'low'] as Conf[]).map((k) => <button key={k} type="button" className={`chip${conf === k ? ' on' : ''}`} aria-pressed={conf === k} onClick={() => set('conf', conf === k ? '' : k)}>{CONF_HE[k]} <span className="num">{F.positions.filter((p) => p.confidence === k && (!co || p.company.includes(co))).length}</span></button>)}
          </div>
        </section>
      )}

      <Panel title={<><span className="num">{open.length}</span> עמדות פתוחות</>} aside={<span>לפי הסקירה הבאה · סטייה = מדד שזז מעבר לסף מאז הפתיחה</span>}>
        {!open.length ? <Empty title={nPub || F.drafts ? 'אין עמדות פתוחות בסינון זה' : 'אין עדיין עמדות שפורסמו'} icon="check" />
          : phone ? <ul className="ps-cards">{open.map((p) => (
            <li key={p.id} className="ps-card">
              <header><CoChips F={F} p={p} />{p.status === 'draft' && <span className="chip ps-draft">טיוטה</span>}<StateTag p={p} /></header>
              <Link className="ps-claim" to={`/positions/${p.id}`}>{p.claim}</Link>
              <div className="ps-kv">
                <div><span className="l">ביטחון · כיוון</span>{CONF_HE[p.confidence]} · {DIR_HE[p.direction]}</div>
                <div><span className="l">אופק</span><span className="num">{pubLabel(p.horizon)}</span> <span className="dim">{days(daysTo(p.horizon, t))}</span></div>
                <div><span className="l">סקירה הבאה</span><span className="num">{pubLabel(p.next_review)}</span> <span className="dim">{days(daysTo(p.next_review, t))}</span></div>
                <div><span className="l">הפרכה</span><FalsSummary p={p} /></div>
                <div className="w"><span className="l">סטייה</span><DriftMark p={p} /></div>
              </div>
            </li>))}</ul>
          : <div className="scroll"><table className="ps-t">
            <thead><tr><th>עמדה</th><th>חברה</th><th>ביטחון</th><th>כיוון</th><th>אופק</th><th>סקירה הבאה</th><th>סטייה</th><th>הפרכה</th><th>מצב</th></tr></thead>
            <tbody>{open.map((p) => (
              <tr key={p.id}>
                <td className="lbl wide"><Link className="ps-claim" to={`/positions/${p.id}`}>{p.claim}</Link>{p.status === 'draft' && <span className="chip ps-draft">טיוטה</span>}</td>
                <td className="lbl"><CoChips F={F} p={p} /></td>
                <td>{CONF_HE[p.confidence]}</td><td>{DIR_HE[p.direction]}</td>
                <td><span className="num">{pubLabel(p.horizon)}</span><span className="dim">{days(daysTo(p.horizon, t))}</span></td>
                <td><span className="num">{pubLabel(p.next_review)}</span><span className="dim">{days(daysTo(p.next_review, t))}</span></td>
                <td><DriftMark p={p} /></td><td><FalsSummary p={p} /></td><td><StateTag p={p} /></td>
              </tr>))}</tbody>
          </table></div>}
      </Panel>

      <Panel title={<><span className="num">{closed.length}</span> עמדות סגורות</>} aside={<span>הסגירה היא רישום מתוארך של הכותב · שיעור הפגיעה: אושרו ÷ (אושרו + הופרכו)</span>}>
        {!closed.length ? <Empty title="אין עדיין עמדות סגורות" icon="check" />
          : <ul className="ps-closed">{closed.map((p) => (
            <li key={p.id}><StateTag p={p} /><span className="num dim">{pubLabel(p.outcome.date)}</span><CoChips F={F} p={p} /><span className="dim">ביטחון {CONF_HE[p.confidence]}</span>
              <Link className="ps-claim" to={`/positions/${p.id}`}>{p.claim}</Link>{p.outcome.note && <span className="ps-note">{p.outcome.note}</span>}</li>))}</ul>}
      </Panel>
      <p className="src">יומן שאינו נמחק: שינוי = גרסה חדשה שמפנה לקודמת, סגירה = רישום מתוארך של הכותב · נתונים: עדשת החיסכון עד <span className="num">{perLabel(F.asof.lens.replace(/^Q(\d)-(\d{4})$/, '$2Q$1'))}</span>, XBRL, כרטיסי הדוח</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------- the tear sheet */
function Val({ F, k, per, lens, className = '' }: { F: PositionsFile; k: string; per: string; lens: LensData | null; className?: string }) {
  const m = F.metrics[k], pt = m?.ser.find((x) => x[0] === per);
  if (!m || !pt) return <span className="muted">–</span>;
  return <><Sourced className={`num ${className}`.trim()} src={() => valueProv(F, k, per, lens)}>{fmtV(pt[1], m.unit)}</Sourced>{m.unit === 'pp' ? ' נק׳' : ''}</>;
}
function FalsRow({ F, f, lens, phone }: { F: PositionsFile; f: PFals; lens: LensData | null; phone: boolean }) {
  const cond = <><b>{f.label ?? f.metric}</b> <bdi dir="ltr" className="num">{opHe(f.op)} {fmtN(f.value, f.unit)}{f.unit === 'pct' ? '%' : ''}</bdi>{f.unit === 'pp' ? ' נק׳' : f.unit === 'm' ? ' מיליוני ש"ח' : ''} · {f.period === 'each' ? <>בכל דוח מאז <span className="num">{f.since ?? 'הפתיחה'}</span></> : <>ב-<span className="num">{f.period}</span></>}</>;
  const obs = f.at ?? f.last;
  const val = obs ? <><Val F={F} k={f.metric} per={obs.p} lens={lens} /> <span className="dim num">{perLabel(obs.p)}{f.last && !f.at ? ' (אחרון)' : ''}</span></> : <span className="muted">{f.why ?? '–'}</span>;
  if (phone) return <li className={`ps-fcard ${f.st}`}><div>{cond}</div><div className="ps-kv"><div><span className="l">מצב</span><span className={`ps-fst ${f.st}`}>{FST_HE[f.st]}</span></div><div><span className="l">ערך</span>{val}</div></div>{f.note && <span className="ps-note">{f.note}</span>}</li>;
  return <tr className={f.st}><td className="lbl wide">{cond}{f.note && <span className="ps-note">{f.note}</span>}</td><td><span className={`ps-fst ${f.st}`}>{FST_HE[f.st]}</span></td><td>{val}</td></tr>;
}
function TrigRow({ F, t, lens, phone }: { F: PositionsFile; t: PTrig; lens: LensData | null; phone: boolean }) {
  const thr = t.threshold_pp != null ? <><span className="num">{nf(t.threshold_pp, t.threshold_pp < 1 ? 2 : 1)}</span> {t.unit === 'm' ? 'מיליוני ש"ח' : 'נק׳'}</> : <span className="num">{nf(t.threshold_pct ?? 0, 0)}%</span>;
  const bk = t.base ? t.base.per.replace(/^Q(\d)'(\d\d)$/, '20$2Q$1').replace(/^FY'(\d\d)$/, '20$1FY') : '';
  const base = t.base ? <><Val F={F} k={t.metric} per={bk} lens={lens} /> <span className="dim num">{t.base.per}</span></> : <span className="muted">–</span>;
  const last = t.last ? <><Val F={F} k={t.metric} per={t.last.p} lens={lens} /> <span className="dim num">{perLabel(t.last.p)}</span></> : <span className="muted">{t.why ?? '–'}</span>;
  const drift = <span className={t.fired ? 'ps-hot' : ''}><span className="num">{t.threshold_pct != null ? (t.dpct != null ? `${nf(t.dpct, 1)}%` : '–') : fmtD(t.dpp, t.unit === 'm' ? 'm' : 'pp', t.threshold_pp)}</span>{t.threshold_pct == null && t.unit !== 'm' ? ' נק׳' : ''}</span>;
  const st = <span className={`ps-tst ${t.st}`}>{t.st === 'fired' ? `עבר סף${t.first ? ` · ${perLabel(t.first.p)}` : ''}` : t.st === 'ok' ? 'בתוך הסף' : 'לא נפתר'}</span>;
  if (phone) return <li className={`ps-fcard ${t.st}`}><b>{t.label ?? t.metric}</b><div className="ps-kv"><div><span className="l">בסיס</span>{base}</div><div><span className="l">אחרון</span>{last}</div><div><span className="l">שינוי · סף</span>{drift} · {thr}</div><div><span className="l">מצב</span>{st}</div></div></li>;
  return <tr className={t.st}><td className="lbl wide"><b>{t.label ?? t.metric}</b></td><td>{base}</td><td>{last}</td><td>{drift}</td><td>{thr}</td><td>{st}</td></tr>;
}

export function PositionSheet() {
  const { id = '' } = useParams();
  const { data: F, error } = usePositions();
  const p = F?.positions.find((x) => x.id === id);
  const needsLens = !!p && [...p.falsifiers.map((f) => f.metric), ...p.triggers.map((x) => x.metric), ...p.evidence.map((e) => e.ref)].some((k) => k.includes('lens:'));
  const L = useLoad<LensData>(needsLens ? 'lens.json' : null).data;
  const phone = usePhone();
  useEffect(() => { if (L && p) for (const k of new Set([...p.falsifiers.map((f) => f.metric), ...p.triggers.map((t) => t.metric), ...p.evidence.map((e) => e.ref)])) for (const pt of F!.metrics[k]?.ser.slice(-8) ?? []) for (const c of pt[3]) { const cs = c.k === 'term' ? c.in.flatMap((x) => (x.k === 'term' ? x.in : [x])) : [c]; for (const x of cs) if (x.k === 'lens') warmRep(L.groups[x.g]?.lts); } }, [L, p, F]);
  if (error) return <ErrorBox what="ספר העמדות" error={error} />;
  if (!F) return <Loading what="העמדה" />;
  if (!p) return <Empty title="העמדה אינה בספר" icon="check"><Link to="/positions">לכל העמדות</Link></Empty>;
  const t = today();
  const keys = [...new Set([...p.falsifiers.map((f) => f.metric), ...p.triggers.map((x) => x.metric), ...p.evidence.filter((e) => e.kind === 'metric').map((e) => e.ref)])].filter((k) => F.metrics[k]);
  const s = stateOf(p, t);
  return (
    <div className="ps ps-sheet">
      <div className="pagehead"><div>
        <span className="eyebrow"><Link to="/positions">ספר העמדות</Link> · <bdi className="mono" dir="ltr">{p.id}</bdi>{p.rev ? <> · r<span className="num">{p.rev}</span></> : null}</span>
        <h1 className="ps-h1">{p.claim}</h1>
        <div className="sub"><CoChips F={F} p={p} />{p.status === 'draft' && <span className="chip ps-draft">טיוטה, לא פורסמה</span>}<StateTag p={p} />
          <span>ביטחון {CONF_HE[p.confidence]}</span><span>·</span><span>כיוון {DIR_HE[p.direction]}</span><span>·</span>
          <span>נפתחה {p.opened ? <span className="num">{pubLabel(p.opened)}</span> : '–'}</span>{p.revised && p.revised !== p.opened && <><span>·</span><span>עודכנה <span className="num">{pubLabel(p.revised)}</span></span></>}</div>
      </div></div>
      {p.problems?.length ? <p className="ps-banner" role="note">בעיות אימות בטיוטה: {p.problems.join(' · ')}</p> : null}

      <section className="kpis ps-kpis">
        <Kpi label="אופק" value={pubLabel(p.horizon)} sub={days(daysTo(p.horizon, t))} />
        <Kpi label="סקירה הבאה" value={p.next_review ? pubLabel(p.next_review) : '–'} sub={<>{days(daysTo(p.next_review, t))} · {p.review === 'print' ? 'כל דוח רבעוני' : 'תאריך'}</>} />
        <Kpi label="תנאי הפרכה" value={`${p.falsifiers.filter((f) => f.st === 'met').length}/${p.falsifiers.length}`} sub="התקיימו" tone={p.suggest ? 'neg' : undefined} />
        <Kpi label="סטייה בראיות" value={`${p.triggers.filter((x) => x.fired).length}/${p.triggers.length}`} sub="מדדים שעברו את הסף" tone={p.drift ? 'neg' : undefined} />
        <Kpi label="מצב" value={<span className={`ps-st ${s.k}`}>{s.he}</span>} sub={p.suggest ? 'הצעת המנוע; הכותב סוגר' : p.outcome.date ? pubLabel(p.outcome.date) : undefined} />
      </section>
      {p.due && p.outcome.st === 'open' && <p className="ps-banner" role="note">לסקירה: דוח <span className="num">{perLabel(p.due.per)}</span> של {F.cos[p.due.c] ?? p.due.c} פורסם <span className="num">{pubLabel(p.due.d)}</span>, אחרי העדכון האחרון של העמדה.</p>}

      <Panel title="תנאי הפרכה" aside={<span>תנאי שהתקיים מציע "הופרכה"; הסגירה בידי הכותב</span>}>
        {phone ? <ul className="ps-fcards">{p.falsifiers.map((f, i) => <FalsRow key={i} F={F} f={f} lens={L} phone />)}</ul>
          : <div className="scroll"><table className="ps-t ps-ft"><thead><tr><th>תנאי</th><th>מצב</th><th>ערך</th></tr></thead><tbody>{p.falsifiers.map((f, i) => <FalsRow key={i} F={F} f={f} lens={L} phone={false} />)}</tbody></table></div>}
      </Panel>

      {p.triggers.length > 0 && (
        <Panel title="סטייה בראיות" aside={<span>הבסיס הוקפא בפרסום העמדה</span>}>
          {phone ? <ul className="ps-fcards">{p.triggers.map((x, i) => <TrigRow key={i} F={F} t={x} lens={L} phone />)}</ul>
            : <div className="scroll"><table className="ps-t"><thead><tr><th>מדד</th><th>בסיס</th><th>אחרון</th><th>שינוי</th><th>סף</th><th>מצב</th></tr></thead><tbody>{p.triggers.map((x, i) => <TrigRow key={i} F={F} t={x} lens={L} phone={false} />)}</tbody></table></div>}
        </Panel>
      )}

      <Panel title="ראיות" aside={<span>כל ראיה מקשרת לדף ב-fox, ומשם לעמוד בדוח</span>}>
        <ol className="ps-ev">{p.evidence.map((e, i) => (
          <li key={i} className={e.ok ? '' : 'bad'}>
            <div className="ps-evh">{e.to ? <Link to={e.to}>{e.label}</Link> : <span>{e.label}</span>}
              {e.kind === 'metric' && e.val?.p && <> · <Val F={F} k={e.ref} per={e.val.p} lens={L} /> <span className="dim num">{perLabel(e.val.p)}</span></>}
              {e.kind === 'target' && e.val && <> · <span className="num">{e.val.v != null ? nf(e.val.v, 1) : `${e.val.lo != null ? nf(e.val.lo, 1) : ''}–${e.val.hi != null ? nf(e.val.hi, 1) : ''}`}{e.val.u === 'pct' ? '%' : ''}</span></>}
              {e.pdf?.url && <> · <a href={`${e.pdf.url}${e.pdf.pg ? `#page=${e.pdf.pg}` : ''}`} target="_blank" rel="noreferrer">הדוח{e.pdf.pg ? <>, עמ׳ <span className="num">{e.pdf.pg}</span></> : null}</a></>}
            </div>
            {e.note && <span className="ps-note">{e.note}</span>}
          </li>))}</ol>
      </Panel>

      <Panel title="מנגנון">
        <p className="ps-mech">{p.mechanism}</p>
        {p.mechanism_edge && <p className="dim">קשת בגרף הגורמים: <bdi className="mono" dir="ltr">{p.mechanism_edge}</bdi></p>}
      </Panel>

      {keys.length > 0 && (
        <Panel title="המדדים לאורך זמן" aside={<span>8 התקופות האחרונות · כל ערך נפתח במקור</span>}>
          <div className="scroll"><table className="ps-t ps-ser">
            <tbody>{keys.map((k) => { const m = F.metrics[k], ser = m.ser.slice(-8); return (
              <tr key={k}><th scope="row" className="lbl wide">{m.label}<span className="dim">{unitHe(m.unit)}{m.fx ? ` · ${m.fx}` : ''}</span><Link className="ps-to" to={m.to}>בעדשה</Link></th>
                {ser.map((x) => <td key={x[0]}><span className="dim num">{perLabel(x[0])}</span><Val F={F} k={k} per={x[0]} lens={L} /></td>)}</tr>); })}</tbody>
          </table></div>
        </Panel>
      )}

      <Panel title="יומן העמדה" aside={<span>כל גרסה קפואה; שינוי = גרסה חדשה שמפנה לקודמת</span>}>
        {!p.revs.length ? <Empty title="טיוטה: עדיין לא ביומן" icon="check" />
          : <ul className="ps-log">{p.revs.map((r) => <li key={r.rev}><b>r<span className="num">{r.rev}</span></b><span className="num">{pubLabel(r.date)}</span>{r.supersedes && <span className="dim">מחליפה את {r.supersedes}</span>}<span>{r.note || (r.rev === 1 ? 'פרסום' : '')}</span><bdi className="mono dim" dir="ltr" title={r.hash}>{r.hash.slice(0, 12)}</bdi></li>)}
            {p.outcomes.map((o) => <li key={`o${o.seq}`}><b>{OUT_HE[o.st]}</b><span className="num">{pubLabel(o.date)}</span><span>{o.note}</span></li>)}</ul>}
      </Panel>
    </div>
  );
}

/** the company home block: the company's positions, only when it has one */
export function PositionsBlock({ id }: { id: string }) {
  const { data: F } = usePositions();
  const ps = (F?.positions ?? []).filter((p) => p.company.includes(id));
  if (!F || !ps.length) return null;
  return (
    <Panel title="עמדות" className="ps-block" aside={<Link className="ps-all" to={`/positions?co=${id}`}>ספר העמדות</Link>}>
      <ul className="ps-closed">{ps.map((p) => (
        <li key={p.id}><StateTag p={p} />{p.status === 'draft' && <span className="chip ps-draft">טיוטה</span>}<span className="dim">ביטחון {CONF_HE[p.confidence]} · אופק <span className="num">{pubLabel(p.horizon)}</span></span>
          <Link className="ps-claim" to={`/positions/${p.id}`}>{p.claim}</Link><span className="dim">{companiesHe(F, p)} · סקירה <span className="num">{pubLabel(p.next_review)}</span> · <FalsSummary p={p} /> · <DriftMark p={p} /></span></li>))}</ul>
    </Panel>
  );
}
