import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { ltsProv, warmRep } from '../lib/lens';
import { fmt, fmtS, toProv, type LtsResolver } from '../lib/drivers';
import type { Prov } from '../lib/prov';
import {
  BANDS, BAND_HE, REG_PATH, SEG_HE, STATUS_HE, TYPE_HE, dlab, exposureProv, impactProv, pctProv, srcProv,
  type Band, type Exposure, type Impact, type Initiative, type RegFile, type Status,
} from '../lib/regulation';
import '../styles/regulation.css';
import { WarTabs } from '../components/WarTabs';

/* A8 · /warroom/regulation: the tracked pipeline of Capital Market Authority and Ministry of Finance initiatives, each modelled as a shock
   through the A1 driver graph (pipeline/build_regulation.py → regulation/impact.json). The register, the impact per initiative per manager
   (low / central / high), and the exposure to the whole pipeline weighted by stage (an assumption, every weight shown). Every figure opens
   its source. Reached from /warroom, /savings and search; not a nav item. */

const lts: LtsResolver = (j) => ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
function ltsCos(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => ltsCos(y, out));
  else if (x && typeof x === 'object') { const o = x as Record<string, unknown>; if (o.k === 'lts' && typeof o.c === 'string') out.add(o.c); Object.values(o).forEach((y) => ltsCos(y, out)); }
  return out;
}
const tone = (v: number) => (v < -0.005 ? 'neg' : v > 0.005 ? 'pos' : '');
const d1 = (v: number) => (Math.abs(v) >= 10 || v === 0 ? 1 : 2);
const STAT_CLS: Record<Status, string> = { proposal: 'prop', consultation: 'cons', approved: 'appr', in_force: 'force' };

function Bar({ v, max }: { v: number; max: number }) {
  const w = max > 0 ? Math.min(100, Math.abs(v) / max * 100) : 0;
  return <span className="rg-bar" aria-hidden="true"><span className={tone(v)} style={{ width: `${w}%` }} /></span>;
}

function Num({ v, src, unit = '' }: { v: number; src: () => Prov; unit?: string }) {
  return <Sourced src={src} className={tone(v)}>{fmtS(v, d1(v))}{unit}</Sourced>;
}

/* ---------- the exposure to the whole pipeline ---------- */
function ExposureList({ f, band, phone }: { f: RegFile; band: Band; phone: boolean }) {
  const rows = f.exposure;
  const max = Math.max(...rows.map((e) => Math.abs(e.d[band])), 0);
  const pct = (e: Exposure) => {
    const m = f.managers[e.c];
    if (!e.pct_np || !m.np) return <span className="dim">–</span>;
    return <Num v={e.pct_np[band]} unit="%" src={() => pctProv('חשיפה לצנרת כולה', m, e.net[band], e.pct_np![band], () => exposureProv(f, e, band, lts, true), lts)} />;
  };
  if (phone) return (
    <ol className="rg-rank">{rows.map((e, i) => { const m = f.managers[e.c]; return (
      <li key={e.c}>
        <div className="rg-rk-h"><span className="rg-n num">{i + 1}</span><Link to={`/company/${e.c}`}>{m.name}</Link></div>
        <div className="rg-rk-v"><span className="dim">לפני מס</span> <Num v={e.d[band]} src={() => exposureProv(f, e, band, lts)} />
          <span className="dim">אחרי מס</span> <Num v={e.net[band]} src={() => exposureProv(f, e, band, lts, true)} />
          <span className="dim">מהרווח</span> {pct(e)}</div>
        <Bar v={e.d[band]} max={max} />
      </li>); })}</ol>
  );
  return (
    <table className="rg-t">
      <thead><tr><th scope="col">#</th><th scope="col">מנהל</th><th scope="col">Δ רווח לפני מס</th><th scope="col">Δ אחרי מס</th><th scope="col">% מהרווח הנקי LTM</th><th scope="col">טווח נמוך עד גבוה</th><th scope="col"><span className="sr">עוצמה</span></th></tr></thead>
      <tbody>{rows.map((e, i) => { const m = f.managers[e.c]; return (
        <tr key={e.c}>
          <td className="num rg-i">{i + 1}</td>
          <td className="lbl"><Link to={`/company/${e.c}`}>{m.name}</Link></td>
          <td className="v"><Num v={e.d[band]} src={() => exposureProv(f, e, band, lts)} /></td>
          <td className="v"><Num v={e.net[band]} src={() => exposureProv(f, e, band, lts, true)} /></td>
          <td className="v">{pct(e)}</td>
          <td className="rg-rng"><Sourced src={() => exposureProv(f, e, 'low', lts)}>{fmtS(e.d.low, d1(e.d.low))}</Sourced> <span className="dim">עד</span> <Sourced src={() => exposureProv(f, e, 'high', lts)}>{fmtS(e.d.high, d1(e.d.high))}</Sourced></td>
          <td className="rg-bc"><Bar v={e.d[band]} max={max} /></td>
        </tr>); })}</tbody>
    </table>
  );
}

