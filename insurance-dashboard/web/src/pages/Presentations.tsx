import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Loading, Seg } from '../components/ui';
import { pubLabel } from '../lib/format';
import { idCss } from '../lib/identity';
import { loadCorpus, readerHref, searchText, type Corpus, type DocMeta, type FtQuery } from '../lib/search';
import { periodText } from '../lib/searchOmni';
import { useRegistry } from '../lib/useData';
import { useTargets } from '../lib/targets';
import { TargetsTracker } from '../components/TargetsTracker';
import { usePhone } from '../lib/useMedia';
import { Snip } from './SearchPage';
import '../styles/restate.css';

const QS = ['FY', 'Q3', 'Q2', 'Q1'];
/** Presentations library: every investor deck in the registry, company × period, each opening the reader; search inside decks;
 *  the management targets tracker (filings and decks, actual vs target). */
export function Presentations() {
  const reg = useRegistry();
  const tg = useTargets();
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [err, setErr] = useState('');
  const [sp, setSp] = useSearchParams();
  const phone = usePhone();
  useEffect(() => { loadCorpus().then(setCorpus, () => setErr('רשימת המסמכים לא נטענה')); }, []);
  const co = sp.get('co') ?? '', all = sp.get('all') === '1', q = sp.get('q') ?? '', tAll = sp.get('ta') === '1', tSt = sp.get('ts') ?? '';
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
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="statement" /></span>מצגות משקיעים</h1>
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

      <div id="targets"><TargetsTracker inCo={inCo} name={name} all={tAll} setAll={(v) => set('ta', v ? '1' : '')} status={tSt} setStatus={(v) => set('ts', v)} /></div>
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
