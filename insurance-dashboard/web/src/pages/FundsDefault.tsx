import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Sourced } from '../components/Source';
import { MgrChip } from '../components/MgrChip';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { fundP, monthIn } from '../lib/market';
import type { Prov } from '../lib/prov';
import { nf } from '../lib/format';
import { useFunds } from '../lib/useData';
import { grossProv, netProv, refOf, retOf, ym, type FundX, type FundsFile, type Per } from '../lib/funds';
import { addM, median, monthDiff, monthsFromTo } from '../lib/fundsCalc';
import { isoYm, priceOf, tenderAt, tendersOf, type DefaultFile, type DfRow, type Tender } from '../lib/fundsTools';
import { useHists, useOptional } from '../lib/fundsLoad';
import { winnerTrack } from '../lib/pensionPack';
import { ToolLinks } from './FundsTools';
import { useDoor } from '../lib/door';  // W7
import { EmployerOnboard } from '../components/agent/EmployerOnboard';  // W7: the agent's employer-onboarding mode
import '../styles/lens.css';
import '../styles/fundsTools.css';

/* /funds/default (funds plan #14): the default pension funds (קרנות ברירת מחדל). The tenders of the Capital Market Authority, their
   winners and prices (funds/default.json, curated by F2 DATA, every row with its gov.il source and a verified flag), then what the
   regulator's own files show: the winners' default age tracks against the other comprehensive pension funds on fees and net returns
   today, and the money before vs after the tender (deposits, net transfers, assets) from the monthly track histories. */

const AGE: [string, string][] = [['עד 50', 'עד 50'], ['50-60', '50–60'], ['60 ומעלה', '60+']];
const PROD = 'פנסיה מקיפה';
const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);
const mn = (v: number | null | undefined) => (v == null ? '–' : nf(v, 0));
const dateHe = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