/* ---------- the register ---------- */
function SourceLinks({ ini }: { ini: Initiative }) {
  return (
    <ul className="rg-srcs">{ini.sources.map((s, i) => (
      <li key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="dim">· {s.doc}{s.pg ? <> · עמ׳ <span className="num">{s.pg}</span></> : null} · נשלף <span className="num">{dlab(s.retrieved)}</span></span></li>))}</ul>
  );
}

function Register({ f }: { f: RegFile }) {
  return (
    <ol className="rg-reg">{f.initiatives.map((ini) => (
      <li key={ini.id} id={`ini-${ini.id}`}>
        <div className="rg-reg-h">
          <span className={`rg-st ${STAT_CLS[ini.status]}`}>{STATUS_HE[ini.status]}</span>
          <span className="chip">{TYPE_HE[ini.type]}</span>
          <span className="dim">{ini.regulator}</span>
          <span className="rg-w">משקל <span className="num">{fmt(ini.w, 2)}</span> <span className="chip est">הנחה</span></span>
        </div>
        <h3>{ini.title}</h3>
        <dl className="rg-dates">
          {ini.dates.map((d, i) => <div key={i}><dt className="num">{dlab(d.d)}</dt><dd><Sourced src={() => srcProv(ini, d.src, d.he, dlab(d.d))}>{d.he}</Sourced></dd></div>)}
          {ini.next && <div className="next"><dt className="num">{dlab(ini.next.d)}</dt><dd><Sourced src={() => srcProv(ini, ini.next!.src, ini.next!.he, dlab(ini.next!.d))}>{ini.next.he}</Sourced></dd></div>}
          {!ini.next && <div className="next"><dt>מועד צפוי</dt><dd className="dim">לא נקבע במסמך</dd></div>}
        </dl>
        <ul className="rg-facts">{ini.facts.map((x, i) => <li key={i}><Sourced src={() => srcProv(ini, x.src, x.he, '')}>{x.he}</Sourced></li>)}</ul>
        <div className="rg-model"><b>מודל:</b> {ini.model.he}{ini.model.kind === 'none' && ini.model.why ? <span className="dim"> · {ini.model.why}</span> : null}</div>
        {ini.model.params.length > 0 && <ul className="rg-params">{ini.model.params.map((q) => (
          <li key={q.k}><span>{q.he}</span>
            {q.low != null && <span className="num rg-pv">{BANDS.map((b) => fmt(q[b]!, q[b]! % 1 ? 2 : 0)).join(' / ')}{q.unit === '%' ? '%' : q.unit ? ` ${q.unit}` : ''}</span>}
            {q.split && <span className="num rg-pv">{Object.entries(q.split).map(([c, v]) => `${f.managers[c]?.name ?? c} ${v}%`).join(' · ')}</span>}
            {q.src === 'assumption' ? <span className="chip est">הנחה</span> : q.src === 'source' ? <span className="chip pass">מהמסמך</span> : <span className="chip">נתוני הרשות</span>}
            {q.why && <span className="dim rg-why">{q.why}</span>}
          </li>))}</ul>}
        <SourceLinks ini={ini} />
      </li>))}</ol>
  );
}

