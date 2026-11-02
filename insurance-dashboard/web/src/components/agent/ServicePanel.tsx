import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sourced } from '../Source';
import { Tip } from '../Explain';
import { MgrChip } from '../MgrChip';
import { DataTable, type Column } from '../DataTable';
import { Empty, Loading, Panel, Pick, Seg } from '../ui';
import { useOptional } from '../../lib/fundsLoad';
import { BUCKETS_DEFAULT, COMP_HE, COMP_KEYS, DECISION_PATH, INS_HE, INS_KEYS, SELF_REPORT, avgProv, claimProv, claimsWhy, claimsWhyTech, insProv, pc1, sgn, srcOf, svcProv,
  type Claims, type DecisionFile, type InsKey, type SegKey, type SvcRow } from '../../lib/decision';
import { ClosedBar } from './Decision';
import './glossary';
import '../../styles/agent.css';

/* W2 · /managers?v=svc ("שירות ותביעות", agent and Pro doors): the regulator's service index 2025 by segment (pension, gemel,
   managers' insurance and savings policies) with its five components, sortable; the insurance products' scores (claims paid and
   speed are the regulator's scores, not rates); and the pension companies' own claims reports, labelled as self-reports, with the
   companies whose report was not found named with the reason. */

type View = SegKey | 'ins';
const VIEWS: [View, string][] = [['pension', 'קרנות פנסיה'], ['gemel', 'קופות גמל'], ['life_savings', 'ביטוח מנהלים ופוליסות חיסכון'], ['ins', 'מוצרי ביטוח']];
interface Row { grp: string; r: SvcRow }

