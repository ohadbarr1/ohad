import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Seg } from '../components/ui';
import { dateLabel, nf, pubLabel } from '../lib/format';
import { idCss } from '../lib/identity';
import type { Prov } from '../lib/prov';
import { loadCorpus, readerHref, searchText, type Corpus, type DocMeta, type FtQuery } from '../lib/search';
import { periodText } from '../lib/searchOmni';
import { useLoad, useRegistry } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { Snip } from './SearchPage';
import '../styles/restate.css';

/* targets.json (pipeline/build_targets.py): management targets as the filings printed them, with their pages */
interface Target { c: string; m: string; l: string; e: string; t: 'strategy' | 'payout' | 'capital'; u: 'pct' | 'm'; d: string; v: number; r: string; doc: number | null; pg: number | null; q: string; n: number; hist: [string, number, number | null, number | null][] | null; src: 'pres' | 'report' }
interface Targets { built: string; source: string; pending: string; files: string; docs: Record<string, [string, string, string, string, string]>; rows: Target[] }

const QS = ['FY', 'Q3', 'Q2', 'Q1'];
const TOPIC: [Target['t'], string][] = [['strategy', 'יעדים אסטרטגיים'], ['payout', 'מדיניות חלוקה'], ['capital', 'הון וכושר פירעון']];
const DOC_HE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };
const tv = (t: Target, v = t.v) => (t.u === 'pct' ? `${nf(v, Number.isInteger(v) ? 0 : 1)}%` : nf(v, 0));
/** the target date: a later year is a horizon ("2027"), a date inside the report's period is the date the target stood at */
const whenP = (t: Target): [string, string] => (Number(t.d.slice(0, 4)) > Number(t.r.slice(0, 4)) ? ['יעד ל-', t.d.slice(0, 4)] : /-(03-31|06-30|09-30|12-31)$/.test(t.d) ? ['נכון ל-', dateLabel(t.d)] : ['מ-', pubLabel(t.d)]);
const when = (t: Target) => whenP(t).join('');

/** Presentations library: every investor deck in the registry, company × period, each opening the reader; search inside decks;
 *  the management targets already extracted from the filings (the deck extraction wave will add the rest). */