/* ---------- one initiative, every manager ---------- */
function ImpactList({ f, ini, band, phone }: { f: RegFile; ini: Initiative; band: Band; phone: boolean }) {
  const rows = useMemo(() => [...ini.impacts].sort((a, b) => a.d[band] - b.d[band] || a.c.localeCompare(b.c)), [ini, band]);
  const max = Math.max(...rows.map((x) => Math.abs(x.d[band])), 0);
  const m = (x: Impact) => f.managers[x.c];
  const pct = (x: Impact) => (x.pct_np && m(x).np ? <Num v={x.pct_np[band]} unit="%" src={() => pctProv(ini.short, m(x), x.net[band], x.pct_np![band], () => impactProv(ini, m(x), x, band, lts, true), lts)} /> : <span className="dim">–</span>);
  const aum = (x: Impact) => <Sourced src={() => impactAumProv(ini, f, x, band)} className={tone(x.aum[band])}>{fmtS(x.aum[band] / 1000, 2)}</Sourced>;
  if (phone) return (
    <ol className="rg-rank">{rows.map((x, i) => (
      <li key={x.c}>
        <div className="rg-rk-h"><span className="rg-n num">{i + 1}</span><Link to={`/company/${x.c}`}>{m(x).name}</Link><span className="dim rg-prods">{x.products.map((p) => SEG_HE[p.s]).join(' · ')}</span></div>
        <div className="rg-rk-v"><span className="dim">לפני מס</span> <Num v={x.d[band]} src={() => impactProv(ini, m(x), x, band, lts)} />
          <span className="dim">אחרי מס</span> <Num v={x.net[band]} src={() => impactProv(ini, m(x), x, band, lts, true)} />
          <span className="dim">מהרווח</span> {pct(x)}<span className="dim">Δ נכסים, מיליארד</span> {aum(x)}</div>
        <Bar v={x.d[band]} max={max} />
      </li>))}</ol>
  );
  return (
    <table className="rg-t">
      <thead><tr><th scope="col">#</th><th scope="col">מנהל</th><th scope="col">מוצרים</th><th scope="col">Δ רווח לפני מס</th><th scope="col">Δ אחרי מס</th><th scope="col">% מהרווח הנקי LTM</th><th scope="col">Δ נכסים, מיליארד ש"ח</th><th scope="col"><span className="sr">עוצמה</span></th></tr></thead>
      <tbody>{rows.map((x, i) => (
        <tr key={x.c}>
          <td className="num rg-i">{i + 1}</td>
          <td className="lbl"><Link to={`/company/${x.c}`}>{m(x).name}</Link></td>
          <td className="rg-i rg-prods">{x.products.map((p) => SEG_HE[p.s]).join(' · ')}</td>
          <td className="v"><Num v={x.d[band]} src={() => impactProv(ini, m(x), x, band, lts)} /></td>
          <td className="v"><Num v={x.net[band]} src={() => impactProv(ini, m(x), x, band, lts, true)} /></td>
          <td className="v">{pct(x)}</td>
          <td className="v">{aum(x)}</td>
          <td className="rg-bc"><Bar v={x.d[band]} max={max} /></td>
        </tr>))}</tbody>
    </table>
  );
}
function impactAumProv(ini: Initiative, f: RegFile, x: Impact, band: Band): Prov {
  const m = f.managers[x.c];
  return { k: 'calc', title: `${ini.short} · ${m.name} · Δ נכסים · תרחיש ${BAND_HE[band]}`, value: `${fmtS(x.aum[band] / 1000, 2)} מיליארד ש"ח`, unit: 'לשנה', est: true,
    formula: 'Σ ΔAUM לכל מוצר = נכסים ממוצעים × זעזוע הצבירה', inputs: x.products.map((p) => ({ label: SEG_HE[p.s], v: fmtS(p.d[band].dA, 1), src: () => toProv(m.products[p.s].A.p, lts) })) };
}

