import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Link, useSearchParams } from 'react-router-dom';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Seg } from '../components/ui';
import { MINUS, nf, periodLabel, pubLabel } from '../lib/format';
import { idCss } from '../lib/identity';
import type { Prov } from '../lib/prov';
import { readerHref } from '../lib/search';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { downloadXlsx, type XCell } from '../lib/xlsx';
import '../styles/restate.css';

/* restatements.json (pipeline/build_restatements.py): the first print of a period against its latest print, both with their pages */
type Row = [string, St, string, string, string, string, U, number, number | null, number | null, number, number | null, number | null, string, 0 | 1, string];
type St = 'bs' | 'pl' | 'oci' | 'cf' | 'eq' | 'n17';
type U = 'k' | 'm' | 'nis' | 'pct' | 'shares';
interface Season { n: number; big: number; up: number; down: number; cos: Record<string, number>; profit: [string, string, string, string, number][]; net: number | null }
interface File { built: string; source: string; names: Record<string, string>; kind: Record<string, 'ins' | 'fund'>; files: string; docs: Record<string, [string, string, string, string, string]>; rows: Row[]; seasons: Record<string, Season> }
interface R { co: string; st: St; line: string; sub: string; pt: string; pe: string; u: U; v0: number; d0: number | null; p0: number | null; v1: number; d1: number | null; p1: number | null; season: string; sign: boolean; std: string; d: number; pc: number | null }

export const ST_HE: Record<St, string> = { bs: 'מאזן', pl: 'רווח והפסד', oci: 'רווח כולל', cf: 'תזרים מזומנים', eq: 'שינויים בהון', n17: 'באורי IFRS 17' };
export const seasonLabel = (s: string) => (s.endsWith('FY') ? `FY'${s.slice(2, 4)}` : `${s.slice(4)}'${s.slice(2, 4)}`);
const DOC_HE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };
const SIZE: [string, string][] = [['', 'הכול'], ['2', '2% ומעלה'], ['10', '10% ומעלה']];
const PAGE = 80;

/** a figure in the units the table shows: NIS millions (statements are stored in thousands), per-share in NIS, ratios in % */
const shown = (v: number, u: U) => (u === 'k' ? v / 1000 : v);
const fmt = (v: number, u: U) => (u === 'pct' ? `${nf(v, 1)}%` : u === 'nis' ? nf(v, 2) : u === 'shares' ? nf(v, 0) : nf(shown(v, u), Math.abs(shown(v, u)) < 100 ? 1 : 0));
const fmtD = (d: number, u: U) => { const t = u === 'pct' ? `${nf(Math.abs(d), 1)} נק׳` : u === 'nis' ? nf(Math.abs(d), 2) : u === 'shares' ? nf(Math.abs(d), 0) : nf(Math.abs(shown(d, u)), Math.abs(shown(d, u)) < 100 ? 1 : 0); return d > 0 ? `+${t}` : d < 0 ? `${MINUS}${t}` : t; };
const UNIT: Record<U, string> = { k: 'מיליוני ש"ח', m: 'מיליוני ש"ח', nis: 'ש"ח', pct: '%', shares: 'מניות' };

