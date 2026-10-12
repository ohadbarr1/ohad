import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Loading, Panel } from './ui';
import { nf, byPeriodDesc, dateLabel } from '../lib/format';
import { load, useIfrsData, useRegistry } from '../lib/useData';
import type { IfrsData, IfrsFact } from '../lib/types';
import { METRIC_HE } from '../lib/labels';
import { endOf, hrefOf, periodName, prevQuarter, tag } from '../lib/csm';
import type { Reports, RF } from '../lib/csm';
import '../styles/csm.css';

/* Dividend capacity as the reports print it: solvency with and without the transitional measures, the board's target and dividend threshold,
   the surplus over the target, what was declared and paid in the last four quarters, and the stated payout policy.
   One line is computed here (the surplus over the target, where a filer does not print it) and it is labelled as derived, with its three sources. */

type TB = 'w' | 'wo' | '?';
const WO = /without[ _](the )?(application of )?(the )?(transitional|tmtp)|ללא (התחשבות ב|יישום |)הוראות/i;
const WI = /\bwith[ _](the )?(application of )?(the )?(transitional|tmtp)|taking (the )?transitional|בתקופת הפריסה|ביישום הוראות|בהתחשב בהוראות/i;
/** Whether a capital figure is stated with or without the transitional measures: from its metric, else from the printed label, the entity column, the extractor's note, in that order. */
const basisOf = (f: RF): TB => {
  if (/without_(transitional|tmtp)/.test(f.m)) return 'wo';
  if (/with_(transitional|tmtp)/.test(f.m)) return 'w';
  for (const t of [f.l, f.s, f.n ?? '']) { if (WO.test(t)) return 'wo'; if (WI.test(t)) return 'w'; }
  return '?';
};
/** A figure restated for capital actions after the calculation date (an issuance, a dividend): shown, tagged, and never used in the derived line. */
const isAfter = (f: RF) => /_after_|pro_forma/.test(f.m) || (/\bafter\b|לאחר|pro forma/i.test(f.l) && !/before|לפני/i.test(f.l)) || /incl\. [\d.]+ issuance|pro forma/i.test(f.n ?? '');
const afterTag = (f: RF) => (!isAfter(f) ? '' : /לאחר חלוקות דיבידנד/.test(f.l) ? 'לאחר חלוקות דיבידנד' : 'לאחר פעולות הון');
const ENT: [RegExp, string][] = [[/wesure/i, 'ווישור'], [/shomera/i, 'שומרה'], [/^max$|credit_cards/i, 'מקס']];
const entOf = (f: RF) => ENT.find(([re]) => re.test(f.s))?.[1] ?? '';
const TB_HE: Record<TB, string> = { w: 'עם הוראות מעבר', wo: 'ללא הוראות מעבר', '?': '' };

const RATIO = /^solvency_ratio_(with|without)_transitional(_after_capital_(actions|events|raise|transactions)|_pro_forma)?$/;
const OWN = /^own_funds(_with_transitional|_without_transitional)?$/, SCR = /^scr(_with_transitional|_without_transitional)?$/;
const TARGET = /^target_solvency_ratio(_board|_minimum|_min_stability|_min_stability_with_transitional|_min_with_transitional|_min_without_transitional|_with_transitional_minimum|_minimum_end_2032)?$/;
const THRESH = /^target_(solvency_ratio_dividend_threshold|dividend_threshold|solvency_dividend_threshold)/;
const OVER = /^(solvency_surplus_(over_target|vs_board_target|vs_target)|surplus_vs_(board_)?target|excess_capital_over_target|target_solvency_surplus_vs_board_target(_without_transitional)?)$/;
const POLICY = /^target_(dividend_payout|total_payout|share_buyback)/;
const isPct = (m: string) => !/share_buyback/.test(m);

type V = { f: RF; tags: string[] };
type Derived = { v: number; own: RF; scr: RF; target: RF; basis: TB; ent: string; /** the target is a dividend threshold rather than the board's capital target */ thresh: boolean };
type Div = { v: number; fs: RF[]; der: boolean } | null;
export interface Capacity {
  /** solvency dates with a ratio, newest first */ dates: string[];
  ratio: (d: string, b: TB) => V[]; target: V[]; thresh: V[]; over: (d: string) => V[]; derived: (d: string) => Derived[];
  quarters: string[]; declared: Div[]; paid: Div[]; after: V[]; policy: V[];
}