export function Presentations() {
  const reg = useRegistry();
  const tg = useLoad<Targets>('targets.json');
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [err, setErr] = useState('');
  const [sp, setSp] = useSearchParams();
  const phone = usePhone();
  useEffect(() => { loadCorpus().then(setCorpus, () => setErr('רשימת המסמכים לא נטענה')); }, []);
  const co = sp.get('co') ?? '', all = sp.get('all') === '1', q = sp.get('q') ?? '', tAll = sp.get('ta') === '1';
  const set = (k: string, v: string) => setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const kind = useMemo(() => new Map((reg.data ?? []).map((c) => [c.id, c.kind === 'insurance_group' ? 'ins' : 'fund'])), [reg.data]);
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const inCo = (id: string) => !co || id === co || (co === 'ins' && kind.get(id) === 'ins') || (co === 'fund' && kind.get(id) === 'fund');
  const decks = useMemo(() => (corpus?.docs ?? []).filter((d) => d.type === 'presentation'), [corpus]);
  const byCell = useMemo(() => { const m = new Map<string, DocMeta[]>(); decks.forEach((d) => { const k = `${d.company}|${d.period}`; m.set(k, [...(m.get(k) ?? []), d]); }); return m; }, [decks]);
  const order = (reg.data ?? []).map((c) => c.id);
  const cos = [...new Set(decks.map((d) => d.company))].sort((a, b) => (kind.get(a) === kind.get(b) ? order.indexOf(a) - order.indexOf(b) : kind.get(a) === 'ins' ? -1 : 1));
  const years = [...new Set(decks.map((d) => Number(d.period.slice(0, 4))))].sort((a, b) => b - a);
  const shownYears = all ? years : years.slice(0, 5);
  const tByDoc = useMemo(() => { const m = new Map<number, number>(); tg.data?.rows.forEach((t) => { if (t.src === 'pres' && t.doc) m.set(t.doc, (m.get(t.doc) ?? 0) + 1); }); return m; }, [tg.data]);

  if (reg.error || err) return <ErrorBox what="ספריית המצגות" error={reg.error ?? err} />;
  if (!reg.data || !corpus) return <Loading what="ספריית המצגות" />;
  const rows = cos.filter(inCo);
  const nDecks = decks.filter((d) => inCo(d.company)).length;

  const tile = (d: DocMeta[], label: string) => {
    // the Hebrew deck leads; an English version of the same deck is one corner link
    const he = d.filter((y) => !y.en), en = d.filter((y) => y.en), x = he[0] ?? d[0], nt = d.reduce((s, y) => s + (tByDoc.get(y.id) ?? 0), 0);
    const extra = he.length > 1 ? he.length : 0, enDoc = he.length ? en[0] : undefined;
    return (
      <span className="pz-cell">
        <Link className={`pz-deck${nt ? ' tg' : ''}`} to={readerHref(x.id)} title={`${name(x.company)} · ${x.title}${x.en ? ' (EN)' : ''} · ${periodText(x.period)} · ${x.pages} עמ׳ · פורסם ${pubLabel(x.date)}${extra ? ` · ${extra} מצגות לאותה תקופה` : ''}${nt ? ` · ${nt} יעדים שחולצו` : ''}`}>
          <i style={{ background: idCss(x.company) }} />
          <span className="num">{label}</span><small className="num">{x.pages} עמ׳</small>
          {extra > 0 && <span className="pz-n num">{extra}</span>}
        </Link>
        {enDoc && <Link className="pz-en" to={readerHref(enDoc.id)} title={`${enDoc.title} · ${enDoc.pages} עמ׳ · באנגלית`}>EN</Link>}
      </span>
    );
  };
  const coChips = (
    <div className="pz-cos" role="group" aria-label="חברה">
      {[['', 'הכול'], ['ins', 'חברות ביטוח'], ['fund', 'בתי השקעות']].map(([v, l]) => <button key={v} type="button" className={`chip${co === v ? ' on' : ''}`} aria-pressed={co === v} onClick={() => set('co', v)}>{l}</button>)}
      {cos.map((c) => <button key={c} type="button" className={`chip${co === c ? ' on' : ''}`} aria-pressed={co === c} onClick={() => set('co', co === c ? '' : c)}><i className="pdot" style={{ background: idCss(c) }} />{name(c)}</button>)}
    </div>
  );

  return (
    <div className="pz">
      <div className="pagehead"><div><h1>מצגות משקיעים</h1>
        <div className="sub"><span className="num">{decks.length}</span> מצגות · <span className="num">{cos.length}</span> חברות · <span className="num">{years[years.length - 1]}–{years[0]}</span> · כל מצגת נפתחת בקורא, עם המקור ב-MAYA</div></div></div>

      <section className="panel pz-search">
        <div className="hd"><h2>חיפוש בתוך המצגות</h2><div className="aside"><span>כל עמוד בכל מצגת · מילה או ביטוי</span></div></div>
        <form role="search" onSubmit={(e) => { e.preventDefault(); set('q', draft.trim()); }}>
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="למשל: תשואה על ההון יעד" aria-label="חיפוש במצגות" />
          <button type="submit" className="btn primary">חיפוש</button>
          {q && <button type="button" className="btn" onClick={() => set('q', '')}>ניקוי</button>}
        </form>
        {q && <DeckHits q={q} inCo={inCo} name={name} />}
      </section>

      <section className="panel">
        <div className="hd"><h2>לפי חברה ותקופה</h2><div className="aside"><span><span className="num">{nDecks}</span> מצגות</span>
          {years.length > 5 && <Seg<string> label="טווח שנים" value={all ? '1' : ''} onChange={(v) => set('all', v)} options={[['', `${shownYears.length && years.slice(0, 5).at(-1)}–${years[0]}`], ['1', 'כל השנים']]} />}</div></div>
        {coChips}
        {rows.length === 0 ? <Empty title="אין מצגות לחברה זו במאגר" /> : phone ? (
          <ul className="pz-list">{rows.map((c) => (
            <li key={c}><h3><i className="pdot" style={{ background: idCss(c) }} /><Link to={`/company/${c}/filings`}>{name(c)}</Link></h3>
              <div className="pz-row">{shownYears.flatMap((y) => QS.map((qq) => { const d = byCell.get(`${c}|${y}${qq}`); return d ? <span key={`${y}${qq}`}>{tile(d, periodText(`${y}${qq}`))}</span> : null; }))}</div>
            </li>
          ))}</ul>
        ) : (
          <div className="pz-grid"><table className="pz-table">
            <thead>
              <tr><th className="pz-co" rowSpan={2}>חברה</th>{shownYears.map((y) => <th key={y} colSpan={4} className="pz-y0"><span className="num">{y}</span></th>)}</tr>
              <tr>{shownYears.flatMap((y) => QS.map((qq, i) => <th key={`${y}${qq}`} className={i === 0 ? 'pz-y0' : ''}>{qq}</th>))}</tr>
            </thead>
            <tbody>{rows.map((c) => (
              <tr key={c}><th className="pz-co" scope="row"><i className="pdot" style={{ background: idCss(c) }} /><Link to={`/company/${c}/filings`}>{name(c)}</Link></th>
                {shownYears.flatMap((y) => QS.map((qq, i) => { const d = byCell.get(`${c}|${y}${qq}`); return <td key={`${y}${qq}`} className={i === 0 ? 'pz-y0' : ''}>{d ? tile(d, qq === 'FY' ? 'FY' : qq) : <span className="pz-none" aria-hidden>·</span>}</td>; }))}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="src">מקור: MAYA, דיווחי החברות (מצגת משקיעים) · מספר בפינה: כמה מצגות בעברית פורסמו לאותה תקופה · EN: גרסה באנגלית</p>
      </section>

      <TargetsPanel tg={tg} inCo={inCo} name={name} all={tAll} setAll={(v) => set('ta', v ? '1' : '')} />
    </div>
  );
}

/** search hits limited to presentations, grouped by deck */
function DeckHits({ q, inCo, name }: { q: string; inCo: (id: string) => boolean; name: (id: string) => string }) {
  const [res, setRes] = useState<FtQuery | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(10);
  useEffect(() => { let live = true; setRes(null); setErr(''); setN(10); searchText(q).then((r) => live && setRes(r), () => live && setErr('טעינת האינדקס נכשלה')); return () => { live = false; }; }, [q]);
  const groups = useMemo(() => {
    const by = new Map<number, { doc: DocMeta; pages: number[]; best: number }>();
    for (const h of res?.hits ?? []) {
      if (h.doc.type !== 'presentation' || !inCo(h.doc.company)) continue;
      const g = by.get(h.doc.id) ?? { doc: h.doc, pages: [], best: h.score };
      g.pages.push(h.page); by.set(h.doc.id, g);
    }
    return [...by.values()];
  }, [res, inCo]);
  if (err) return <ErrorBox what="החיפוש" error={err} />;
  if (!res) return <div className="src">מחפש…</div>;
  if (!groups.length) return <Empty title="המילים לא נמצאו במצגות">{res.missing.length ? `לא במאגר: ${res.missing.join(', ')}` : 'נסו מילה אחרת או בטלו את סינון החברה'}</Empty>;
  return (
    <>
      <div className="src"><span className="num">{groups.reduce((s, g) => s + g.pages.length, 0)}</span> עמודים ב-<span className="num">{groups.length}</span> מצגות{res.mode === 'or' ? ' · אף עמוד לא מכיל את כל המילים: מוצגים עמודים עם חלק מהן' : ''}</div>
      <ul className="pz-hits">{groups.slice(0, n).map((g) => (
        <li key={g.doc.id}>
          <div className="pz-hd"><i className="pdot" style={{ background: idCss(g.doc.company) }} /><b>{name(g.doc.company)}</b><span className="num">{periodText(g.doc.period)}</span><span className="muted">{g.doc.title}</span>
            <Link className="chip" to={readerHref(g.doc.id, g.pages[0], q)}>פתח בקורא</Link><a className="chip" href={g.doc.url} target="_blank" rel="noreferrer">PDF ↗</a></div>
          <div className="pz-pages">{g.pages.slice(0, 4).map((p) => (
            <Link key={p} to={readerHref(g.doc.id, p, q)}><span className="num">עמ׳ {p}</span><Snip rid={g.doc.id} page={p} terms={res.terms} /></Link>
          ))}{g.pages.length > 4 && <Link to={readerHref(g.doc.id, g.pages[4], q)} className="muted">ועוד <span className="num">{g.pages.length - 4}</span> עמודים</Link>}</div>
        </li>
      ))}</ul>
      {groups.length > n && <button type="button" className="btn" onClick={() => setN(n + 20)}>עוד מצגות</button>}
    </>
  );
}

/** management targets as printed; the deck extraction wave is not approved, so its targets slot in later */
function TargetsPanel({ tg, inCo, name, all, setAll }: { tg: { data: Targets | null; error: string | null }; inCo: (id: string) => boolean; name: (id: string) => string; all: boolean; setAll: (v: boolean) => void }) {
  if (tg.error) return <ErrorBox what="היעדים" error={tg.error} />;
  if (!tg.data) return <Loading what="היעדים" />;
  const d = tg.data;
  const rows = d.rows.filter((t) => inCo(t.c));
  // by default one row per target: the latest date it was printed for
  const latest = new Map<string, Target>();
  rows.forEach((t) => { const k = `${t.c}|${t.m}|${t.e}`; const c = latest.get(k); if (!c || t.d > c.d) latest.set(k, t); });
  const shown = all ? rows : rows.filter((t) => latest.get(`${t.c}|${t.m}|${t.e}`) === t);
  const docName = (id: number | null, r: string) => { const x = id != null ? d.docs[String(id)] : undefined; return x ? `${DOC_HE[x[1]] ?? 'דוח'} ${periodText(x[2])}` : `דוח ${periodText(r)}`; };
  const prov = (t: Target): Prov => {
    const x = t.doc != null ? d.docs[String(t.doc)] : undefined;
    return { k: 'report', title: `${t.l} · ${t.e ? `${t.e} · ` : ''}${name(t.c)}`, value: tv(t), unit: t.u === 'pct' ? '%' : 'מיליוני ש"ח', url: x ? d.files + x[4] : null, pg: t.pg, doc: `${name(t.c)}, ${docName(t.doc, t.r)}`, period: when(t),
      note: [t.q ? `בדוח: ${t.q}` : '', t.n > 1 ? `הודפס ב-${t.n} דוחות; מוצגת ההדפסה האחרונה` : '', t.hist ? `שינויים: ${t.hist.map(([p, v]) => `${tv(t, v)} (${periodText(p)})`).join(' ← ')}` : ''].filter(Boolean).join(' · ') || undefined };
  };
  return (
    <section className="panel">
      <div className="hd"><h2>יעדי הנהלה</h2><div className="aside"><span>כפי שהודפסו בדוחות · <span className="num">{shown.length}</span> יעדים</span>
        <Seg<string> label="הדפסות" value={all ? '1' : ''} onChange={(v) => setAll(!!v)} options={[['', 'האחרון לכל יעד'], ['1', 'כל התאריכים']]} /></div></div>
      <div className="pz-slot">{d.pending} · יעדי רווח, תשואה להון ו-CSM מהמצגות יתווספו כאן, כל אחד עם העמוד שלו.</div>
      {shown.length === 0 ? <Empty title="לא חולצו יעדים לחברה זו" /> : (
        <div className="scroll"><table className="tight pz-tg">
          <thead><tr><th>חברה</th><th>יעד</th><th>ישות</th><th>ערך</th><th>מועד</th><th>מקור</th></tr></thead>
          <tbody>{TOPIC.flatMap(([topic, label]) => {
            const ts = shown.filter((t) => t.t === topic);
            if (!ts.length) return [];
            return [<tr key={topic} className="pz-topic"><td colSpan={6}>{label} <span className="num">{ts.length}</span></td></tr>,
              ...ts.map((t, i) => (
                <tr key={`${topic}${i}`}>
                  <td><i className="pdot" style={{ background: idCss(t.c) }} />{name(t.c)}</td>
                  <td className="lbl">{t.l}{t.q && <q>{t.q}</q>}</td>
                  <td>{t.e}</td>
                  <td><Sourced src={() => prov(t)} className="num">{tv(t)}</Sourced>{t.u === 'm' && <span className="dim">מיליוני ש"ח</span>}{t.hist && <span className="chip est" title={t.hist.map(([p, v]) => `${tv(t, v)} · ${periodText(p)}`).join(' ← ')}>עודכן</span>}</td>
                  <td>{whenP(t)[0]}<span className="num">{whenP(t)[1]}</span></td>
                  <td>{t.doc != null ? <Link to={readerHref(t.doc, t.pg)}>{docName(t.doc, t.r)}{t.pg ? <> · <span className="num">עמ׳ {t.pg}</span></> : null}</Link> : docName(t.doc, t.r)}{t.src === 'pres' && <span className="chip">מצגת</span>}</td>
                </tr>
              ))];
          })}</tbody>
        </table></div>
      )}
      <p className="src">מקור: {d.source} · עדכון {pubLabel(d.built)}</p>
    </section>
  );
}
