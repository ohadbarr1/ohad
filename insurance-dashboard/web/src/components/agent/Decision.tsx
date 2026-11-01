import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { Tip } from '../Explain';
import { BM_HREF, BUCKETS_DEFAULT, COMP_HE, COMP_KEYS, SELF_REPORT, avgProv, bmKind, claimProv, claimsWhy, companyOf, coverProv, pc1, rankHe, sgn, srcOf, svcOf, svcProv,
  type ClaimSide, type CoverRule, type DecisionFile, type SegKey } from '../../lib/decision';
import './glossary';
import '../../styles/agent.css';

/* W2 · the decision pieces the pension pack, the managers' page and the managers'-insurance page share: the company's service index
   (the regulator's, by segment), its own claims report (labelled as such), the default coverage of a comprehensive fund (the uniform
   bylaws, clause and page), and the pointer to the managers'-insurance checklist. Every figure opens its source with its page. */

const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

/** the service index of a company in one segment: score, rank of N, change, the five components on expand, source and page */
export function SvcCell({ d, grp, seg = 'pension' }: { d: DecisionFile | null | undefined; grp: string; seg?: SegKey }) {
  if (d === undefined) return <div className="ppk-cell"><div className="ppk-l">מדד השירות של הרשות</div><div className="ppk-none">טוען…</div></div>;
  const g = d?.segments[seg], r = d ? svcOf(d, grp, seg) : null;
  if (!d || !g || !r) return (
    <div className="ppk-cell"><div className="ppk-l">מדד השירות של הרשות <Tip k="svcidx" /></div>
      <div className="ppk-none">{!d ? 'קובץ נתוני ההחלטה לא פורסם' : `החברה אינה במדד השירות של הרשות ל${g?.label ?? 'מוצר הזה'}`}</div></div>
  );
  const hover = COMP_KEYS.map((k) => `${COMP_HE[k]} ${r[k] ?? '–'}`).join(' · ');
  return (
    <div className="ppk-cell">
      <div className="ppk-l">מדד השירות של הרשות · <span className="num">{r.year}</span> <Tip k="svcidx" /></div>
      <div className="ppk-v" title={hover}>
        <Sourced src={() => svcProv(d, grp, seg, 'total')}><span className="num">{r.total}</span></Sourced>
        <span className="ppk-q">מתוך 100 · <Sourced src={() => svcProv(d, grp, seg, 'rank')}>מקום {rankHe(r)}</Sourced> ב{g.label}</span>
      </div>
      <div className="ppk-s">
        {r.chg != null && r.prev != null && <>מול {g.prev_year ?? r.year - 1}: <Sourced src={() => svcProv(d, grp, seg, 'prev')}><span className={`num ${tone(r.chg)}`}>{sgn(r.chg)}</span></Sourced> (<span className="num">{r.prev}</span>) · </>}
        ממוצע: <Sourced src={() => avgProv(d, seg)}><span className="num">{g.avg.total}</span></Sourced>
      </div>
      <details className="ppk-det">
        <summary>5 הרכיבים והמשקולות</summary>
        <ul className="ppk-comp">
          {COMP_KEYS.map((k) => { const v = r[k], a = g.avg[k]; return (
            <li key={k}>
              <span className="ppk-cl">{COMP_HE[k]} <span className="w2d num">{g.weights[k]}%</span></span>
              <span className="ppk-cbar" aria-hidden="true">{v != null && <i style={{ width: `${v}%` }} />}{a != null && <b style={{ insetInlineStart: `${a}%` }} />}</span>
              {v == null ? <span className="muted">–</span> : <Sourced src={() => svcProv(d, grp, seg, k)}><span className="num">{v}</span></Sourced>}
            </li>); })}
        </ul>
        <div className="ppk-s w2d">פס: ציון החברה; קו: ממוצע המוצר.{r.wait_s != null && <> המתנה ממוצעת לנציג: <Sourced src={() => svcProv(d, grp, seg, 'wait_s')}><span className="num">{r.wait_s}</span> שניות</Sourced> (לא רכיב במדד).</>}</div>
      </details>
      <div className="ppk-src">רשות שוק ההון, מדד השירות {r.year}, עמ' <span className="num">{r.pg}</span> · ברמת החברה המנהלת ({r.name ?? grp}), לא ברמת הקרן</div>
    </div>
  );
}