const uniq = (vs: V[]) => { const seen = new Set<string>(); return vs.filter((x) => { const k = `${x.f.v}|${x.tags.join()}`; return !seen.has(k) && !!seen.add(k); }); };

/** Everything the view shows for one company, read from its reports newest first: the latest report that prints a line is the one quoted. */
export function capacity(rs: Reports, lastP: string): Capacity {
  const desc = [...rs].reverse();
  // the facts of the newest report that has any match
  const latest = (test: (f: RF) => boolean): RF[] => { for (const r of desc) { const xs = r.F.filter(test); if (xs.length) return xs; } return []; };
  const horizon = endOf(lastP);
  const when = (f: RF) => (f.d > horizon ? `יעד ל-${f.d.slice(0, 4)}` : dateLabel(f.d));
  const from = (f: RF) => (f.rp !== lastP ? `מדוח ${periodName(f.rp)}` : '');
  // a target is a statement of policy: it carries its entity, its basis, the date or horizon it is stated for, and the report it is quoted from when that is not the latest
  const kind = (f: RF) => (METRIC_HE[f.m] ?? '').replace(/^(יעד יחס כושר פירעון|סף כושר פירעון לחלוקת דיבידנד|סף לחלוקת דיבידנד)/, '').replace(/,? ?(עם|ללא) הוראות מעבר/, '').replace(/^[\s,(]+|[\s)]+$/g, '');
  const stated = (f: RF) => [entOf(f), kind(f), TB_HE[basisOf(f)], f.src === 'text' ? 'מטקסט' : '', when(f), from(f)].filter(Boolean);
  const tags = (f: RF) => [entOf(f), TB_HE[basisOf(f)], afterTag(f), f.src === 'text' ? 'מטקסט' : ''].filter(Boolean);
  const dates = [...new Set(rs.flatMap((r) => r.F.filter((f) => RATIO.test(f.m) && f.d <= horizon).map((f) => f.d)))].sort().reverse();
  const ratio = (d: string, b: TB) => uniq(latest((f) => RATIO.test(f.m) && f.d === d && basisOf(f) === b).map((f) => ({ f, tags: [entOf(f), afterTag(f), f.src === 'text' ? 'מטקסט' : ''].filter(Boolean) })));
  const target = uniq(latest((f) => TARGET.test(f.m)).sort((a, b) => b.d.localeCompare(a.d)).map((f) => ({ f, tags: stated(f) }))).slice(0, 6);
  const thresh = uniq(latest((f) => THRESH.test(f.m)).map((f) => ({ f, tags: stated(f) })));
  const over = (d: string) => uniq(latest((f) => OVER.test(f.m) && f.d === d).map((f) => ({ f, tags: tags(f) })));
  // own funds less target times SCR: only when the three are printed for the same date, entity and transitional basis, each exactly once
  const derived = (d: string): Derived[] => {
    const printed = over(d), out: Derived[] = [];
    const plain = (re: RegExp) => latest((f) => re.test(f.m) && f.d === d && !isAfter(f) && !/mcr/i.test(`${f.m} ${f.l}`));
    const own = plain(OWN), scr = plain(SCR), tg = uniq(desc.flatMap((r) => r.F.filter((f) => (TARGET.test(f.m) || THRESH.test(f.m)) && f.d === d && basisOf(f) !== '?')).map((f) => ({ f, tags: [entOf(f), basisOf(f)] })));
    tg.forEach(({ f: t }) => {
      const b = basisOf(t), e = entOf(t);
      if (printed.some((p) => entOf(p.f) === e) || out.some((o) => o.basis === b && o.ent === e && o.target.v === t.v)) return;
      const one = (xs: RF[]) => { const m = xs.filter((f) => basisOf(f) === b && entOf(f) === e); return new Set(m.map((f) => f.v)).size === 1 ? m[0] : null; };
      const o = one(own), s = one(scr);
      if (o && s) out.push({ v: o.v - (t.v / 100) * s.v, own: o, scr: s, target: t, basis: b, ent: e, thresh: THRESH.test(t.m) });
    });
    return out;
  };

  // the last four quarters: the quarter column where printed, else the difference of two cumulative columns (Q4 = FY less 9M), flagged
  const quarters: string[] = []; for (let p = lastP, i = 0; i < 4; i++, p = prevQuarter(p)) quarters.unshift(p);
  const flow = (m: string, p: string, ws: string[]): RF | null => {
    const d = endOf(p), order = [...rs.filter((r) => r.p === p), ...rs.filter((r) => r.p !== p)];
    for (const r of order) { const xs = r.F.filter((f) => f.m === m && f.g === 'group' && f.s === 'group' && f.d === d && ws.includes(f.w)).sort((a, b) => Number(a.src === 'text') - Number(b.src === 'text') || ws.indexOf(a.w) - ws.indexOf(b.w)); if (xs[0]) return xs[0]; }
    return null;
  };
  const div = (m: string) => quarters.map((p): Div => {
    const first = p.endsWith('Q1'), annual = p.endsWith('FY');
    const q = annual ? null : flow(m, p, first ? ['q', 'ytd'] : ['q']);
    if (q) return { v: Math.abs(q.v), fs: [q], der: false };
    // a first quarter the report does not print: the half-year column less the second-quarter column of the next report
    if (first) { const n = `${p.slice(0, 4)}Q2`, c = flow(m, n, ['ytd']), q2 = flow(m, n, ['q']); return c && q2 ? { v: Math.abs(c.v) - Math.abs(q2.v), fs: [c, q2], der: true } : null; }
    const cum = flow(m, p, [annual ? 'fy' : 'ytd']), b = prevQuarter(p), prev = flow(m, b, b.endsWith('Q1') ? ['ytd', 'q'] : ['ytd']);
    return cum && prev ? { v: Math.abs(cum.v) - Math.abs(prev.v), fs: [cum, prev], der: true } : null;
  });
  const after = uniq((rs.find((r) => r.p === lastP)?.F ?? []).filter((f) => f.m === 'dividend_declared_after_period' || (f.m === 'dividend_declared' && f.w === 'instant' && f.d > horizon)).map((f) => ({ f, tags: [f.s !== 'group' ? (entOf(f) || 'חברת הביטוח') : '', dateLabel(f.d)].filter(Boolean) })));
  const policy = uniq(latest((f) => POLICY.test(f.m)).map((f) => ({ f, tags: [(METRIC_HE[f.m] ?? f.m).replace(/^יעד /, ''), f.s !== 'group' ? (entOf(f) || 'חברת הביטוח') : '', when(f), from(f)].filter(Boolean) })));
  return { dates, ratio, target, thresh, over, derived, quarters, declared: div('dividend_declared'), paid: div('dividend_paid'), after, policy };
}

