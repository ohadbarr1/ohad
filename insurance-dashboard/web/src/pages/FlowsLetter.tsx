import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Chart } from '../components/Chart';
import { IdDot } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { NumText } from '../components/NumText';
import { RegSrc } from '../components/RegSrc';
import { Empty, Kpi, Loading, Panel, Pick } from '../components/ui';
import { useOptional, useClosed } from '../lib/fundsLoad';
import { useFunds, useLoad } from '../lib/useData';
import { foxOption } from '../lib/foxchart';
import { cssColor, palette } from '../lib/theme';
import { nf } from '../lib/format';
import type { Prov } from '../lib/prov';
import { monthPath, ym, type FlowsMonth } from '../lib/flows';
import { UNDER_PATH, aumProv, costProv, flowProv, gapProv, ilsM, pointProv, rowsOf, underMonthPath, type UnderFile, type UnderMonth } from '../lib/under';
import { LetterSrc, citeOf, dmy, letterIndexPath, letterPath, sgn, type LAcross, type Letter, type LetterIndex } from '../lib/flowsLetter';
import '../styles/lens.css';
import '../styles/flows.css';

/* P3 (fox 3.0 phase 1) · /flows/letter/:yyyymm "מכתב התזרימים": one letter per regulator month, built by pipeline/build_flows_letter.py the
   day the month lands. Citable: a version stamp, the figures that moved since the previous version, a permalink per version (?v=n), a
   chart that exports with its source bar, and one line to quote. Every figure opens the cells and tracks behind it. /flows/letter = the latest. */

export function FlowsLetter() {
  const ix = useOptional<LetterIndex>(letterIndexPath);
  const { ym: param } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const p = ix ? (ix.letters.some((l) => String(l.p) === param) ? Number(param) : param ? -1 : ix.latest) : null;
  const meta = ix?.letters.find((l) => l.p === p);
  const asked = Number(sp.get('v'));
  const ver = meta ? (asked >= 1 && asked <= meta.ver ? asked : meta.ver) : null;
  const cur = useLoad<Letter>(meta ? letterPath(meta.p) : null);
  const old = useLoad<Letter>(meta && ver && ver < meta.ver ? letterPath(meta.p, ver) : null);
  if (ix === undefined) return <Loading what="מכתב התזרימים" />;
  if (ix === null) return <Empty title="מכתב התזרימים לא פורסם עדיין" icon="funds" />;
  if (p === -1 || !meta) return <Empty title={`אין מכתב לחודש ${param ?? ''}`} icon="funds"><Link className="sv-u" to="/flows/letter">למכתב האחרון</Link></Empty>;
  const L = ver && ver < meta.ver ? old.data : cur.data;
  if (cur.error || old.error) return <Empty title="המכתב לא נטען" icon="funds">{cur.error ?? old.error}</Empty>;
  if (!L || !cur.data) return <Loading what="מכתב התזרימים" />;
  const go = (q: number, v?: number) => nav(`/flows/letter/${q}${v ? `?v=${v}` : ''}`);
  return <Page L={L} latest={cur.data} ix={ix} go={go} />;
}