export function FundsDefault() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const [sp, setSp] = useSearchParams();
  const [door] = useDoor();  // W7
  const age = AGE.some(([a]) => a === sp.get('age')) ? sp.get('age')! : 'עד 50';
  const asof = data?.asof ?? 0;
  const ts = tendersOf(dfile);
  const now = asof ? tenderAt(ts, asof) : null;
  const sel = useMemo(() => new Set(now?.winners.map((w) => w.grp) ?? []), [now]);
  const rows = useMemo(() => ((data?.funds ?? []) as FundX[]).filter((f) => f.prod === PROD && f.track === age && f.assets), [data, age]);
  // before vs after: every age track of every comprehensive pension fund, summed per manager
  const ageTracks = useMemo(() => ((data?.funds ?? []) as FundX[]).filter((f) => f.prod === PROD && AGE.some(([a]) => a === f.track) && f.assets), [data]);
  const dataRows: DfRow[] = (dfile?.funds ?? []).filter((r) => now && r.tender === now.id);
  const { hist, pending } = useHists(dataRows.length ? [] : ageTracks.map((f) => f.k));

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || dfile === undefined) return <Loading what="קרנות ברירת מחדל" />;

  /* ---- the windows: after = the tender's first month to the data's last; before = as many months just before it ---- */
  const post = now ? [Math.max(isoYm(now.from), 0), Math.min(asof, isoYm(now.to))] : null;
  const n = post ? monthDiff(post[0], post[1]) + 1 : 0;
  const pre = post ? [addM(post[0], -n), addM(post[0], -1)] : null;
  const grps = [...new Set(ageTracks.map((f) => f.grp))];
  type Agg = { dep: number | null; tr: number | null; a0: number | null; a1: number | null; ks: FundX[] };
  const agg = (grp: string, w: number[]): Agg => {
    const fs = ageTracks.filter((f) => f.grp === grp), ms = monthsFromTo(w[0], w[1]);
    let dep = 0, tr = 0, a0 = 0, a1 = 0, ok = true;
    for (const f of fs) { const h = hist[f.k]; if (!h) { ok = false; continue; }
      const at = (c: 'dep' | 'tr' | 'a', p: number) => { const i = h.p.indexOf(p); return i < 0 ? null : (h[c]?.[i] ?? null); };
      ms.forEach((p) => { dep += at('dep', p) ?? 0; tr += at('tr', p) ?? 0; });
      a0 += at('a', addM(w[0], -1)) ?? 0; a1 += at('a', w[1]) ?? 0; }
    return ok ? { dep, tr, a0: a0 || null, a1: a1 || null, ks: fs } : { dep: null, tr: null, a0: null, a1: null, ks: fs };
  };
  const ba = pre && post && !dataRows.length ? grps.map((g) => ({ grp: g, sel: sel.has(g), pre: agg(g, pre), post: agg(g, post) })) : [];
  const totDep = (w: 'pre' | 'post') => ba.reduce((s, x) => s + (x[w].dep ?? 0), 0);
  const posTr = ba.reduce((s, x) => s + Math.max(0, x.post.tr ?? 0), 0), selTr = ba.filter((x) => x.sel).reduce((s, x) => s + Math.max(0, x.post.tr ?? 0), 0);

  /* ---- sources ---- */
  const sumProv = (x: Agg, grp: string, c: 'dep' | 'tr', w: number[]): Prov => ({ k: 'calc', title: `${c === 'dep' ? 'הפקדות' : 'העברות נטו'} · ${grp} · ${ym(w[0])}–${ym(w[1])}`, value: mn(x[c]), unit: 'מיליוני ש"ח',
    formula: `סכום ${c === 'dep' ? 'ההפקדות החודשיות' : 'ההעברות נטו החודשיות (ניוד פנימה פחות החוצה)'} על החודשים ועל המסלולים התלויי גיל של הקרן (עד 50, 50–60, 60+)`,
    inputs: x.ks.flatMap((f) => monthsFromTo(w[0], w[1]).map((p) => ({ ...monthIn(refOf(f), c, p), label: `${f.track} · ${c === 'dep' ? 'הפקדות' : 'העברות'} · ${ym(p)}` }))) });
  const growProv = (x: Agg, grp: string): Prov => ({ k: 'calc', title: `צמיחת נכסים · ${grp} · ${post ? ym(post[0]) + '–' + ym(post[1]) : ''}`, value: x.a0 && x.a1 ? pc((x.a1 / x.a0 - 1) * 100, 1) : '–', formula: 'נכסי המסלולים התלויי גיל בסוף החלון ÷ בחודש שלפני תחילתו − 1',
    inputs: x.ks.flatMap((f) => [{ ...monthIn(refOf(f), 'a', addM(post![0], -1)), label: `${f.track} · נכסים · ${ym(addM(post![0], -1))}` }, { ...monthIn(refOf(f), 'a', post![1]), label: `${f.track} · נכסים · ${ym(post![1])}` }]) });
  const tenderProv = (t: Tender, what: string, v: string): Prov => ({ k: 'report', title: `${what} · מכרז ${t.id}`, value: v, url: t.src, pg: null, doc: t.src_title ?? 'רשות שוק ההון, ביטוח וחיסכון', period: `${dateHe(t.from)}–${dateHe(t.to)}`, note: t.verified ? t.note : `לא אומת מול המקור הראשי.${t.note ? ' ' + t.note : ''}` });
  const medOf = (fs: FundX[], v: (f: FundX) => number | null) => median(fs.map(v).filter((x): x is number => x != null));
  const medProv = (fs: FundX[], title: string, v: (f: FundX) => number | null, src: (f: FundX) => () => Prov): Prov => ({ k: 'calc', title, value: pc(medOf(fs, v)), formula: 'החציון של המסלולים בקבוצה', inputs: fs.map((f) => ({ label: f.name, v: pc(v(f)), src: src(f) })) });
  const PERS: [Per, string][] = [['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y']];
  const feeSrc = (f: FundX, c: 'fee' | 'depfee') => () => fundP(refOf(f), asof, c === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', c === 'fee' ? 'דמי ניהול מצבירה' : 'דמי ניהול מהפקדה', pc(f[c]));
  const retSrc = (f: FundX, per: Per) => () => (f.net?.[per] != null ? netProv(f, per, asof, f.net[per]!, data.net_method) : grossProv(f, per, asof));
  const groups: [string, FundX[]][] = [['הזוכות במכרז', rows.filter((f) => sel.has(f.grp))], ['שאר הקרנות', rows.filter((f) => !sel.has(f.grp))]];
  const left = now ? monthDiff(asof, isoYm(now.to)) : null;

  return (
    <>
      <FundsHead title="קרנות ברירת מחדל" sub={<>מכרזי רשות שוק ההון לקרנות הפנסיה הנבחרות, ומה הנתונים מראים · נתונים עד {ym(asof)}</>} />
      <ToolLinks />

      {!ts.length ? (
        <Empty title="רשימת המכרזים עוד לא פורסמה" icon="shield">רשימת המכרזים, הזוכות והמחירים נבנית מתוך הודעות הרשות ב-gov.il. עד שתפורסם, ההשוואה למטה אינה יודעת מי זכתה.</Empty>
      ) : (
        <>
          {now && <section className="kpis">
            <div className="kpi"><div className="l">המכרז בתוקף</div><div className="v">{now.label ?? now.id}</div><div className="s num">{dateHe(now.from)}–{dateHe(now.to)}</div></div>
            <div className="kpi"><div className="l">מחיר לעמית חדש <Tip k="depfee" /></div><div className="v num">{now.depfee != null && now.fee != null ? <Sourced src={() => tenderProv(now, 'המחיר במכרז', `${pc(now.depfee)} / ${pc(now.fee)}`)}>{pc(now.depfee)} / {pc(now.fee)}</Sourced> : 'לפי זוכה'}</div><div className="s">מהפקדה / מצבירה{now.fee_years ? ` · ל-${now.fee_years} שנים מההצטרפות` : ''}</div></div>
            <div className="kpi"><div className="l">זוכות</div><div className="v num">{now.winners.length}</div><div className="s">{now.winners.map((w) => w.grp).join(' · ')}</div></div>
            {left != null && left >= 0 && <div className="kpi"><div className="l">עד סוף התקופה</div><div className="v num">{left}</div><div className="s">חודשים מ-{ym(asof)}</div></div>}
          </section>}

          <Panel title="המכרזים" aside={<span>{ts.length} מכרזים · מקור: הודעות הרשות</span>}>
            <div className="ftenders">{ts.map((t) => (
              <article key={t.id} className={`ftender${t === now ? ' now' : ''}`}>
                <h3><span>{t.label ?? `מכרז ${t.id}`}</span><span className="muted num">{dateHe(t.from)}–{dateHe(t.to)}</span></h3>
                <div>{t.depfee != null && t.fee != null ? <>מחיר: <Sourced src={() => tenderProv(t, 'המחיר במכרז', `${pc(t.depfee)} / ${pc(t.fee)}`)}><span className="num">{pc(t.depfee)} מהפקדה · {pc(t.fee)} מצבירה</span></Sourced></> : 'מחיר לפי זוכה'}</div>
                <ul>{t.winners.map((w) => { const p = priceOf(t, w), wv = w.verified ?? t.verified;
                  // W4: the winner's largest open track that is published today (a closed or retired key gave "המסלול לא נמצא"), else no link
                  const to = winnerTrack(w, data.funds as FundX[]);
                  return <li key={w.grp}>{to ? <Link to={`/funds/${to.k}`} title={to.name}>{w.grp}</Link> : w.grp}{(w.fee != null || w.depfee != null) && <> · <Sourced src={() => tenderProv({ ...t, src: w.src ?? t.src, verified: wv }, `המחיר של ${w.grp}`, `${pc(p.depfee)} / ${pc(p.fee)}`)}><span className="num">{pc(p.depfee)} / {pc(p.fee)}</span></Sourced></>}{!wv && <span className="chip est">לא אומת</span>}</li>; })}</ul>
                {t.alloc && <div className="muted">שיבוץ עמיתים: {t.alloc}</div>}
                {t.fee_alt && t.fee_alt.length > 0 && <div className="muted">חלופות מחיר: {t.fee_alt.map((x) => `${nf(x.depfee, 2)}% / ${nf(x.fee, 2)}%`).join(' · ')}</div>}
                <div className="src"><a href={t.src} target="_blank" rel="noreferrer">{t.src_title ?? 'המקור ב-gov.il'}</a>{!t.verified && <span className="chip est">לא אומת</span>}</div>
              </article>))}</div>
            {dfile?.method && <details className="fnote fmethod"><summary>מתודולוגיה</summary>{dfile.method}</details>}
          </Panel>
        </>
      )}

      {door === 'agent' && <EmployerOnboard funds={data.funds as FundX[]} now={now} asof={asof} />}

      <Panel title={<>היום: הזוכות מול שאר הקרנות · {PROD}</>} aside={<><Seg label="מסלול גיל" value={age} onChange={(a) => { const q = new URLSearchParams(sp); q.set('age', a); setSp(q, { replace: true }); }} options={AGE} /><span className="chip est">נטו, אומדן</span></>}>
        <div className="scroll"><table className="fsimple">
          <caption className="sr-only">קרנות פנסיה מקיפה, מסלול {age}: דמי ניהול ותשואה נטו</caption>
          <thead><tr><th scope="col">קרן</th><th scope="col">ד"נ מהפקדה</th><th scope="col">ד"נ מצבירה</th>{PERS.map(([, l]) => <th key={l} scope="col">{l}{l !== 'LTM' ? ', שנתי' : ''}</th>)}<th scope="col">נכסים, מ׳ ש"ח</th><th scope="col">הפקדות נטו LTM</th></tr></thead>
          <tbody>
            {[...rows].sort((a, b) => Number(sel.has(b.grp)) - Number(sel.has(a.grp)) || (b.assets ?? 0) - (a.assets ?? 0)).map((f) => (
              <tr key={f.k} className={sel.has(f.grp) ? 'fsel' : undefined}>
                <td><Link to={`/funds/${f.k}`}>{f.grp}</Link> <MgrChip grp={f.grp} mgr={f.mgr} short />{sel.has(f.grp) && <span className="chip">זוכה {now?.id}</span>}</td>
                <td><Sourced src={feeSrc(f, 'depfee')}><span className="num">{pc(f.depfee)}</span></Sourced></td>
                <td><Sourced src={feeSrc(f, 'fee')}><span className="num">{pc(f.fee)}</span></Sourced></td>
                {PERS.map(([per]) => { const r = retOf(f, per, f.net?.[per] != null ? 'net' : 'gross'); return <td key={per}>{r.v == null ? <span className="muted">–</span> : <Sourced src={retSrc(f, per)}><span className="num">{pc(r.v, 1)}</span></Sourced>}</td>; })}
                <td><Sourced src={() => fundP(refOf(f), asof, 'TOTAL_ASSETS', 'נכסים', nf(f.assets ?? 0, 1), 'מיליוני ש"ח')}><span className="num">{mn(f.assets)}</span></Sourced></td>
                <td>{f.nd12 == null ? <span className="muted">–</span> : <Sourced src={() => ({ k: 'calc', title: `הפקדות נטו, 12 חודשים · ${f.name}`, value: mn(f.nd12), unit: 'מיליוני ש"ח', formula: 'סכום ההפקדות נטו החודשיות (הפקדות פחות משיכות והעברות החוצה, כפי שדווח לרשות) על 12 החודשים האחרונים (מחושב בבניית הנתונים)', inputs: [] })}><span className={`num ${f.nd12 >= 0 ? 'pos' : 'neg'}`}>{mn(f.nd12)}</span></Sourced>}</td>
              </tr>))}
            {sel.size > 0 && groups.map(([l, fs]) => fs.length > 0 && (
              <tr key={l} className="muted"><th scope="row">חציון · {l} ({fs.length})</th>
                <td><Sourced src={() => medProv(fs, `ד"נ מהפקדה, חציון · ${l}`, (f) => f.depfee, (f) => feeSrc(f, 'depfee'))}><span className="num">{pc(medOf(fs, (f) => f.depfee))}</span></Sourced></td>
                <td><Sourced src={() => medProv(fs, `ד"נ מצבירה, חציון · ${l}`, (f) => f.fee, (f) => feeSrc(f, 'fee'))}><span className="num">{pc(medOf(fs, (f) => f.fee))}</span></Sourced></td>
                {PERS.map(([per]) => <td key={per}><Sourced src={() => medProv(fs, `תשואה ${per}, חציון · ${l}`, (f) => f.net?.[per] ?? null, (f) => retSrc(f, per))}><span className="num">{pc(medOf(fs, (f) => f.net?.[per] ?? null), 1)}</span></Sourced></td>)}
                <td /><td />
              </tr>))}
          </tbody>
        </table></div>
        <div className="fnote">דמי הניהול: הממוצע בפועל של המסלול ב-{ym(asof)}, על כל העמיתים בו (גם הוותיקים), ולכן אינם מחיר המכרז שמשלם עמית חדש. נטו: אומדן, תשואה פחות דמי ניהול מצבירה ÷ 12. הפקדות נטו: ההפקדות החודשיות נטו כפי שדווחו לרשות, 12 חודשים. {!sel.size && 'בלי קובץ המכרזים אין סימון זוכות.'}</div>
      </Panel>

      {now && post && pre && (
        <Panel title={<>לפני ואחרי המכרז · {now.label ?? now.id}</>} aside={<span className="num">לפני {ym(pre[0])}–{ym(pre[1])} · אחרי {ym(post[0])}–{ym(post[1])}</span>}>
          {dataRows.length > 0 ? (
            <div className="scroll"><table className="fsimple">
              <caption className="sr-only">לפני ואחרי המכרז, מקובץ הנתונים</caption>
              <thead><tr><th scope="col">קרן</th><th scope="col">הפקדות לפני</th><th scope="col">הפקדות אחרי</th><th scope="col">נתח מההפקדות לפני</th><th scope="col">אחרי</th><th scope="col">תשואה נטו לפני</th><th scope="col">אחרי</th></tr></thead>
              <tbody>{dataRows.map((r) => { const cp = (v: number | null | undefined, w: string, d = 0, u = '') => (v == null ? <span className="muted">–</span> : <Sourced src={() => ({ k: 'calc', title: `${w} · ${r.grp}`, value: u ? pc(v, d) : mn(v), unit: u ? undefined : 'מיליוני ש"ח', formula: `מחושב בבניית הנתונים (קובץ המכרזים של האתר) על מסלולי הפנסיה המקיפה של הקרן${r.ks?.length ? ` (${r.ks.length} מסלולים)` : ''}. ${dfile?.method ?? ''}`, inputs: (r.ks ?? []).map((k) => ({ label: k, v: '' })) })}><span className="num">{u ? pc(v, d) : mn(v)}</span></Sourced>);
                return <tr key={r.grp} className={r.sel ? 'fsel' : undefined}><td>{r.grp}{r.sel && <span className="chip">זוכה</span>}</td><td>{cp(r.pre?.dep, 'הפקדות לפני')}</td><td>{cp(r.post?.dep, 'הפקדות אחרי')}</td><td>{cp(r.pre?.share, 'נתח הפקדות לפני', 1, '%')}</td><td>{cp(r.post?.share, 'נתח הפקדות אחרי', 1, '%')}</td><td>{cp(r.pre?.ret, 'תשואה נטו לפני', 1, '%')}</td><td>{cp(r.post?.ret, 'תשואה נטו אחרי', 1, '%')}</td></tr>; })}</tbody>
            </table></div>
          ) : pending > 0 ? <Loading what={`היסטוריות (${ageTracks.length - pending} מתוך ${ageTracks.length})`} /> : (
            <>
              {posTr > 0 && <p className="fread">מההעברות החיוביות נטו בין הקרנות אחרי תחילת המכרז, <Sourced src={() => ({ k: 'calc', title: 'נתח הזוכות מההעברות החיוביות נטו', value: pc(selTr / posTr * 100, 0), formula: 'סכום ההעברות נטו של הזוכות (כשחיובי) ÷ סכום ההעברות נטו של כל הקרנות שההעברות שלהן חיוביות, במסלולים התלויי גיל',
                inputs: ba.map((x) => ({ label: x.grp, v: mn(x.post.tr), src: () => sumProv(x.post, x.grp, 'tr', post) })) })}><b className="num">{pc(selTr / posTr * 100, 0)}</b></Sourced> הלכו לקרנות הזוכות.</p>}
              <div className="scroll"><table className="fsimple">
                <caption className="sr-only">לפני ואחרי המכרז: הפקדות, העברות ונכסים במסלולים התלויי גיל</caption>
                <thead><tr><th scope="col">קרן</th><th scope="col">הפקדות לפני</th><th scope="col">הפקדות אחרי</th><th scope="col">נתח מההפקדות לפני</th><th scope="col">אחרי</th><th scope="col">העברות נטו לפני</th><th scope="col">אחרי</th><th scope="col">צמיחת נכסים אחרי</th></tr></thead>
                <tbody>{[...ba].sort((a, b) => Number(b.sel) - Number(a.sel) || (b.post.dep ?? 0) - (a.post.dep ?? 0)).map((x) => { const sh = (w: 'pre' | 'post') => { const t = totDep(w), v = x[w].dep; return v == null || !t ? null : v / t * 100; };
                  const shProv = (w: 'pre' | 'post'): Prov => ({ k: 'calc', title: `נתח מההפקדות · ${x.grp} · ${w === 'pre' ? 'לפני' : 'אחרי'}`, value: pc(sh(w), 1), formula: 'ההפקדות של הקרן ÷ סך ההפקדות לכל הקרנות, במסלולים התלויי גיל', inputs: ba.map((y) => ({ label: y.grp, v: mn(y[w].dep), src: () => sumProv(y[w], y.grp, 'dep', w === 'pre' ? pre : post) })) });
                  return <tr key={x.grp} className={x.sel ? 'fsel' : undefined}><td>{x.grp}{x.sel && <span className="chip">זוכה</span>}</td>
                    <td><Sourced src={() => sumProv(x.pre, x.grp, 'dep', pre)}><span className="num">{mn(x.pre.dep)}</span></Sourced></td>
                    <td><Sourced src={() => sumProv(x.post, x.grp, 'dep', post)}><span className="num">{mn(x.post.dep)}</span></Sourced></td>
                    <td><Sourced src={() => shProv('pre')}><span className="num">{pc(sh('pre'), 1)}</span></Sourced></td>
                    <td><Sourced src={() => shProv('post')}><span className="num">{pc(sh('post'), 1)}</span></Sourced></td>
                    <td><Sourced src={() => sumProv(x.pre, x.grp, 'tr', pre)}><span className={`num ${(x.pre.tr ?? 0) >= 0 ? 'pos' : 'neg'}`}>{mn(x.pre.tr)}</span></Sourced></td>
                    <td><Sourced src={() => sumProv(x.post, x.grp, 'tr', post)}><span className={`num ${(x.post.tr ?? 0) >= 0 ? 'pos' : 'neg'}`}>{mn(x.post.tr)}</span></Sourced></td>
                    <td><Sourced src={() => growProv(x.post, x.grp)}><span className="num">{x.post.a0 && x.post.a1 ? pc((x.post.a1 / x.post.a0 - 1) * 100, 1) : '–'}</span></Sourced></td></tr>; })}</tbody>
              </table></div>
              <div className="fnote">מיליוני ש"ח, במסלולים התלויי גיל של כל קרן (עד 50, 50–60, 60+): לשם מצטרפים עמיתים חדשים כברירת מחדל. "לפני" = אותו מספר חודשים ({n}) שקדם לתחילת המכרז. הפקדות: ההפקדות החודשיות; העברות נטו: ניוד פנימה פחות ניוד החוצה, כפי שדווחו לרשות. צמיחת הנכסים כוללת תשואה. עובדות, לא ייחוס סיבתי: גם שוק העבודה, הריבית והתשואות השתנו.</div>
            </>
          )}
        </Panel>
      )}
    </>
  );
}