/** the closing-time distribution as one stacked bar (a picture; the figures are in the table under it) */
export function ClosedBar({ xs, label }: { xs: (number | null)[]; label: string }) {
  return <span className="ppk-stack" role="img" aria-label={label}>{xs.map((v, i) => (v ? <i key={i} className={`b${i}`} style={{ width: `${v}%` }} /> : null))}</span>;
}

/** a company's own claims report of 2025: disability and survivors approved, rejected, closed within 30 days, and the full
 *  closing-time distribution on expand. Labelled "דיווח החברה"; the reason in one line where there is none. */
export function ClaimsCell({ d, grp }: { d: DecisionFile | null | undefined; grp: string }) {
  if (d === undefined) return <div className="ppk-cell"><div className="ppk-l">תביעות</div><div className="ppk-none">טוען…</div></div>;
  const c = d ? companyOf(d, grp)?.claims : null;
  const B = d?.fund_claims?.buckets ?? BUCKETS_DEFAULT;
  const head = <div className="ppk-l">תביעות שנסגרו <span className="chip est">{SELF_REPORT}, <span className="num">{c?.year ?? 2025}</span></span> <Tip k="claims" /></div>;
  if (!d || !c) return <div className="ppk-cell">{head}<div className="ppk-none">לא מוצג: {d ? claimsWhy(d, grp) : 'קובץ נתוני ההחלטה לא פורסם'}</div></div>;
  const s = srcOf(d, c.src);
  const F = (side: 'disability' | 'survivors', w: Parameters<typeof claimProv>[3], v: number | null) => (v == null ? <span className="muted">–</span> : <Sourced src={() => claimProv(d, grp, side, w)}><span className="num">{pc1(v)}</span></Sourced>);
  const row = (side: 'disability' | 'survivors', l: string, x: ClaimSide) => (
    <tr key={side}><th scope="row">{l}</th><td>{F(side, 'approved', x.approved)}</td><td>{F(side, 'rejected', x.rejected)}</td><td>{F(side, 'closed0', x.closed[0])}</td></tr>
  );
  const tiny = [c.disability.n_closed, c.survivors.n_closed].some((n) => n != null);
  return (
    <div className="ppk-cell">
      {head}
      <table className="ppk-clm">
        <caption className="sr-only">תביעות שנסגרו ב-{c.year}, {c.entity}</caption>
        <thead><tr><th><span className="sr-only">כיסוי</span></th><th>אושרו</th><th>נדחו</th><th>תוך 30 יום</th></tr></thead>
        <tbody>{row('disability', 'נכות', c.disability)}{row('survivors', 'שאירים', c.survivors)}</tbody>
      </table>
      <div className="ppk-stacks">
        <span className="w2d">נכות</span><ClosedBar xs={c.disability.closed} label={`משך הטיפול בתביעות נכות: ${B.map((b, i) => `${b} ${pc1(c.disability.closed[i])}`).join(', ')}`} />
        <span className="w2d">שאירים</span><ClosedBar xs={c.survivors.closed} label={`משך הטיפול בתביעות שאירים: ${B.map((b, i) => `${b} ${pc1(c.survivors.closed[i])}`).join(', ')}`} />
      </div>
      <details className="ppk-det">
        <summary>משך הטיפול, כל ההתפלגות</summary>
        <table className="ppk-clm dist">
          <caption className="sr-only">התפלגות התביעות שנסגרו לפי משך הטיפול</caption>
          <thead><tr><th><span className="sr-only">משך</span></th><th>נכות</th><th>שאירים</th></tr></thead>
          <tbody>{B.map((b, i) => <tr key={b}><th scope="row"><i className={`ppk-key b${i}`} aria-hidden="true" />{b}</th><td>{F('disability', `closed${i as 0}`, c.disability.closed[i])}</td><td>{F('survivors', `closed${i as 0}`, c.survivors.closed[i])}</td></tr>)}</tbody>
        </table>
        <div className="ppk-s w2d">אושרו = שולמו ושולמו חלקית. מתוך התביעות שנסגרו בשנה; {c.disability.cancelled != null && <>בוטלו בנכות: {F('disability', 'cancelled', c.disability.cancelled)}</>}.</div>
      </details>
      {tiny && <div className="ppk-s warn">מספר קטן מאוד: <span className="num">{c.disability.n_closed ?? '–'}</span> תביעות נכות ו-<span className="num">{c.survivors.n_closed ?? '–'}</span> של שאירים נסגרו בשנה, והאחוזים אינם יציבים.</div>}
      <div className="ppk-src">{SELF_REPORT}: {c.entity}, נספח ב3 לחוזר איסוף מידע סטטיסטי {c.year}{c.pg != null ? <>, עמ' <span className="num">{c.pg}</span></> : c.sheet ? `, גיליון "${c.sheet}"` : ''}{s?.url ? <> · <a href={s.url} target="_blank" rel="noreferrer">הקובץ</a></> : null}. כל קרנות הפנסיה של החברה יחד; לא נבדק על ידי הרשות</div>
    </div>
  );
}

const ruleText = (r: CoverRule) => r.detail ?? (r.opts ? `אפשרויות: ${r.opts.join(', ')}${typeof r.default === 'number' ? `; ברירת המחדל: ${r.default}` : ''}.` : '');
/** the default coverage of a comprehensive pension fund, rule by rule, each with its clause and page in the bylaws */
export function CoverDefault({ d, open = false }: { d: DecisionFile; open?: boolean }) {
  const s = srcOf(d, d.coverage_default.src);
  return (
    <details className="ppk-cov" open={open}>
      <summary>כיסוי ביטוחי ברירת מחדל בקרן מקיפה <span className="w2d">· התקנון האחיד, {d.coverage_default.rules.length} כללים</span></summary>
      <ul className="ppk-rules">
        {d.coverage_default.rules.map((r) => (
          <li key={r.id}>
            <b>{r.title}</b> <span>{ruleText(r)}</span>{' '}
            <Sourced className="ppk-cite" src={() => coverProv(d, r)}>סעיף {r.clause}, עמ' {r.pg}{r.pg_to ? `-${r.pg_to}` : ''}</Sourced>
            {r.tracks && <table className="ppk-tracks">
              <caption className="sr-only">מסלולי הביטוח: שיעור הכיסוי לנכות ולשאירים מהשכר המבוטח</caption>
              <thead><tr><th>מסלול</th><th>נכות</th><th>שאירים</th><th>הערה</th></tr></thead>
              <tbody>{r.tracks.map((t) => <tr key={t.n}><td><span className="num">{t.n}</span></td><td><span className="num">{t.disability_pct}%</span></td><td><span className="num">{t.survivors_pct}%</span></td><td>{t.note ?? ''}</td></tr>)}</tbody>
            </table>}
          </li>
        ))}
      </ul>
      <div className="ppk-s w2d">מקור: {s?.title ?? 'התקנון'}{s?.publisher ? ` (${s.publisher})` : ''}. פרק הכיסויים לפי התקנון האחיד של הרשות לקרן מקיפה, כפי שנקרא בתקנון של קרן אחת; קרן אחרת עשויה להיות שונה במקום שהתקנון האחיד מתיר בחירה. העלות בפועל של הכיסוי אינה במאגרים הפתוחים.</div>
    </details>
  );
}

/** the pointer to the managers'-insurance checklist (fund card of a bituach-net managers'-insurance track) */
export function BmNote({ f }: { f: { prod: string; fam?: string } }) {
  const kind = f.fam === 'insurance' ? bmKind(f.prod) : null;
  if (!kind) return null;
  return (
    <aside className="panel bm-note" aria-label="ביטוחי מנהלים ישנים">
      <span className="icotile" aria-hidden="true">!</span>
      <p>{kind === 'old' ? 'פוליסת ביטוח מנהלים מהדור הזה (1990-2003) עשויה לכלול מקדם קצבה מובטח ותנאים נוספים שלא נשמרים אחרי מעבר.' : 'ביטוח מנהלים שהתחיל לפני 2013 (או 2012, לפי נוסח אחר באותו מקור) עשוי לכלול מקדם קצבה מובטח. פוליסת חיסכון אינה ביטוח מנהלים.'}{' '}
        <Link to={BM_HREF}>ביטוחי מנהלים ישנים: מה בודקים לפני שעוזבים</Link></p>
    </aside>
  );
}