/** Sector restatement log: every figure a later filing reprinted with another value, 13 companies, with both pages. */
export function Restatements() {
  const { data, error } = useLoad<File>('restatements.json');
  const [sp, setSp] = useSearchParams();
  const phone = usePhone();
  const [n, setN] = useState(PAGE);
  const co = sp.get('co') ?? '', st = (sp.get('st') ?? '') as St | '', size = sp.get('min') ?? '', season = sp.get('season') ?? '', q = sp.get('q') ?? '';
  const sort = sp.get('sort') === 'pct' ? 'pct' : sp.get('sort') === 'new' ? 'new' : 'abs', sign = sp.get('sign') === '1';
  const set = (k: string, v: string) => { setN(PAGE); setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true }); };

  const rows = useMemo<R[]>(() => (data?.rows ?? []).map(([co, st, line, sub, pt, pe, u, v0, d0, p0, v1, d1, p1, season, k, std]) => ({
    co, st, line, sub, pt, pe, u, v0, d0, p0, v1, d1, p1, season, sign: k === 1, std, d: v1 - v0, pc: v0 !== 0 ? ((v1 - v0) / Math.abs(v0)) * 100 : null,
  })), [data]);
  const inCo = (r: R) => !co || r.co === co || (co === 'ins' && data?.kind[r.co] === 'ins') || (co === 'fund' && data?.kind[r.co] === 'fund');
  const big = (r: R) => !size || r.pc == null || Math.abs(r.pc) >= Number(size);
  const words = q.trim().split(/\s+/).filter(Boolean);
  const pass = (r: R, skip?: string) => (skip === 'co' || inCo(r)) && (skip === 'st' || !st || r.st === st) && (skip === 'min' || big(r)) && (skip === 'season' || !season || r.season === season)
    && (sign || !r.sign) && words.every((w) => r.line.includes(w) || r.sub.includes(w));
  const list = useMemo(() => {
    const out = rows.filter((r) => pass(r));
    if (sort === 'new') return out; // the file is newest season first
    const money = (r: R) => (r.u === 'k' || r.u === 'm' ? Math.abs(shown(r.d, r.u)) : -1);  // per-share and ratio rows after the amounts
    return out.sort(sort === 'abs' ? (a, b) => money(b) - money(a) : (a, b) => Math.abs(b.pc ?? 0) - Math.abs(a.pc ?? 0));
  }, [rows, co, st, size, season, sign, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (skip: string, f: (r: R) => boolean) => rows.reduce((s, r) => s + (pass(r, skip) && f(r) ? 1 : 0), 0);

  if (error) return <ErrorBox what="יומן ההצגות מחדש" error={error} />;
  if (!data) return <Loading what="יומן ההצגות מחדש" />;
  const name = (id: string) => data.names[id] ?? id;
  const seasons = Object.keys(data.seasons);
  const maxN = Math.max(...seasons.map((s) => data.seasons[s].n));
  const doc = (id: number | null) => (id != null ? data.docs[String(id)] : undefined);
  const docName = (id: number | null) => { const d = doc(id); return d ? `${DOC_HE[d[1]] ?? 'דוח'} ${seasonLabel(d[2])}` : 'דוח'; };
  const url = (id: number | null) => { const d = doc(id); return d ? data.files + d[4] : null; };
  const per = (r: R) => periodLabel(r.pt, r.pe);
  const prov = (r: R, which: 0 | 1): Prov => {
    const id = which ? r.d1 : r.d0, pg = which ? r.p1 : r.p0, v = which ? r.v1 : r.v0;
    return { k: 'report', title: `${r.line}${r.sub ? ` · ${r.sub}` : ''} · ${name(r.co)} · ${per(r)}`, value: fmt(v, r.u), unit: UNIT[r.u], url: url(id), pg, doc: `${name(r.co)}, ${docName(id)}`, period: per(r),
      note: which ? `כפי שהוצג מחדש בדוח ${seasonLabel(r.season)}` : 'כפי שדווח לראשונה',
      restated: { first: `${fmt(r.v0, r.u)} · ${docName(r.d0)}`, last: `${fmt(r.v1, r.u)} · ${docName(r.d1)}`, firstHref: r.d0 != null ? readerHref(r.d0, r.p0) : undefined, lastHref: r.d1 != null ? readerHref(r.d1, r.p1) : undefined, in: seasonLabel(r.season) } };
  };
  const diffProv = (r: R, pct: boolean): Prov => ({ k: 'calc', title: `${pct ? 'שינוי' : 'הפרש'} · ${r.line} · ${name(r.co)} · ${per(r)}`, value: pct ? `${r.pc! > 0 ? '+' : ''}${nf(r.pc!, 1)}%` : fmtD(r.d, r.u), unit: pct ? '%' : UNIT[r.u],
    formula: pct ? 'כפי שהוצג מחדש ÷ |כפי שדווח לראשונה| − 1' : 'כפי שהוצג מחדש − כפי שדווח לראשונה',
    inputs: [{ label: `כפי שדווח לראשונה · ${docName(r.d0)}`, v: fmt(r.v0, r.u), src: () => prov(r, 0) }, { label: `כפי שהוצג מחדש · ${docName(r.d1)}`, v: fmt(r.v1, r.u), src: () => prov(r, 1) }] });
  const netProv = (s: string): Prov => {
    const x = data.seasons[s];
    return { k: 'calc', title: `רווח לתקופה: השפעת ההצגה מחדש · דוחות ${seasonLabel(s)}`, value: x.net == null ? '–' : fmtD(x.net, 'm'), unit: 'מיליוני ש"ח',
      formula: 'סכום ההפרשים בשורת הרווח לתקופה, חברה חברה: סוג תקופה אחד לכל חברה (שנתי אם הוצג מחדש, אחרת חציון, אחרת רבעונים, שאינם חופפים)',
      inputs: x.profit.map(([c, line, pt, pe, d]) => ({ label: `${name(c)} · ${line} · ${periodLabel(pt, pe)}`, v: fmtD(d, 'm') })) };
  };
  const exportXlsx = () => {
    const head = ['חברה', 'דוח', 'שורה', 'פילוח', 'תקופה', 'יחידה', 'כפי שדווח לראשונה', 'מסמך', 'עמוד', 'כפי שהוצג מחדש', 'מסמך', 'עמוד', 'הפרש', 'שינוי %', 'הוצג מחדש בדוח', 'סוג'];
    const body: XCell[][] = list.map((r) => [name(r.co), ST_HE[r.st], r.line, r.sub, per(r), UNIT[r.u],
      { v: +shown(r.v0, r.u).toFixed(3), fmt: 'n1' }, docName(r.d0), { v: r.p0, link: r.d0 != null ? `${url(r.d0)}#page=${r.p0}` : undefined },
      { v: +shown(r.v1, r.u).toFixed(3), fmt: 'n1' }, docName(r.d1), { v: r.p1, link: r.d1 != null ? `${url(r.d1)}#page=${r.p1}` : undefined },
      { v: +shown(r.d, r.u).toFixed(3), fmt: 'n1' }, r.pc == null ? null : { v: +(r.pc / 100).toFixed(5), fmt: 'pct1' }, seasonLabel(r.season), r.sign ? 'היפוך סימן (הצגה)' : 'שינוי ערך']);
    downloadXlsx('fox-restatements', [{ name: 'הצגות מחדש', rows: [head.map((h) => ({ v: h, bold: true })), ...body], freeze: { rows: 1, cols: 3 }, widths: [12, 12, 38, 18, 9, 11, 12, 16, 7, 12, 16, 7, 10, 9, 10, 14] }]);
  };

  const cur = season ? data.seasons[season] : null;
  const companies = Object.keys(data.names).sort((a, b) => (data.kind[a] === data.kind[b] ? name(a).localeCompare(name(b), 'he') : data.kind[a] === 'ins' ? -1 : 1));
  const cell = (r: R, which: 0 | 1) => {
    const id = which ? r.d1 : r.d0, pg = which ? r.p1 : r.p0;
    return (
      <div className="rs-v">
        <Sourced src={() => prov(r, which)} className={`num${which ? ' rs-new' : ''}`}>{fmt(which ? r.v1 : r.v0, r.u)}</Sourced>
        {id != null && <Link className="rs-pg" to={readerHref(id, pg)} title={`פתח בקורא: ${docName(id)}${pg ? `, עמוד ${pg}` : ''}`}>{docName(id).replace('דוח רבעוני', 'רבעוני').replace('דוח שנתי', 'שנתי')}{pg ? <> · <span className="num">עמ׳ {pg}</span></> : null}</Link>}
      </div>
    );
  };
  const delta = (r: R) => (
    <div className="rs-d">
      <Sourced src={() => diffProv(r, false)} className={`num ${r.d > 0 ? 'pos' : r.d < 0 ? 'neg' : ''}`}>{fmtD(r.d, r.u)}</Sourced>
      {r.pc != null && <Sourced src={() => diffProv(r, true)} className={`num rs-pc${Math.abs(r.pc) >= 2 ? ' big' : ''}`}>{`${r.pc > 0 ? '+' : ''}${nf(r.pc, 1)}%`}</Sourced>}
    </div>
  );
  const label = (r: R) => (
    <>
      <span className="rs-line">{r.line}</span>
      <span className="dim"><span className="num">{per(r)}</span> · {ST_HE[r.st]}{r.sub ? ` · ${r.sub}` : ''}{r.st === 'n17' ? '' : ` · ${r.std}`}{r.sign && <span className="chip est">היפוך סימן</span>}</span>
    </>
  );

  return (
    <div className="rs">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="filing" /></span>הצגות מחדש</h1>
        <div className="sub">כל נתון שדוח מאוחר יותר הדפיס בערך אחר · <span className="num">{Object.keys(data.names).length}</span> חברות · ההדפסה הראשונה מול האחרונה, כל אחת בעמוד שלה</div></div>
        <div className="rs-actions"><button type="button" className="btn" onClick={exportXlsx}>Excel</button></div>
      </div>

      <section className="panel rs-seasons" aria-label="לפי עונת דיווח">
        <div className="hd"><h2>לפי עונת דיווח</h2><div className="aside"><span>הדוח שהדפיס את הערך המתוקן · החלק המודגש: שינוי של 2% ומעלה{season && <> · <button type="button" className="chip" onClick={() => set('season', '')}>כל העונות ×</button></>}</span></div></div>
        <div className="rs-strip" role="list">
          {seasons.map((s) => {
            const x = data.seasons[s];
            return (
              <button key={s} type="button" role="listitem" className={`rs-sea${s === season ? ' on' : ''}`} aria-pressed={s === season} onClick={() => set('season', s === season ? '' : s)} title={`${seasonLabel(s)}: ${x.n} נתונים, ${x.big} מהם ב-2% ומעלה`}>
                <span className="rs-bar" style={{ ['--h' as string]: `${Math.max(4, (x.n / maxN) * 100)}%`, ['--b' as string]: `${(x.big / x.n) * 100}%` }}><i /></span>
                <b className="num">{x.n}</b>
                <span className="num rs-s">{seasonLabel(s)}</span>
              </button>
            );
          })}
        </div>
        {cur && (
          <div className="rs-cur">
            <div className="rs-kpi"><span>נתונים</span><b className="num">{cur.n}</b></div>
            <div className="rs-kpi"><span>2% ומעלה</span><b className="num">{cur.big}</b></div>
            <div className="rs-kpi"><span>כלפי מעלה · מטה</span><b className="num">{cur.up} · {cur.down}</b></div>
            <div className="rs-kpi"><span>רווח לתקופה, נטו</span><b>{cur.net == null ? <span className="muted" title="אף חברה לא הציגה מחדש את שורת הרווח לתקופה בעונה זו">–</span> : <Sourced src={() => netProv(season)} className={`num ${cur.net > 0 ? 'pos' : cur.net < 0 ? 'neg' : ''}`}>{fmtD(cur.net, 'm')}</Sourced>}</b><small>מיליוני ש"ח</small></div>
            <div className="rs-cos">{Object.entries(cur.cos).map(([c, k]) => (
              <button key={c} type="button" className={`chip${co === c ? ' on' : ''}`} aria-pressed={co === c} onClick={() => set('co', co === c ? '' : c)}><i className="pdot" style={{ background: idCss(c) }} />{name(c)} <span className="num">{k}</span></button>
            ))}</div>
          </div>
        )}
      </section>

      <section className="controls rs-controls">
        <label className="field"><span>חברה</span>
          <select value={co} onChange={(e) => set('co', e.target.value)}>
            <option value="">כל החברות ({count('co', () => true)})</option>
            <option value="ins">חברות ביטוח ({count('co', (r) => data.kind[r.co] === 'ins')})</option>
            <option value="fund">בתי השקעות ({count('co', (r) => data.kind[r.co] === 'fund')})</option>
            {companies.map((c) => <option key={c} value={c}>{name(c)} ({count('co', (r) => r.co === c)})</option>)}
          </select>
        </label>
        <div className="field"><span>דוח</span><Seg<string> label="דוח" value={st} onChange={(v) => set('st', v)} options={[['', 'הכול'], ...(['bs', 'pl', 'oci', 'cf', 'n17'] as St[]).filter((x) => count('st', (r) => r.st === x)).map((x) => [x, ST_HE[x]] as [string, string])]} /></div>
        <div className="field"><span>גודל השינוי</span><Seg<string> label="גודל השינוי" value={size} onChange={(v) => set('min', v)} options={SIZE} /></div>
        <label className="field"><span>עונה</span>
          <select value={season} onChange={(e) => set('season', e.target.value)}>
            <option value="">כל העונות</option>
            {seasons.map((s) => <option key={s} value={s}>דוחות {seasonLabel(s)} ({count('season', (r) => r.season === s)})</option>)}
          </select>
        </label>
        <label className="field rs-q"><span>שורה</span><input type="search" value={q} placeholder="למשל: הכנסות" onChange={(e) => set('q', e.target.value)} /></label>
        <label className="field"><span>מיון</span>
          <select value={sort} onChange={(e) => set('sort', e.target.value === 'abs' ? '' : e.target.value)}>
            <option value="abs">הפרש בש"ח</option><option value="pct">שינוי באחוזים</option><option value="new">עונה, מהחדשה</option>
          </select>
        </label>
        <button type="button" className="chip" aria-pressed={sign} onClick={() => set('sign', sign ? '' : '1')} title="אותו גודל בסימן הפוך: שינוי הצגה, לא שינוי ערך">היפוכי סימן ({rows.filter((r) => r.sign).length})</button>
      </section>

      <section className="panel rs-panel">
        <div className="hd"><h2><span className="num">{list.length.toLocaleString()}</span> נתונים</h2><div className="aside"><span>מיליוני ש"ח (למניה: ש"ח; יחסים: %) · שני הערכים נפתחים בעמוד שבו הודפסו</span></div></div>
        {list.length === 0 ? <Empty title="אין נתונים שהוצגו מחדש בסינון זה" /> : phone ? (
          <ul className="rs-cards">{list.slice(0, n).map((r, i) => (
            <li key={i}>
              <div className="rs-who"><i className="pdot" style={{ background: idCss(r.co) }} /><Link to={`/company/${r.co}?p=${r.season}`}>{name(r.co)}</Link><span className="num rs-s">{seasonLabel(r.season)}</span></div>
              <div className="rs-lbl">{label(r)}</div>
              <div className="rs-row"><div><small>לראשונה</small>{cell(r, 0)}</div><span className="rs-arr" aria-hidden>←</span><div><small>מחדש</small>{cell(r, 1)}</div><div>{delta(r)}</div></div>
            </li>
          ))}</ul>
        ) : (
          <div className="scroll"><table className="tight rs-table">
            <thead><tr><th>חברה</th><th>שורה ותקופה</th><th>כפי שדווח לראשונה</th><th>כפי שהוצג מחדש</th><th>הפרש · שינוי</th><th>בדוח</th></tr></thead>
            <tbody>{list.slice(0, n).map((r, i) => (
              <tr key={i}>
                <td className="rs-co"><i className="pdot" style={{ background: idCss(r.co) }} /><Link to={`/company/${r.co}?p=${r.season}`}>{name(r.co)}</Link></td>
                <td className="lbl">{label(r)}</td>
                <td>{cell(r, 0)}</td>
                <td>{cell(r, 1)}</td>
                <td>{delta(r)}</td>
                <td><button type="button" className="rs-season num" onClick={() => set('season', r.season)} title="סינון לעונה זו">{seasonLabel(r.season)}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {list.length > n && <div className="rs-more"><button type="button" className="btn" onClick={() => setN(n + PAGE * 2)}>עוד <span className="num">{Math.min(PAGE * 2, list.length - n)}</span> מתוך <span className="num">{(list.length - n).toLocaleString()}</span></button></div>}
        <p className="src">מקור: {data.source} · עיגול: הפרש שאינו עולה על עיגול שתי ההדפסות (מספר שהודפס במיליונים) אינו הצגה מחדש · שורה שמופיעה בכמה דוחות (רווח נקי) נספרת פעם אחת · באורי IFRS 17: נתון שחולץ מטבלה, פעם אחת בכל דוח · עדכון {pubLabel(data.built)}</p>
      </section>
    </div>
  );
}