export function ServiceClaims() {
  const d = useOptional<DecisionFile>(DECISION_PATH);
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const view = (VIEWS.map(([v]) => v).find((v) => v === sp.get('seg')) ?? 'pension') as View;
  const ip = (Object.keys(INS_HE) as InsKey[]).find((k) => k === sp.get('ip')) ?? 'disability';
  const rows = useMemo<Row[]>(() => (!d ? [] : Object.values(d.companies).flatMap((c) => {
    const r = view === 'ins' ? c.ins_service?.[ip] : c.service?.[view];
    return r ? [{ grp: c.grp, r }] : [];
  }).sort((a, b) => a.r.rank - b.r.rank || b.r.total - a.r.total)), [d, view, ip]);
  if (d === undefined) return <Loading what="מדד השירות" />;
  if (d === null) return <Empty title="קובץ נתוני ההחלטה לא פורסם" />;
  const seg = view === 'ins' ? null : d.segments[view];
  const ins = view === 'ins' ? d.ins_products?.[ip] : null;
  const src = srcOf(d, seg?.src ?? ins?.src ?? 'si25');
  const P = (row: Row, what: 'total' | 'rank' | 'prev' | 'wait_s' | (typeof COMP_KEYS)[number] | (typeof INS_KEYS)[number]) =>
    view === 'ins' ? insProv(d, row.grp, ip, what === 'rank' || what === 'prev' || what === 'wait_s' ? 'total' : (what as 'total')) : svcProv(d, row.grp, view, what as 'total');
  const cols: Column<Row>[] = [
    { key: 'co', head: 'חברה', value: (x) => x.r.name ?? x.grp, tdClass: () => 'lbl', cell: (x) => <><MgrChip grp={x.grp} />{x.r.name && x.r.name !== x.grp && <span className="w2d"> · {x.r.name}</span>}</> },
    { key: 'total', head: 'המדד', value: (x) => x.r.total, d: 0, src: (x) => P(x, 'total') },
    { key: 'rank', head: 'מקום', value: (x) => x.r.rank, firstDir: 'asc', cell: (x) => <Sourced src={() => P(x, 'rank')}><span className="num">{x.r.rank}/{x.r.of}</span></Sourced> },
    ...(view !== 'ins' ? [
      { key: 'chg', head: `מול ${seg?.prev_year ?? ''}`, value: (x: Row) => x.r.chg ?? null, cell: (x: Row) => (x.r.chg == null ? <span className="muted">–</span> : <Sourced src={() => P(x, 'prev')}><span className={`num ${x.r.chg > 0 ? 'pos' : x.r.chg < 0 ? 'neg' : ''}`}>{sgn(x.r.chg)}</span></Sourced>) },
      ...COMP_KEYS.map((k): Column<Row> => ({ key: k, head: <>{COMP_HE[k]} <span className="w2d num">{seg?.weights[k]}%</span></>, label: `${COMP_HE[k]} (${seg?.weights[k]}%)`, value: (x) => x.r[k] ?? null, d: 0, src: (x) => P(x, k) })),
      { key: 'wait', head: 'המתנה לנציג, שנ׳', title: 'זמן המתנה ממוצע לנציג בשניות; אינו רכיב במדד', value: (x: Row) => x.r.wait_s ?? null, d: 0, firstDir: 'asc' as const, src: (x: Row) => P(x, 'wait_s') },
    ] : INS_KEYS.map((k): Column<Row> => ({ key: k, head: COMP_HE[k], value: (x) => x.r[k] ?? null, d: 0, src: (x) => insProv(d, x.grp, ip, k) }))),
  ];
  const avgs = seg ? seg.avg : ins?.avg;
  return (
    <>
      <Panel title={<>מדד השירות של הרשות · {view === 'ins' ? ins?.label : seg?.label} · <span className="num">{(seg ?? ins)?.year}</span> <Tip k="svcidx" /></>}
        aside={<><span className="chip">רשות שוק ההון</span>{src && <a href={src.url} target="_blank" rel="noreferrer">המצגת, עמ' <span className="num">{(seg ?? ins)?.pg}</span></a>}</>}>
        <div className="svc-head">
          <Seg<View> label="מוצר" value={view} onChange={(v) => set('seg', v === 'pension' ? null : v)} options={VIEWS} />
          {view === 'ins' && <Pick label="מוצר ביטוח" cap="מוצר" value={ip} onChange={(v) => set('ip', v === 'disability' ? null : v)} options={(Object.keys(INS_HE) as InsKey[]).filter((k) => d.ins_products?.[k]).map((k) => [k, INS_HE[k]] as [string, string])} />}
          <span className="w2d"><span className="num">{rows.length}</span> חברות</span>
        </div>
        {rows.length ? <DataTable<Row> caption="מדד השירות לפי חברה" className="svc-t" rows={rows} rowKey={(x) => x.grp} columns={cols}
          export={{ name: `fox-service-index-${view === 'ins' ? ip : view}`, title: 'מדד השירות', note: `רשות שוק ההון, מדד השירות ${(seg ?? ins)?.year}, עמ' ${(seg ?? ins)?.pg}` }} /> : <Empty title="אין נתונים למוצר הזה" />}
        {avgs && <p className="svc-avg">ממוצע המוצר (כפי שהרשות פרסמה): המדד <Sourced src={() => (seg ? avgProv(d, view as SegKey) : { k: 'report', title: `ממוצע · ${ins?.label}`, value: String(avgs.total), url: src?.url ?? null, pg: ins?.pg ?? null, doc: src?.title })}><span className="num">{avgs.total}</span></Sourced>
          {seg && COMP_KEYS.map((k) => <span key={k}> · {COMP_HE[k]} <Sourced src={() => avgProv(d, view as SegKey, k)}><span className="num">{avgs[k]}</span></Sourced></span>)}</p>}
        <div className="fnote">{view === 'ins'
          ? <>{d.ins_scale ?? 'ציונים 0-100 שהרשות מחשבת, לא שיעורים'}. רכיב התביעות הוא ממוצע ציון שיעור התשלום וציון מהירות הטיפול.</>
          : <>ברמת החברה המנהלת: כל קרנותיה או קופותיה במוצר יחד. ציון 0-100 לכל רכיב, והמדד הוא סכומם במשקולות שהרשות פרסמה (עמ' <span className="num">{seg?.pg_weights ?? seg?.pg}</span>). {view === 'life_savings' ? 'ביטוח חיים משולב חיסכון: ביטוחי מנהלים ופוליסות חיסכון של חברת הביטוח יחד. ' : ''}מקום: לפי המדד, שוויון באותו מקום. המדד אינו כולל תשואה או דמי ניהול, ובחיסכון הפנסיוני אין בו רכיב תביעות.</>} תיאור עובדתי, לא המלצה.</div>
      </Panel>
      {view === 'pension' && <ClaimsTable d={d} />}
    </>
  );
}

interface CRow { grp: string; c: Claims }
/** the pension companies' own claims reports of 2025 (annex B3), and the companies whose report was not found */
export function ClaimsTable({ d }: { d: DecisionFile }) {
  const B = d.fund_claims?.buckets ?? BUCKETS_DEFAULT;
  const rows: CRow[] = Object.values(d.companies).filter((c) => c.claims).map((c) => ({ grp: c.grp, c: c.claims! }))
    // a report built on a handful of claims (only Infinity publishes counts) goes last: its percentages are not comparable
    .sort((a, b) => Number(a.c.disability.n_closed != null) - Number(b.c.disability.n_closed != null) || (b.c.disability.approved ?? -1) - (a.c.disability.approved ?? -1));
  const miss = Object.values(d.companies).filter((c) => !c.claims && (c.claims_missing || c.service?.pension));
  const F = (side: 'disability' | 'survivors', w: Parameters<typeof claimProv>[3]) => (x: CRow) => claimProv(d, x.grp, side, w);
  const cols: Column<CRow>[] = [
    { key: 'co', head: 'חברה מנהלת', value: (x) => x.c.entity, tdClass: () => 'lbl', cell: (x) => <><MgrChip grp={x.grp} mgr={x.c.entity} />{x.c.disability.n_closed != null && <span className="chip est" title="מספרי התביעות שפורסמו: קטנים מאוד">{x.c.disability.n_closed} תביעות נכות</span>}</> },
    { key: 'da', head: 'נכות: אושרו', value: (x) => x.c.disability.approved, unit: 'pct', d: 1, src: F('disability', 'approved') },
    { key: 'dr', head: 'נכות: נדחו', value: (x) => x.c.disability.rejected, unit: 'pct', d: 1, firstDir: 'asc', src: F('disability', 'rejected') },
    { key: 'd30', head: `נכות: ${B[0]}`, value: (x) => x.c.disability.closed[0], unit: 'pct', d: 1, src: F('disability', 'closed0') },
    { key: 'dbar', head: 'נכות: משך הטיפול', noExport: true, sortable: false, width: 110, cell: (x) => <ClosedBar xs={x.c.disability.closed} label={`${x.grp}, נכות: ${B.map((b, i) => `${b} ${pc1(x.c.disability.closed[i])}`).join(', ')}`} /> },
    { key: 'sa', head: 'שאירים: אושרו', value: (x) => x.c.survivors.approved, unit: 'pct', d: 1, src: F('survivors', 'approved') },
    { key: 'sr', head: 'שאירים: נדחו', value: (x) => x.c.survivors.rejected, unit: 'pct', d: 1, firstDir: 'asc', src: F('survivors', 'rejected') },
    { key: 's30', head: `שאירים: ${B[0]}`, value: (x) => x.c.survivors.closed[0], unit: 'pct', d: 1, src: F('survivors', 'closed0') },
    { key: 'src', head: 'מקור', value: (x) => srcOf(d, x.c.src)?.title ?? '', sortable: false, cell: (x) => { const s = srcOf(d, x.c.src); return s ? <a href={s.url} target="_blank" rel="noreferrer">{x.c.pg != null ? `עמ' ${x.c.pg}` : x.c.sheet ? 'גיליון' : 'הקובץ'}</a> : '–'; } },
  ];
  const general = d.missing.filter((m) => !m.grp && /claims/.test(m.what));
  return (
    <Panel title={<>תביעות בקרנות הפנסיה · <span className="num">{d.fund_claims?.year ?? 2025}</span> <Tip k="claims" /></>} aside={<><span className="chip est">{SELF_REPORT}</span><span>נספח ב3 לחוזר איסוף מידע סטטיסטי</span></>}>
      <DataTable<CRow> caption="תביעות נכות ושאירים שנסגרו, לפי חברה מנהלת" className="svc-t" rows={rows} rowKey={(x) => x.grp} columns={cols}
        export={{ name: `fox-pension-claims-${d.fund_claims?.year ?? 2025}`, title: 'תביעות בקרנות הפנסיה', note: `${SELF_REPORT}: נספח ב3, ${d.fund_claims?.year ?? 2025}; אחוזים מתוך התביעות שנסגרו` }} />
      {miss.length > 0 && <ul className="fnote" aria-label="חברות שהדוח שלהן לא מוצג">{miss.map((c) => <li key={c.grp}><b>{c.grp}</b>: לא מוצג. {claimsWhy(d, c.grp)}</li>)}</ul>}
      {miss.length > 0 && <details className="fnote fmethod"><summary>מתודולוגיה: איך חיפשנו את הדוחות</summary><ul>{miss.map((c) => <li key={c.grp}><b>{c.grp}</b>: {claimsWhyTech(d, c.grp)}</li>)}</ul></details>}
      <div className="fnote">כל חברה מפרסמת את הדוח באתר שלה; הוא ברמת החברה המנהלת (כל קרנות הפנסיה שלה יחד), לא נבדק על ידי הרשות, ואינו כולל את מספר התביעות. אחוזים מתוך התביעות שנסגרו בשנה; אושרו = שולמו ושולמו חלקית. משך הטיפול, מירוק לאדום: {B.join(', ')}. {general.map((m) => m.reason).join('. ')}.</div>
    </Panel>
  );
}