const pctText = (v: number) => `${nf(v, Number.isInteger(v) ? 0 : 1)}%`;
const amtText = (v: number) => nf(v, Math.abs(v) < 100 && !Number.isInteger(v) ? 1 : 0);
function Val({ v, d, pct }: { v: V; d: IfrsData; pct: boolean }) {
  const h = hrefOf(v.f, d), text = pct ? pctText(v.f.v) : amtText(v.f.v);
  return <span className="dc-v">{h ? <a className={`num ${v.f.v < 0 ? 'neg' : ''}`} href={h} target="_blank" rel="noreferrer" title={`${v.f.l} · ${periodName(v.f.rp)} עמ׳ ${v.f.pg}`}>{text}</a> : <span className="num" title={v.f.l}>{text}</span>}{v.tags.length > 0 && <span className="dc-t">{v.tags.join(' · ')}</span>}</span>;
}
function Vals({ vs, d, pct }: { vs: V[]; d: IfrsData; pct: boolean }) {
  return vs.length === 0 ? <span className="muted">–</span> : <>{vs.map((v, i) => <Val key={i} v={v} d={d} pct={pct} />)}</>;
}
/** The derived surplus: the figure, the word "נגזר", and a page link for each of its three sources. */
function Der({ x, d }: { x: Derived; d: IfrsData }) {
  const src = (f: RF, l: string) => { const h = hrefOf(f, d); return h ? <a className="num" href={h} target="_blank" rel="noreferrer" title={f.l}>{l}</a> : <span className="num">{l}</span>; };
  return (
    <span className="dc-v"><span className={`num der ${x.v < 0 ? 'neg' : ''}`}>{amtText(Math.round(x.v))}</span> <span className="chip est">נגזר</span>
      <span className="dim">{x.ent && `${x.ent} · `}הון עצמי לעניין SCR {src(x.own, amtText(x.own.v))} פחות {x.thresh ? 'סף לחלוקה' : 'יעד'} {src(x.target, pctText(x.target.v))} כפול SCR {src(x.scr, amtText(x.scr.v))} · {TB_HE[x.basis]}</span></span>
  );
}
function DivCell({ x, d, compact }: { x: Div; d: IfrsData; compact?: boolean }) {
  if (!x) return <span className="muted">–</span>;
  const hs = x.fs.map((f) => [hrefOf(f, d), f] as const);
  // in a one-line list a derived quarter is the figure alone, linked to the cumulative column it starts from; the table spells out both sources
  if (x.der && compact) { const t = `נגזר: ${amtText(Math.abs(x.fs[0].v))} פחות ${amtText(Math.abs(x.fs[1].v))}`; return hs[0][0] ? <a className="num der" href={hs[0][0]} target="_blank" rel="noreferrer" title={t}>{amtText(x.v)}</a> : <span className="num der" title={t}>{amtText(x.v)}</span>; }
  if (!x.der) return hs[0][0] ? <a className="num" href={hs[0][0]} target="_blank" rel="noreferrer" title={`${hs[0][1].l} · ${periodName(hs[0][1].rp)} עמ׳ ${hs[0][1].pg}`}>{amtText(x.v)}</a> : <span className="num">{amtText(x.v)}</span>;
  return <><span className="num der" title="נגזר: מצטבר פחות המצטבר שלפניו">{amtText(x.v)}</span>{hs.map(([h, f], i) => (h ? <a key={i} className="num csm-pg" href={h} target="_blank" rel="noreferrer" title={f.l}>{i === 0 ? '' : 'פחות '}{amtText(Math.abs(f.v))} · עמ׳ {f.pg}</a> : null))}</>;
}
const ltm = (xs: Div[]) => (xs.every(Boolean) ? xs.reduce((t, x) => t + x!.v, 0) : null);
const qName = (p: string) => periodName(p).replace('FY', 'Q4');