function Page({ L, latest, ix, go }: { L: Letter; latest: Letter; ix: LetterIndex; go: (p: number, v?: number) => void }) {
  const B = L.body, p = L.p;
  const month = useLoad<FlowsMonth>(monthPath(p)).data;
  const F = useFunds().data, C = useClosed();
  const names = useMemo(() => { const m = new Map<string, string>(); F?.funds.forEach((f) => m.set(f.k, f.name)); C?.forEach((f) => m.set(f.k, f.name)); return m; }, [F, C]);
  const src = useMemo(() => new LetterSrc(L, month ?? null, (k) => names.get(k) ?? k), [L, month, names]);
  const ver = L.ver, V = latest.versions.find((v) => v.ver === ver) ?? L.versions[L.versions.length - 1];
  const isLatest = ver === latest.ver;
  const cite = citeOf(L, ver, V.built);
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(`${cite.text} ${cite.url}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); };
  const S = (v: number | null | undefined, s: () => Prov, d = 0) => (v == null ? <span className="lens-dash">–</span> : <Sourced src={s}><span className="num">{sgn(v, d)}</span></Sourced>);
  const groups = B.across.filter((r) => r.comp !== 0 || r.tr !== 0);
  const pal = palette();
  const monthOpts: [string, string][] = ix.letters.map((l) => [String(l.p), ym(l.p)]);
  const verOpts: [string, string][] = latest.versions.map((v) => [String(v.ver), `גרסה ${v.ver} · ${dmy(v.built)}`]);
  const W = B.winner, Lo = B.loser;
  const who = (g: string, since?: number) => <>{g}{since ? <span className="flows-new"> (במוצר מ-<span className="num">{ym(since)}</span>)</span> : null}</>;
  return (
    <div className="flows-letter">
      <FundsHead title={`מכתב התזרימים · ${ym(p)}`}
        sub={<>{B.src_short} · {B.received ? <>התקבל <span className="num">{dmy(B.received)}</span> · </> : null}גרסה <span className="num">{ver}</span>, נבנתה <span className="num">{dmy(V.built)}</span> · מיליוני ש"ח · <Link className="sv-u" to={`/flows?m=${p}`}>הטבלה המלאה</Link></>}
        tools={<>
          {monthOpts.length > 1 && <Pick label="חודש" cap="חודש" value={String(p)} onChange={(v) => go(Number(v))} options={monthOpts} />}
          {verOpts.length > 1 && <Pick label="גרסה" cap="גרסה" value={String(ver)} onChange={(v) => go(p, Number(v) === latest.ver ? undefined : Number(v))} options={verOpts} />}
        </>} />

      {!isLatest && <p className="flows-old" role="note">זו גרסה <span className="num">{ver}</span> של המכתב, כפי שפורסמה ב-<span className="num">{dmy(V.built)}</span>. הגרסה הנוכחית: <button type="button" className="linkbtn sv-u" onClick={() => go(p)}>גרסה {latest.ver}</button>.</p>}

      <Panel className="flows" title="השורה התחתונה" aside={<span>{ym(p)}</span>}>
        <ul className="flows-head" data-testid="letter-headline">{B.headline.map((t, i) => <li key={i}><NumText t={t} /></li>)}</ul>
        <section className="kpis">
          <Kpi label={<>הוביל בניוד התחרותי · {W.grp}</>} value={S(W.comp, () => src.across(W, 'comp'))} sub="כל מוצרי הגמל והפנסיה" />
          {Lo && <Kpi label={<>האחרון בניוד התחרותי · {Lo.grp}</>} value={S(Lo.comp, () => src.across(Lo, 'comp'))} sub="כל מוצרי הגמל והפנסיה" />}
          <Kpi label="סך הניוד נטו, כל הגופים" value={S(B.total.tr, () => src.total('tr'))} sub={<>מזה לברירת מחדל <Sourced src={() => src.total('dt')}><span className="num">{sgn(B.total.dt)}</span></Sourced></>} />
          <Kpi label="נדידה פנימית, קוזזה" value={<Sourced src={() => src.total('mig')}><span className="num">{nf(B.total.mig, 0)}</span></Sourced>} sub="בין מסלולים של אותה קבוצה; לא נספרת" />
        </section>
      </Panel>

      <Panel title={`ניוד נטו לפי קבוצה, מפורק · ${ym(p)}`} aside={<span>כל מוצרי הגמל והפנסיה · מיליוני ש"ח</span>}>
        <Chart label={`ניוד נטו לפי קבוצה, מפורק · ${ym(p)}`} height={340} deps={[p, ver, groups.length]} exportName={`fox-flows-letter-${p}-v${ver}`} asof={ym(p)}
          source={`${B.src_short} · עיבוד fox, מכתב התזרימים ${ym(p)}, גרסה ${ver}`}
          build={() => foxOption({ x: groups.map((r) => r.grp), unit: 'מיליוני ש"ח', legend: true, total: true, rotate: 30,
            series: [
              { name: 'ניוד תחרותי', kind: 'bar' as const, stack: true, color: cssColor('--accent'), dec: 0, data: groups.map((r) => r.comp) },
              { name: 'לקרנות ברירת מחדל', kind: 'bar' as const, stack: true, color: pal[2 % pal.length], dec: 0, data: groups.map((r) => r.dt) },
              { name: 'סגירת מסלולים', kind: 'bar' as const, stack: true, color: pal[4 % pal.length], dec: 0, data: groups.map((r) => r.cl) },
            ] })} />
        <p className="fnote">עמודה = ניוד נטו של הקבוצה, סכום כל המוצרים: ניוד תחרותי + לקרנות ברירת מחדל + סגירת מסלולים. נדידה פנימית אינה בעמודה: היא מתקזזת בסכום הקבוצה (בטבלה).</p>
        <div className="scroll" tabIndex={0} role="region" aria-label="טבלה, גלילה לרוחב"><table className="lens-tbl flows-ltbl">
          <thead><tr><th>קבוצה</th><th>ניוד תחרותי</th><th>לקרנות ברירת מחדל</th><th>סגירת מסלולים</th><th>ניוד נטו</th><th>נדידה פנימית, קוזזה</th><th className="wide-only">צבירה אורגנית</th><th className="wide-only">צבירה נטו</th></tr></thead>
          <tbody>{B.across.map((r: LAcross) => (
            <tr key={r.grp}><td className="lbl"><span className="lens-mgr nc-mgr"><IdDot grp={r.grp} />{r.grp}</span></td>
              <td>{S(r.comp, () => src.across(r, 'comp'))}</td><td>{S(r.dt, () => src.across(r, 'dt'))}</td><td>{S(r.cl, () => src.across(r, 'cl'))}</td>
              <td>{S(r.tr, () => src.across(r, 'tr'))}</td><td><Sourced src={() => src.across(r, 'mig')}><span className="num">{nf(r.mig, 0)}</span></Sourced></td>
              <td className="wide-only">{S(r.org, () => src.across(r, 'org'))}</td><td className="wide-only">{S(r.net, () => src.across(r, 'net'))}</td></tr>))}
            <tr className="tot"><td>כל הגופים</td><td>{S(B.total.comp, () => src.total('comp'))}</td><td>{S(B.total.dt, () => src.total('dt'))}</td><td>{S(B.total.cl, () => src.total('cl'))}</td>
              <td>{S(B.total.tr, () => src.total('tr'))}</td><td><Sourced src={() => src.total('mig')}><span className="num">{nf(B.total.mig, 0)}</span></Sourced></td><td className="wide-only" /><td className="wide-only" /></tr>
          </tbody>
        </table></div>
        <div className="fnote">בלי {'"'}קרנות ענפיות ואחרות{'"'} בשורות הקבוצות (אינן קבוצה אחת); הן בשורת כל הגופים. מוצרים: {B.prods.map((x) => x.label).join(', ')}.</div>
      </Panel>

      <Panel title={`לפי מוצר · ${ym(p)}`} aside={<span>מיליוני ש"ח</span>}>
        <div className="scroll" tabIndex={0} role="region" aria-label="טבלה, גלילה לרוחב"><table className="lens-tbl flows-ltbl">
          <thead><tr><th>מוצר</th><th>מוביל</th><th>ניוד תחרותי</th><th>אחרון</th><th>ניוד תחרותי</th><th className="wide-only">ניוד נטו, כל הגופים</th><th className="wide-only">לקרנות ברירת מחדל</th><th className="wide-only">סגירת מסלולים</th><th className="wide-only">נדידה פנימית</th></tr></thead>
          <tbody>{B.prods.map((x) => (
            <tr key={x.id}><td className="lbl"><Link className="sv-u" to={`/flows?prod=${x.id}&m=${p}`}>{x.label}</Link></td>
              <td>{x.top ? who(x.top.grp, x.top.since) : '–'}</td><td>{x.top ? S(x.top.comp, () => src.cell(x.id, x.top!.grp, 'comp', x.top!.comp)) : '–'}</td>
              <td>{x.low ? who(x.low.grp, x.low.since) : '–'}</td><td>{x.low ? S(x.low.comp, () => src.cell(x.id, x.low!.grp, 'comp', x.low!.comp)) : '–'}</td>
              <td className="wide-only">{S(x.tot.tr, () => src.cell(x.id, 'tot', 'tr', x.tot.tr ?? null))}</td>
              <td className="wide-only">{S(x.tot.dt, () => src.cell(x.id, 'tot', 'dt', x.tot.dt ?? null))}</td>
              <td className="wide-only">{S(x.tot.cl, () => src.cell(x.id, 'tot', 'cl', x.tot.cl ?? null))}</td>
              <td className="wide-only">{x.tot.mig == null ? '–' : <Sourced src={() => src.cell(x.id, 'tot', 'mig', x.tot.mig ?? null)}><span className="num">{nf(x.tot.mig, 0)}</span></Sourced>}</td></tr>))}</tbody>
        </table></div>
        {B.tenders.length > 0 && <div className="fnote">קרנות ברירת מחדל בחודש זה (פנסיה מקיפה): {B.tenders.map((t) => `${t.label} (${ym(t.from)}–${ym(t.to)}): ${t.winners.join(', ')}`).join('; ')}.</div>}
      </Panel>

      {B.under && <UnderPart p={p} names={names} />}

      <Panel title="ההגדרות של fox" className="flows-defs">
        <dl className="flows-dl">{B.defs.fox.map((x) => <div key={x.k}><dt>{x.he}</dt><dd>{x.def}.</dd></div>)}</dl>
        <h3 className="flows-h3">לפני שמשווים ל{'"'}העברות נטו{'"'} בפרסום אחר</h3>
        <ol className="flows-cov">{B.defs.compare.map((t, i) => <li key={i}>{t}</li>)}</ol>
        <div className="fnote">{B.coverage.group}. <Link className="sv-u" to="/methodology#flows">הגדרות התזרימים</Link>.</div>
      </Panel>

      <Panel title="ציטוט וגרסה" className="flows-cite">
        <p className="flows-citeline" data-testid="letter-cite"><b>איך לצטט:</b> <span>{cite.text} <bdi dir="ltr">{cite.url}</bdi></span> <button type="button" className="chip" onClick={copy}>{copied ? 'הועתק' : 'העתקה'}</button></p>
        <ul className="flows-cov">
          <li>גרסה <span className="num">{ver}</span> מתוך <span className="num">{latest.ver}</span> · נבנתה <span className="num">{dmy(V.built)}</span> · hash <span className="mono">{V.hash.slice(0, 12)}</span> · קישור קבוע: <Link className="sv-u" to={`/flows/letter/${p}?v=${ver}`}><bdi dir="ltr">/flows/letter/{p}?v={ver}</bdi></Link></li>
          <li>גרסה חדשה נוצרת רק כשמספר במכתב משתנה (הרשות מעדכנת את קבצי החודש); גרסה קודמת נשמרת כפי שפורסמה. המכתב נבנה מחדש כל עוד {ym(p)} הוא החודש האחרון של הרשות.</li>
        </ul>
        <p className="fnote" data-testid="letter-src"><RegSrc ds={['gemelnet', 'pensia-net']} table={[`/flows?m=${p}`, `טבלת התזרימים ${ym(p)}`]} />.</p>
        {V.changes.length > 0 ? <>
          <h3 className="flows-h3">מה השתנה מגרסה {ver - 1}</h3>
          <div className="scroll" tabIndex={0} role="region" aria-label="טבלה, גלילה לרוחב"><table className="lens-tbl flows-ltbl"><thead><tr><th>מספר</th><th>גרסה {ver - 1}</th><th>גרסה {ver}</th></tr></thead>
            <tbody>{V.changes.map((c) => <tr key={c.k}><td className="lbl">{c.l}</td><td><span className="num">{c.a == null ? '–' : nf(c.a, 1)}</span></td><td><span className="num">{c.b == null ? '–' : nf(c.b, 1)}</span></td></tr>)}</tbody></table></div>
        </> : <p className="flows-cov">{ver === 1 ? 'גרסה ראשונה: אין גרסה קודמת.' : 'אין שינוי במספרים מהגרסה הקודמת.'}</p>}
      </Panel>
    </div>
  );
}

/** "ברבעון התחתון ועדיין מקבלים כסף" of the letter's month: the figures and the largest five, each opening its calculation (under.json) */
function UnderPart({ p, names }: { p: number; names: Map<string, string> }) {
  const U = useOptional<UnderFile>(UNDER_PATH);
  const M = useLoad<UnderMonth>(U && U.asof === p ? underMonthPath(p) : null).data;
  const rows = useMemo(() => (U ? rowsOf(U) : []), [U]);
  if (!U || U.asof !== p) return null;
  const S = U.series, j = U.months.length - 1;
  const name = (k: string) => names.get(k) ?? rows.find((r) => r.k === k)?.name ?? k;
  const head = rows.filter((r) => r.head).sort((a, b) => b.cost - a.cost).slice(0, 5);
  const kpi = (what: 'cost' | 'a' | 'fl', text: string) => (M && M.p === p ? <Sourced src={() => pointProv(U, M, name, what)}><span className="num">{text}</span></Sourced> : <span className="num">{text}</span>);
  const yi = j - 12, yoy = yi >= 0 && U.cov[yi]?.length === U.cov[j]?.length;
  return (
    <Panel title={`ברבעון התחתון, ועדיין מקבלים כסף · ${ym(p)}`} aside={<Link className="sv-u" to="/funds/under">הרשימה המלאה</Link>}>
      <section className="kpis">
        <Kpi label="מסלולים ברשימה" value={kpi('cost', String(S.n[j]))} sub={<>רבעון תחתון (5 שנים, נטו) מתוך <span className="num">{S.n_rk[j]}</span> מדורגים</>} />
        <Kpi label="נכנס ב-12 החודשים" value={kpi('fl', ilsM(S.fl[j]))} sub="בלי נדידה פנימית" />
        <Kpi label="עלות הפער בשנה" value={kpi('cost', ilsM(S.cost[j]))} sub={yoy ? <>לפני שנה: <span className="num">{ilsM(S.cost[yi])}</span></> : 'נכסים × פער מהחציון, אומדן'} />
      </section>
      <div className="scroll" tabIndex={0} role="region" aria-label="טבלה, גלילה לרוחב"><table className="lens-tbl flows-ltbl">
        <thead><tr><th>מסלול</th><th className="wide-only">קבוצה</th><th>נכסים</th><th>פער מהחציון, נ"א</th><th>עלות הפער בשנה</th><th>צבירה נטו 12M, בלי נדידה</th></tr></thead>
        <tbody>{head.map((r) => (
          <tr key={r.k}><td className="lbl"><Link className="sv-u" to={`/funds/${r.k}`}>{r.name}</Link>{r.mig ? <span className="chip est mig">נדידה</span> : null}</td><td className="wide-only">{r.grp}</td>
            <td><Sourced src={() => aumProv(U, r)}><span className="num">{nf(r.a, 0)}</span></Sourced></td>
            <td><Sourced src={() => gapProv(U, r, rows)}><span className="num">{nf(r.gap, 2)}</span></Sourced></td>
            <td><Sourced src={() => costProv(U, r, rows)}><span className="num">{nf(r.cost, 1)}</span></Sourced></td>
            <td><Sourced src={() => flowProv(U, r)}><span className="num">{sgn(r.c12)}</span></Sourced></td></tr>))}</tbody>
      </table></div>
      <div className="fnote">{U.method.past}. <RegSrc table={['/funds/under', 'הרשימה המלאה']} />.</div>
    </Panel>
  );
}