export function WarRoomRegulation() {
  const F = useLoad<RegFile>(REG_PATH);
  const phone = usePhone();
  const [sp, setSp] = useSearchParams();
  const f = F.data;
  useEffect(() => { if (f) ltsCos(f.managers).forEach((c) => warmRep(c)); }, [f]);
  const band = (BANDS as readonly string[]).includes(sp.get('b') ?? '') ? (sp.get('b') as Band) : 'central';
  const modelled = f?.initiatives.filter((i) => i.impacts.length) ?? [];
  const pick = modelled.find((i) => i.id === sp.get('i')) ?? modelled.find((i) => i.status !== 'in_force') ?? modelled[0];
  const set = (k: string, v: string) => setSp((q) => { const n = new URLSearchParams(q); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  if (F.error) return <ErrorBox what="צנרת הרגולציה" error={F.error} />;
  if (!f) return <Loading what="צנרת הרגולציה" />;
  const W = f.meta.weights;
  const bandSeg = <Seg<Band> label="תרחיש" value={band} onChange={(b) => set('b', b === 'central' ? '' : b)} options={BANDS.map((b) => [b, BAND_HE[b]])} />;
  return (
    <div className="rg">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="shield" /></span>צנרת רגולציה: השפעה לפי מנהל</h1>
        <div className="sub">רשות שוק ההון ומשרד האוצר · <span className="num">{f.initiatives.length}</span> יוזמות, <span className="num">{modelled.length}</span> ממודלות דרך גרף המנגנונים · בסיס <span className="num">{f.meta.base.q}</span>, LTM <span className="num">{f.meta.base.ltm[0]}–{f.meta.base.ltm[3]}</span> · מיליוני ש"ח לשנה, קצב שנתי · מקורות נשלפו <span className="num">{dlab(f.meta.retrieved)}</span></div>
      </div>{bandSeg}</div>
      <WarTabs />

      <Panel title="חשיפה לצנרת כולה" aside={<span className="rg-ws">משקל לפי שלב <span className="chip est">הנחה</span> {(Object.keys(STATUS_HE) as Status[]).map((s) => <span key={s} className="rg-wi">{STATUS_HE[s]} <span className="num">{fmt(W[s], 2)}</span></span>)}</span>}>
        <ExposureList f={f} band={band} phone={phone} />
        <p className="rg-foot">Σ משקל × השפעה. יוזמה בתוקף כבר בבסיס ה-LTM ומשקלה 0. <span className="chip est">אומדן</span> תרחיש {BAND_HE[band]}; כל פרמטר מסומן הנחה או מקור ונפתח בלחיצה.</p>
      </Panel>

      <Panel title="השפעה לפי יוזמה" aside={pick ? <span>{STATUS_HE[pick.status]} · משקל <span className="num">{fmt(pick.w, 2)}</span> · סה"כ {BAND_HE[band]} <span className={`num ${tone(pick.total?.[band] ?? 0)}`}>{fmtS(pick.total?.[band] ?? 0, 1)}</span></span> : null}>
        {pick ? <>
          <div className="rg-pick" role="group" aria-label="יוזמה">{modelled.map((i) => (
            <button key={i.id} type="button" className="chip" aria-pressed={i.id === pick.id} onClick={() => set('i', i.id)}>{i.short}</button>))}</div>
          <div className="rg-model-l"><b>מודל:</b> {pick.model.he} <a href={`#ini-${pick.id}`}>המסמך והפרמטרים</a></div>
          <ImpactList f={f} ini={pick} band={band} phone={phone} />
          {pick.impacts.some((x) => x.flags.length) && <ul className="rg-flags">{pick.impacts.flatMap((x) => x.flags.map((fl, i) => <li key={`${x.c}${i}`}>{f.managers[x.c].name}: {fl}</li>))}</ul>}
        </> : <Empty title="אין יוזמה ממודלת" />}
      </Panel>

      <Panel title="רשימת היוזמות" aside={<span>מסמך ציבורי של הרשות או משרד האוצר לכל יוזמה · עמוד · תאריך שליפה</span>}>
        <Register f={f} />
      </Panel>

      <p className="rg-foot">לא נכללו: {f.meta.excluded.map((x) => `${x.name} (${x.why})`).join(' · ')}. {f.meta.units}.</p>
    </div>
  );
}