/** Reports of the companies asked for: the per-company slices for one insurer, the industry files for all of them. */
function useCapacityData(id: string | undefined, d: IfrsData | null): { byCo: Map<string, Reports>; done: boolean; lastP: string } {
  const [all, setAll] = useState<Map<string, IfrsFact[]>>(new Map());
  const periods = useMemo(() => [...new Set((d?.files ?? []).filter((f) => !id || f.company === id).map((f) => f.period))].sort(byPeriodDesc), [d, id]);
  const key = `${id ?? ''}|${periods.join()}`;
  useEffect(() => {
    let live = true;
    setAll(new Map());
    periods.forEach((p) => load<IfrsFact[]>(id ? `ifrs/${id}/${p}.json` : `ifrs_${p}.json`).then((fs) => live && setAll((cur) => new Map(cur).set(p, fs)), () => live && setAll((cur) => new Map(cur).set(p, []))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const byCo = useMemo(() => {
    const m = new Map<string, Reports>();
    [...periods].reverse().forEach((p) => {
      const by = new Map<string, RF[]>();
      tag(all.get(p) ?? [], p).forEach((f) => { if (!by.has(f.c)) by.set(f.c, []); by.get(f.c)!.push(f); });
      by.forEach((F, c) => { if (!m.has(c)) m.set(c, []); m.get(c)!.push({ p, F }); });
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, key]);
  return { byCo, done: periods.length > 0 && all.size === periods.length, lastP: periods[0] ?? '' };
}

/** Dividend capacity of one insurer, or of all of them side by side when no company is given. Reported figures and one derived line; no forecast. */
export function DividendCapacity({ id }: { id?: string }) {
  const { data: d, error } = useIfrsData();
  const reg = useRegistry();
  const { byCo, done, lastP } = useCapacityData(id, d);
  const caps = useMemo(() => [...byCo.keys()].sort().map((c) => ({ id: c, cap: capacity(byCo.get(c)!, lastP) })), [byCo, lastP]);

  if (error) return <ErrorBox what="נתוני הון ודיבידנד" error={error} />;
  if (!d || (lastP && !done)) return <Loading what="כושר חלוקה" />;
  if (!lastP || caps.length === 0) return <Empty title="הדוחות טרם חולצו" />;
  const name = (c: string) => reg.data?.find((x) => x.id === c)?.name_he ?? c;
  // the date quoted for a company: the newest one with a ratio without the transitional measures, i.e. a full solvency report rather than an interim estimate
  const full = (cap: Capacity) => cap.dates.find((x) => cap.ratio(x, 'wo').length > 0) ?? cap.dates[0] ?? '';
  const later = (cap: Capacity, D: string): V[] => cap.dates.filter((x) => x > D).flatMap((x) => cap.ratio(x, 'w').map((v) => ({ ...v, tags: [...v.tags, dateLabel(x)] })));
  const surplus = (cap: Capacity, D: string) => { const p = cap.over(D), der = cap.derived(D); return p.length === 0 && der.length === 0 ? <span className="muted">–</span> : <>{p.length > 0 && <Vals vs={p} d={d} pct={false} />}{der.map((x, i) => <Der key={i} x={x} d={d} />)}</>; };
  // the newest solvency date for which a surplus over the target is printed or can be derived; it may be older than the date of the ratios, and then says so
  const overDate = (cap: Capacity) => cap.dates.find((x) => cap.over(x).length > 0 || cap.derived(x).length > 0) ?? '';
  const quartersLine = (cap: Capacity, xs: Div[]) => <span className="dim">{cap.quarters.map((p, i) => <span key={p}>{i > 0 && ' · '}{qName(p)} <DivCell x={xs[i]} d={d} compact /></span>)}</span>;
  const ltmCell = (cap: Capacity, xs: Div[]) => { const t = ltm(xs); return <>{t == null ? <span className="muted">–</span> : <span className="num der" title="נגזר: סכום ארבעת הרבעונים">{amtText(t)}</span>}{quartersLine(cap, xs)}</>; };

  if (!id) {
    return (
      <Panel title="כושר חלוקה" aside={<span>מיליוני ש"ח · חברת הביטוח, כפי שדווח · LTM עד {qName(lastP)} · מספר נטוי נגזר</span>}>
        <div className="scroll"><table className="divcap">
          <thead><tr><th>חברה</th><th>יחס כושר פירעון, עם הוראות מעבר</th><th>ללא הוראות מעבר</th><th>יעד הדירקטוריון</th><th>סף לחלוקת דיבידנד</th><th>עודף מעל היעד</th><th>דיבידנד שהוכרז, LTM</th><th>דיבידנד ששולם, LTM</th><th>מדיניות חלוקה</th></tr></thead>
          <tbody>{caps.map(({ id: c, cap }) => { const D = full(cap); return (
            <tr key={c}>
              <td><Link to={`/company/${c}/ifrs17`}>{name(c)}</Link>{D && <span className="dim num">{dateLabel(D)}</span>}</td>
              <td><Vals vs={[...cap.ratio(D, 'w'), ...later(cap, D)]} d={d} pct /></td>
              <td><Vals vs={cap.ratio(D, 'wo')} d={d} pct /></td>
              <td><Vals vs={cap.target} d={d} pct /></td>
              <td><Vals vs={cap.thresh} d={d} pct /></td>
              <td>{surplus(cap, overDate(cap))}{overDate(cap) && overDate(cap) !== D && <span className="dim num">{dateLabel(overDate(cap))}</span>}</td>
              <td>{ltmCell(cap, cap.declared)}</td>
              <td>{ltmCell(cap, cap.paid)}</td>
              <td>{cap.policy.length === 0 ? <span className="muted">–</span> : cap.policy.map((v, i) => <Val key={i} v={v} d={d} pct={isPct(v.f.m)} />)}</td>
            </tr>
          ); })}</tbody>
        </table></div>
        <div className="src">התאריך מתחת לשם החברה הוא תאריך דוח כושר הפירעון המלא האחרון; יחס מאוחר יותר מסומן בתאריך שלו. עודף מעל היעד נגזר רק כשהון עצמי, SCR ויעד מודפסים לאותו תאריך ועל אותו בסיס, לפני פעולות הון שלאחר תאריך החישוב. כמה ערכים בתא בלי תיוג: כפי שהודפסו, לפני ואחרי פעולות הון. דיבידנד: בעלי המניות של החברה, מדוח השינויים בהון ומדוח תזרים המזומנים.</div>
      </Panel>
    );
  }

  const cap = caps[0].cap, D = full(cap), cols = cap.dates.slice(0, 4);
  const head = (l: string, vs: V[], pct: boolean) => <div><span className="l">{l}</span><span className="v">{vs[0] ? <Val v={{ f: vs[0].f, tags: [] }} d={d} pct={pct} /> : <span className="muted">–</span>}</span>{vs[0] && <span className="s">{[...vs[0].tags, dateLabel(vs[0].f.d)].filter((x, i, a) => a.indexOf(x) === i).join(' · ')}</span>}</div>;
  const D1 = overDate(cap), over0 = D1 ? cap.over(D1) : [], der0 = D1 ? cap.derived(D1) : [];
  return (
    <Panel title="כושר חלוקה" aside={<span>מיליוני ש"ח · חברת הביטוח, כפי שדווח · מספר נטוי נגזר</span>}>
      <div className="dc-grid">
        {head('יחס כושר פירעון, עם הוראות מעבר', cap.ratio(D, 'w'), true)}
        {head('ללא הוראות מעבר', cap.ratio(D, 'wo'), true)}
        {head('יעד הדירקטוריון', cap.target, true)}
        <div><span className="l">עודף מעל היעד</span>{over0[0] ? <><span className="v"><Val v={{ f: over0[0].f, tags: [] }} d={d} pct={false} /></span><span className="s">{[...over0[0].tags, dateLabel(D1)].join(' · ')}</span></> : der0[0] ? <>{der0.map((x, i) => <Der key={i} x={x} d={d} />)}<span className="s num">{dateLabel(D1)}</span></> : <span className="v muted">–</span>}</div>
        <div><span className="l">דיבידנד שהוכרז, LTM</span><span className="v">{ltm(cap.declared) == null ? <span className="muted">–</span> : <span className="num der">{amtText(ltm(cap.declared)!)}</span>}</span><span className="s">נגזר: סכום ארבעת הרבעונים עד {qName(lastP)}</span></div>
        <div><span className="l">דיבידנד ששולם, LTM</span><span className="v">{ltm(cap.paid) == null ? <span className="muted">–</span> : <span className="num der">{amtText(ltm(cap.paid)!)}</span>}</span><span className="s">נגזר: סכום ארבעת הרבעונים עד {qName(lastP)}</span></div>
      </div>
      {cols.length > 0 && (
        <div className="scroll"><table className="divcap">
          <thead><tr><th>כושר פירעון</th>{cols.map((x) => <th key={x}><span className="num">{dateLabel(x)}</span></th>)}</tr></thead>
          <tbody>
            <tr><td className="lbl">יחס כושר פירעון, עם הוראות מעבר</td>{cols.map((x) => <td key={x}><Vals vs={cap.ratio(x, 'w')} d={d} pct /></td>)}</tr>
            <tr><td className="lbl">יחס כושר פירעון, ללא הוראות מעבר</td>{cols.map((x) => <td key={x}><Vals vs={cap.ratio(x, 'wo')} d={d} pct /></td>)}</tr>
            <tr><td className="lbl">עודף מעל היעד</td>{cols.map((x) => <td key={x}>{surplus(cap, x)}</td>)}</tr>
          </tbody>
        </table></div>
      )}
      <div className="scroll"><table className="divcap">
        <thead><tr><th>יעדים ומדיניות, כפי שהודפסו</th><th>ערך</th></tr></thead>
        <tbody>
          <tr><td className="lbl">יעד הדירקטוריון ליחס כושר פירעון</td><td><Vals vs={cap.target} d={d} pct /></td></tr>
          <tr><td className="lbl">סף לחלוקת דיבידנד</td><td><Vals vs={cap.thresh} d={d} pct /></td></tr>
          <tr><td className="lbl">מדיניות חלוקה</td><td>{cap.policy.length === 0 ? <span className="muted">–</span> : cap.policy.map((v, i) => <Val key={i} v={v} d={d} pct={isPct(v.f.m)} />)}</td></tr>
          <tr><td className="lbl">דיבידנד שהוכרז לאחר תאריך המאזן</td><td><Vals vs={cap.after} d={d} pct={false} /></td></tr>
        </tbody>
      </table></div>
      <div className="scroll"><table className="divcap">
        <thead><tr><th>דיבידנד לבעלי המניות</th>{cap.quarters.map((p) => <th key={p}><span className="num">{qName(p)}</span></th>)}<th>LTM<span className="dim">נגזר</span></th></tr></thead>
        <tbody>
          {([['שהוכרז', cap.declared], ['ששולם', cap.paid]] as [string, Div[]][]).map(([l, xs]) => (
            <tr key={l}><td className="lbl">{l}</td>{xs.map((x, i) => <td key={i}><DivCell x={x} d={d} /></td>)}<td>{ltm(xs) == null ? <span className="muted">–</span> : <span className="num der">{amtText(ltm(xs)!)}</span>}</td></tr>
          ))}
        </tbody>
      </table></div>
      <div className="src">עודף מעל היעד נגזר רק כשהון עצמי, SCR ויעד מודפסים לאותו תאריך ועל אותו בסיס, לפני פעולות הון שלאחר תאריך החישוב. רבעון נטוי: מצטבר פחות המצטבר שלפניו (Q4 = FY פחות 9M; Q1 שלא הודפס = 6M פחות Q2). אין כאן תחזית.</div>
    </Panel>
  );
}
