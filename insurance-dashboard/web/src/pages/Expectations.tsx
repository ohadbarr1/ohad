import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Loading, Panel } from '../components/ui';
import { useLoad } from '../lib/useData';
import { idCss } from '../lib/identity';
import { fmt, fmtS } from '../lib/drivers';
import { EXPECTATIONS_INDEX, NONBINDING, LEVER_NOTE, LEVER_SHORT, dateHe, pctText, pctTone, reqText, type EIndex, type EIndexRow, type EPart, type LeverKey } from '../lib/expectations';
import '../styles/expectations.css';

/* A3 · /expectations: every listed name ranked by how extreme its required inputs are. The rank is the highest percentile among the
   components (ties: the next highest, and so on); every component is on the row, there is no composite score. Not a navigation item:
   linked from the valuation tab and search. What the multiple implies, not a recommendation. */

const COLS: LeverKey[] = ['aum', 'fee', 'ci', 'csm', 'roe'];
const iso = (s: string) => `⁦${s}⁩`;

function Cell({ p }: { p: EPart | undefined }) {
  if (!p) return <span className="na s" title="אין לחברה רכיב כזה (או שהוא לא מדווח)">–</span>;
  if (p.status === 'nonbinding') return <><span className="v nbt">{NONBINDING}</span><span className="s">{p.reason}</span></>;
  const tone = pctTone(p.pct);
  return (
    <>
      <span className="v num">{reqText(p)}</span>
      <span className={`exp-chip ${tone}`}>{pctText(p.pct)}</span>
      {p.pct != null && <span className={`exp-meter exp-chip ${tone}`} aria-hidden="true"><i style={{ width: `${Math.max(3, Math.min(100, p.pct))}%` }} /></span>}
      <span className="s">עכשיו {iso(p.k === 'fee' ? `${fmt(p.trail, 2)}%` : `${fmt(p.trail, 1)}%`)}</span>
    </>
  );
}

function Row({ r }: { r: EIndexRow }) {
  const by = new Map((r.parts ?? []).map((p) => [p.k, p]));
  return (
    <li>
      <div className="n">{r.rank}</div>
      <div className="who"><i className="exp-dot" style={{ background: idCss(r.id) }} aria-hidden="true" /><Link to={`/valuation/${r.id}/expectations`}>{r.name}</Link>
        <span className="s" style={{ flexBasis: '100%' }}>{r.kind === 'insurance_group' ? 'קבוצת ביטוח' : 'בית השקעות'}{r.gap != null && <> · שוק מול מודל בערכים נוכחיים <span className="num">{iso(`${fmtS(r.gap, 0)}%`)}</span></>}</span></div>
      <div data-l="P/B" className="pb"><span className="v num">{iso(`${fmt(r.pb, 2)}x`)}</span></div>
      {COLS.map((k) => <div key={k} data-l={LEVER_SHORT[k]} className={by.get(k) ? 'lv' : 'lv nr'}><Cell p={by.get(k)} /></div>)}
      <div data-l="האחוזון הגבוה" className="mx"><span className={`v num exp-chip ${pctTone(r.max)}`}>{r.max == null ? '–' : fmt(r.max, 0)}</span><span className="s">אחוזון</span></div>
      <p className="vd">{r.verdict}</p>
    </li>
  );
}

export function Expectations() {
  const { data, error } = useLoad<EIndex>(EXPECTATIONS_INDEX);
  if (error) return <ErrorBox what="ציפיות השוק" error={error} />;
  if (!data) return <Loading what="ציפיות השוק" />;
  const ok = data.companies.filter((c) => c.status === 'ok');
  const na = data.companies.filter((c) => c.status !== 'ok');
  if (!ok.length) return <Empty title="לא חושבו ציפיות שוק" />;
  const m = data.meta;
  return (
    <div className="exp">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="value" /></span>ציפיות השוק</h1>
        <div className="sub"><span><span className="num">{ok.length}</span> חברות נסחרות</span><span>·</span><span>מה המכפיל דורש עד {m.horizon}, מנוף אחד בכל פעם</span><span>·</span>
          <span className="chip est" title="שווי השוק הוא קלט ידני ליום זה; אין היסטוריית מחירים">{m.price_label}</span><span>·</span><Link to="/valuation/phoenix">הערכת שווי</Link></div>
      </div></div>

      <Panel title="דירוג: עד כמה הדרישה רחוקה ממה שהחברה עשתה" aside={<span>אחוזון = חלק ההיסטוריה של החברה שדורש פחות; 100 = מעולם לא</span>}>
        <ol className="exp-rank">
          <li className="hd" aria-hidden="true"><div /><div>חברה</div><div>P/B</div>{COLS.map((k) => <div key={k} title={LEVER_NOTE[k]}>{LEVER_SHORT[k]}</div>)}<div>הגבוה</div></li>
          {ok.map((r) => <Row key={r.id} r={r} />)}
        </ol>
        <div className="src">
          לכל חברה: מודל קדימה עד {m.horizon} (רווח מנורמל, חיסכון = נכסים × תשואת דמי ניהול × (1 − עלות להכנסה), שחרור CSM, ההון שנצבר בריבית חסרת סיכון) וערך סיום ב-P/B מוצדק, מהוון ב-ke מ-{dateHe(m.price_date)}.
          כל מנוף נפתר לבדו, השאר בערכם הנוכחי; ROE {m.horizon} הוא המסלול שכל המנופים יחד צריכים לייצר. מדורג לפי האחוזון הגבוה מבין המנופים המכריעים ו-ROE, בשוויון לפי הבא אחריו; מנוף שאינו מכריע (פלח מתחת ל-15% מהרווח לפני מס, אין פתרון בטווח, או יותר מפי 2 מהשיא של החברה) לא נכנס לדירוג. ניתוח של מה שהמכפיל מגלם, לא המלצה.
        </div>
      </Panel>
      {na.length > 0 && <div className="src">לא חושב: {na.map((c, i) => <span key={c.id}>{i ? ' · ' : ''}<Link to={`/company/${c.id}`}>{c.name}</Link> ({c.why})</span>)}</div>}
    </div>
  );
}
