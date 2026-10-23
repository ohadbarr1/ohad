/* The tools. Each returns plain JSON: facts in the contract of core.ts, page links, and no number the site's data does not hold. */
import { atQ, closeSrc } from '../../web/src/lib/csmData';
import { gapProv, lineProv, monthsOf, periodName, ratioProv, endOf as csmEnd } from '../../web/src/lib/csm';
import { median } from '../../web/src/lib/rosterCore';
import { LensSrc, SEG_LONG, NO_REP, warmRep, ql, type LensRow, type Seg } from '../../web/src/lib/lens';
import { pageText, searchText, snippet, readerHref, DOC_TYPE_HE } from '../../web/src/lib/search';
import { buildPool, docLabel, rank } from '../../web/src/lib/searchOmni';
import { sheetName } from '../../web/src/lib/company';
import { nf, pubLabel, periodLabel } from '../../web/src/lib/format';
import { normalize } from '../../web/src/lib/hebrew';
import { reportsOf, headline } from '../../web/src/pages/ReportDay';
import { load } from '../../web/src/lib/useData';
import type { Prov } from '../../web/src/lib/prov';
import { docLink, entities, entity, narrower, period as parsePeriod, provOut, qkey, reportKey, round, siteUrl, type Ent, type Fact, type Source } from './core';
import { catalogue, endOfKey, figure, freqOf, metric, SETS, metricCandidates, toFact, value, viewOf, windowOf, type FigArgs } from './metrics';
import { bookFor, corpus, csmReports, kpiOf, lens, peerRegistry, registry, searchPool, settle, storeOf } from './site';

const factOf = async (o: { ent: Ent; metric: string; label: string; period: string; v: number | null; unit: string; display: string; prov: () => Prov; view: string; flags?: string[] }): Promise<Fact> => {
  const p = await provOut(o.prov());
  return { entity: o.ent.id, entity_he: o.ent.he, metric: o.metric, label: o.label, period: o.period, value: round(o.v), unit: o.unit, display: o.display, source: o.v == null ? null : p.source, calc: o.v == null ? null : p.calc,
    missing: o.v == null ? p.missing ?? 'אין נתון' : undefined, flags: o.flags?.length ? o.flags : undefined, view: o.view };
};

/* ================= figure ================= */
export { figure };

/* ================= peer_table ================= */
export interface PeerArgs { metric: string; peers?: string; period?: string; window?: string; compare?: 'yoy' | null; order?: 'desc' | 'asc' }
export async function peerTable(a: PeerArgs) {
  const m = await metric(a.metric), reg = await peerRegistry();
  const setId = (a.peers ?? '').trim() || (m.family === 'mkt' ? 'market' : 'ins');
  let ents: Ent[];
  let setName: string;
  if (setId === 'market') { const all = await entities(); ents = all.filter((e) => e.kind === 'market_group' || (e.group && !all.some((x) => x !== e && x.group === e.group && x.kind !== 'market_group' && x.id < e.id))); setName = 'כל הקבוצות בקובצי הרשות'; }
  else if (reg.sets.some((s) => s.id === setId)) { const s = reg.sets.find((x) => x.id === setId)!; ents = await Promise.all(s.ids.map((id) => entity(id))); setName = s.n; }
  else { ents = await Promise.all(setId.split(/[,،]\s*/).filter(Boolean).map((x) => entity(x))); setName = 'קבוצה מותאמת'; }
  if (m.family === 'mkt') ents = ents.filter((e) => e.group);
  const p = parsePeriod(a.period), w = windowOf(p, a.window);
  // the axis: the period asked, or the latest any member has (as the peer table opens)
  let k: string | null = null;
  const probe = async (e: Ent) => { try { const r = await figure({ entity: e.id, metric: m.id, period: a.period, window: a.window } as FigArgs); return r.facts[r.facts.length - 1]; } catch { return null; } };
  if (p.kind === 'latest') {
    const got = (await Promise.all(ents.map(probe))).filter((f): f is Fact => !!f && f.value != null);
    const keyOf = (f: Fact) => new URL(f.view).searchParams.get('p') ?? '';
    k = got.map(keyOf).sort().pop() ?? null;
    if (k && m.family !== 'reg' && m.family !== 'expr' && m.family !== 'mkt') k = qkey(k);
    if (!k) throw new Error('אין נתונים למדד בקבוצה');
  }
  const kk = k ?? (m.family === 'mkt' ? (p.kind === 'M' ? p.key : String(Number(endOfKey(p.key).slice(0, 4)) * 100 + Number(endOfKey(p.key).slice(5, 7))))
    : m.family === 'reg' || m.family === 'expr' ? (freqOf(w) === 'FY' ? `${p.key.slice(0, 4)}FY` : freqOf(w) === 'H' ? p.key : qkey(p.key)) : qkey(p.key.replace(/H1$/, 'Q2').replace(/H2$/, 'Q4')));
  const peerIds = ents.map((e) => e.id);
  const rows = await Promise.all(ents.map(async (e) => {
    const one = await value(e, m, kk, w, peerIds);
    const fact = await toFact(e, m, kk, w, one);
    let yoy: Fact | null = null;
    if (a.compare === 'yoy' && one.v != null) { const r = await figure({ entity: e.id, metric: m.id, period: a.period ?? undefined, window: a.window, compare: 'yoy' } as FigArgs).catch(() => null); yoy = r?.change ?? null; }
    return { entity: e.id, entity_he: e.he, fact, yoy };
  }));
  const dir = a.order === 'asc' ? 1 : -1;
  const have = rows.filter((r) => r.fact.value != null).sort((x, y) => dir * (x.fact.value! - y.fact.value!));
  const ranked = [...have.map((r, i) => ({ rank: i + 1, ...r })), ...rows.filter((r) => r.fact.value == null).map((r) => ({ rank: null as number | null, ...r }))];
  const xs = have.map((r) => r.fact.value!);
  // each member's own source is on its row
  const items = have.map((r) => ({ label: r.entity_he, display: r.fact.display, value: r.fact.value }));
  const period = have[0]?.fact.period ?? rows[0]?.fact.period ?? kk;
  // the peer table's rule: a median needs three companies, an average two
  const agg = (kind: 'median' | 'mean'): Fact | null => {
    if (xs.length < (kind === 'median' ? 3 : 2)) return null;
    const v = kind === 'median' ? median(xs) : xs.reduce((s, x) => s + x, 0) / xs.length;
    return { entity: setId, entity_he: setName, metric: `${m.id}#${kind}`, label: `${m.label} · ${kind === 'median' ? 'חציון' : 'ממוצע'}`, period, value: round(v), unit: m.unit, display: nf(v, m.unit === 'ש"ח' ? 2 : Math.abs(v) < 100 ? 1 : 0) + (m.unit === '%' ? '%' : ''),
      source: null, calc: { formula: kind === 'median' ? 'חציון הערכים של החברות: האמצעי, או ממוצע שני האמצעיים' : 'ממוצע פשוט של החברות שיש להן נתון', inputs: items }, view: viewOf(ents[0], m, kk, w).replace(/e=[^&]*/, `e=${peerIds.join(',')}`) };
  };
  return {
    metric: m.id, label: m.label, unit: m.unit, peers: setName, members: peerIds, period, window: w, order: a.order ?? 'desc',
    rows: ranked, median: agg('median'), mean: agg('mean'), view: siteUrl(m.family === 'mkt' ? `/industry/savings?v=market&p=${kk}&t=${SETS[m.id.split('@')[1]] ?? 'all'}` : m.family === 'csm' ? '/industry/csm' : m.family === 'cap' ? `/industry/csm?view=capital${m.id === 'cap:sr_wo' ? '&sr=wo' : ''}` : `/industry/peers?e=${peerIds.join(',')}&f=${freqOf(w)}&p=${kk}&c=${encodeURIComponent(m.tok ?? (m.family === 'kpi' ? m.id : m.id))}`),
  };
}

/* ================= csm_ledger ================= */
export async function csmLedger(a: { company: string; period?: string; span?: 'q' | 'ytd' }) {
  const ent = await entity(a.company);
  const x = await csmReports(ent.id);
  if (!x) throw new Error(`${ent.he}: אינה בספר ה-CSM (שבע המבטחות: phoenix, harel, migdal, clal, menora, ayalon, hachshara)`);
  const p = parsePeriod(a.period);
  const k = p.kind === 'latest' ? x.rs[x.rs.length - 1].p : reportKey(qkey(p.key.replace(/H1$/, 'Q2')));
  const span = a.span ?? 'q';
  const r = atQ(x.rs, ent.id, k, span, 'net');
  const when = span === 'q' ? periodName(k).replace('FY', 'Q4') : k.endsWith('FY') ? periodName(k) : `${monthsOf(csmEnd(k), 'ytd')}M'${k.slice(2, 4)}`;
  const view = siteUrl(`/company/${ent.id}/ifrs17?p=${k}`);
  const MM = 'מיליוני ש"ח', amt = (v: number) => nf(v, Math.abs(v) < 100 ? 1 : 0);
  const b = r.b;
  if (!b) return { company: ent.id, company_he: ent.he, period: when, missing: 'אין טבלת תנועה ב-CSM לתקופה זו', view };
  const line = (key: string, label: string, l: NonNullable<typeof b.close>, prov: () => Prov) => factOf({ ent, metric: `csm:${key}`, label, period: when, v: l.v, unit: MM, display: amt(l.v), prov, view, flags: [l.sum ? 'חיים ועוד בריאות' : '', l.diff ? 'נגזר: מצטבר פחות מצטבר' : ''].filter(Boolean) });
  const opening = b.open ? await line('open', 'יתרת פתיחה', b.open, () => lineProv(b.open!, x.d, `CSM פתיחה · ${ent.he} · ${when}`)) : null;
  const steps = await Promise.all(b.steps.map((s) => line(s.k, s.label, s.line, () => lineProv(s.line, x.d, `${s.label} · ${ent.he} · ${when}`))));
  const closing = b.close ? await line('close', 'יתרת סגירה', b.close, () => closeSrc(r, b.close!, x.d, `CSM סגירה · ${ent.he} · ${when}`)) : null;
  const gap = b.gap != null ? await factOf({ ent, metric: 'csm:gap', label: 'הפרש לא מוסבר (סגירה − פתיחה − תנועות)', period: when, v: b.gap, unit: MM, display: amt(b.gap), prov: () => gapProv(b, x.d, `הפרש · ${ent.he} · ${when}`, amt(b.gap!)), view }) : null;
  const RAT: [keyof typeof r.r, string, string][] = [['nbRel', 'עסק חדש ÷ שחרור', '%'], ['csmEq', 'CSM ÷ הון לבעלי המניות', '×'], ['relOpen', 'קצב שחרור מנורמל לשנה', '%'], ['intOpen', 'צבירת ריבית ÷ פתיחה', '%'], ['estOpen', 'שינויי אומדן ÷ פתיחה', '%'], ['chg', 'שינוי ביתרה', '%']];
  const ratios = (await Promise.all(RAT.map(async ([key, label, u]) => {
    const v = r.r[key] as number | null;
    if (v == null) return null;
    const txt = u === '×' ? `${nf(v, 2)}×` : `${nf(v, 1)}%`;
    return factOf({ ent, metric: `csm:${key}`, label, period: when, v, unit: u === '×' ? 'מכפיל' : '%', display: txt, prov: () => ratioProv(key, b, r.eq, x.d, `${label} · ${ent.he} · ${when}`, txt), view });
  }))).filter(Boolean);
  return {
    company: ent.id, company_he: ent.he, period: when, span, basis: r.cs?.label ?? `${b.b} · ${b.scope}`,
    derived: b.der ? 'הרבעון חושב כטבלה מצטברת פחות הטבלה המצטברת שלפניה (Q4 = FY פחות 9M)' : undefined,
    comparative: b.cmp ? 'נקרא מעמודת ההשוואה של דוח מאוחר יותר' : undefined,
    restated: r.re ? { first: `${amt(r.re.first.dv ?? r.re.first.v)} · ${periodName(r.re.first.rp)}`, last: `${amt(r.re.last.dv ?? r.re.last.v)} · ${periodName(r.re.last.rp)}` } : undefined,
    opening, steps, closing, gap, ratios, view,
    note: steps.length ? undefined : `הדוחות אינם מדפיסים טבלת תנועה לחלון זה${span === 'q' ? ', וגם לא שתי טבלאות מצטברות שאפשר להפחית; נסו span="ytd"' : ''}: מוצגת היתרה בלבד`,
  };
}

/* ================= savings_lens ================= */
const SEG_IN: Record<string, Seg> = { pen: 'pen', pension: 'pen', 'פנסיה': 'pen', gem: 'gem', gemel: 'gem', 'גמל': 'gem', pg: 'pg', hish: 'hish', hishtalmut: 'hish', 'השתלמות': 'hish', ins: 'ins', insurance: 'ins', 'ביטוח': 'ins' };
export async function savingsLens(a: { group?: string; segment?: string; quarter?: string; nowcast?: boolean }) {
  const d = await lens(), src = new LensSrc(d);
  const s = SEG_IN[(a.segment ?? 'pen').trim()] ?? (() => { throw new Error('segment: pen | gem | pg | hish | ins'); })();
  const p = a.quarter ? parsePeriod(a.quarter) : null;
  const q = p && p.kind !== 'latest' ? `${qkey(p.key).slice(4)}-${p.key.slice(0, 4)}` : d.meta.last_rep;
  if (!d.quarters.includes(q)) throw new Error(`רבעון לא בעדשה: ${q}. קיימים: ${d.quarters.map(ql).join(', ')}`);
  let gi = -1, ent: Ent | null = null;
  if (a.group) { ent = await entity(a.group); gi = d.groups.findIndex((g) => g.name === (ent!.group ?? ent!.he)); if (gi < 0) throw new Error(`${ent.he} אינה קבוצה בעדשה`); }
  const view = siteUrl(`/industry/savings?s=${s}&q=${q}${gi >= 0 ? `&g=${encodeURIComponent(d.groups[gi].name)}` : ''}`);
  const all = d.rows.filter((r) => r.s === s && r.q === q);
  const E = (g: number): Ent => ({ id: d.groups[g].id ?? `group:${d.groups[g].name}`, he: d.groups[g].name, en: d.groups[g].name, kind: 'market_group', group: d.groups[g].name });
  const BN = 'מיליארדי ש"ח', MN = 'מיליוני ש"ח';
  const bnv = (x: number | null | undefined) => (x == null ? null : x / 1000);
  // a reported component's provenance loads with its company file, as on the page (warmRep)
  const rep = async (f: () => Prov): Promise<() => Prov> => { let pr = f(); for (let i = 0; i < 60 && pr.k === 'none' && /נטען/.test(pr.why); i++) { await settle(); pr = f(); } return () => pr; };
  const rowFacts = async (r: LensRow, full: boolean) => {
    const e = E(r.g), L = ql(r.q), F = (metric: string, label: string, v: number | null | undefined, unit: string, display: string, prov: () => Prov) => factOf({ ent: e, metric, label, period: L, v: v ?? null, unit, display, prov, view });
    // the reported components load with the company's file, as on the page (warmRep); wait for it before any figure reads them
    if (r.rep) { warmRep(r.rep.c); await rep(() => src.rep(r, 'fees', 'q')); }
    const out: (Fact | null)[] = [
      await F('lens:aum_share', 'נתח מנכסים, סוף הרבעון', r.aum_share, '%', r.aum_share == null ? '–' : `${nf(r.aum_share, 1)}%`, () => src.share(r, all, 'aum')),
      await F('lens:flow_share', 'נתח מהצבירה נטו ברבעון', r.flow_share, '%', r.flow_share == null ? '–' : `${nf(r.flow_share, 1)}%`, () => src.share(r, all, 'flow')),
      r.rep ? await F('lens:fy_reg', 'תשואת דמי ניהול על נכסי הרשות, שנתי', r.fy_reg, '%', r.fy_reg == null ? '–' : `${nf(r.fy_reg, 3)}%`, await rep(() => src.fyReg(r))) : null,
      r.rep ? await F('lens:ci', 'הוצאות להכנסות', r.ci, '%', r.ci == null ? '–' : `${nf(r.ci, 1)}%`, await rep(() => src.ci(r))) : null,
      r.rep ? await F('lens:ppb', 'רווח תפעולי לכל מיליארד ש"ח נכסים, שנתי', r.ppb, 'מיליוני ש"ח למיליארד', r.ppb == null ? '–' : nf(r.ppb, 2), await rep(() => src.ppb(r))) : null,
    ];
    if (full) out.push(
      await F('lens:avg', 'נכסים ממוצעים ברבעון, רשות', bnv(r.reg.avg), BN, r.reg.avg == null ? '–' : nf(r.reg.avg / 1000, 2), () => src.avgP(r)),
      await F('lens:org', 'צבירה אורגנית ברבעון', bnv(r.reg.org), BN, r.reg.org == null ? '–' : nf(r.reg.org / 1000, 2), () => src.reg('organic', r.reg.e, 'q', r.s, r.g, '', BN)),
      await F('lens:tr', 'העברות (ניוד) נטו ברבעון', bnv(r.reg.tr), BN, r.reg.tr == null ? '–' : nf(r.reg.tr / 1000, 2), () => src.reg('transfers', r.reg.e, 'q', r.s, r.g, '', BN)),
      await F('lens:growth', 'צמיחה אורגנית ברבעון', r.growth, '%', r.growth == null ? '–' : `${nf(r.growth, 2)}%`, () => src.growth(r)),
      r.rep ? await F('lens:fees', 'הכנסות מדמי ניהול ברבעון (מהדוח)', r.rep.fees, MN, r.rep.fees == null ? '–' : nf(r.rep.fees, 1), await rep(() => src.rep(r, 'fees', 'q'))) : null,
      r.rep ? await F('lens:op', 'רווח תפעולי ברבעון (מהדוח)', r.rep.op, MN, r.rep.op == null ? '–' : nf(r.rep.op, 1), await rep(() => src.rep(r, 'op', 'q'))) : null,
      r.rep ? await F('lens:fy_rep', 'תשואת דמי ניהול על נכסים מדווחים, שנתי', r.fy_rep, '%', r.fy_rep == null ? '–' : `${nf(r.fy_rep, 3)}%`, await rep(() => src.fyRep(r))) : null,
      r.rep ? await F('lens:cover', 'נכסים מדווחים מול נכסי הרשות', r.cover, '%', r.cover == null ? '–' : `${nf(r.cover, 1)}%`, await rep(() => src.cover(r))) : null,
    );
    // the whole-segment table keeps the figures that exist; one group's card also says why a figure is missing
    return { group: e.he, facts: out.filter((f): f is Fact => !!f && (full || f.value != null)), no_report: r.rep ? undefined : NO_REP[s], mark: r.mark };
  };
  const rows = gi >= 0 ? all.filter((r) => r.g === gi) : [...all].sort((x, y) => (y.reg.aE ?? 0) - (x.reg.aE ?? 0));
  const out = await narrower(gi >= 0 ? 9 : 0, () => Promise.all(rows.map((r) => rowFacts(r, gi >= 0))));
  const nc = a.nowcast ? d.nowcast.rows.filter((n) => n.s === s && (gi < 0 || n.g === gi)) : [];
  const now = await Promise.all(nc.map(async (n) => {
    const base = d.rows.find((r) => r.g === n.g && r.s === n.s && r.q === d.nowcast.base), e = E(n.g), L = `${ql(d.nowcast.q)} · אומדן`;
    return { group: e.he, facts: [
      await factOf({ ent: e, metric: 'lens:now_avg', label: 'נכסים ממוצעים QTD, רשות', period: L, v: n.avg / 1000, unit: BN, display: nf(n.avg / 1000, 2), prov: () => src.now(n, base, 'avg'), view, flags: ['אומדן'] }),
      n.fees != null ? await factOf({ ent: e, metric: 'lens:now_fees', label: 'אומדן הכנסות מדמי ניהול', period: L, v: n.fees, unit: MN, display: nf(n.fees, 1), prov: await rep(() => src.now(n, base, 'fees')), view, flags: ['אומדן'] }) : null,
      n.op != null ? await factOf({ ent: e, metric: 'lens:now_op', label: 'אומדן רווח תפעולי', period: L, v: n.op, unit: MN, display: nf(n.op, 1), prov: await rep(() => src.now(n, base, 'op')), view, flags: ['אומדן'] }) : null,
    ].filter(Boolean) };
  }));
  return { segment: s, segment_he: SEG_LONG[s], quarter: ql(q), regulator_through: `${String(d.meta.asof % 100).padStart(2, '0')}/${String(Math.floor(d.meta.asof / 100)).slice(2)}`, sources: { regulator: d.meta.source_reg, reports: d.meta.source_rep, note: d.meta.rep_note },
    rows: out, nowcast: a.nowcast ? { quarter: ql(d.nowcast.q), base: ql(d.nowcast.base), rows: now } : undefined, view };
}

/* ================= document_page ================= */
export async function documentPage(a: { doc_id?: number; page?: number; company?: string; period?: string; type?: string; find?: string }) {
  const c = await corpus();
  let rid = a.doc_id ?? null;
  if (rid == null) {
    if (!a.company) throw new Error('doc_id, או company + period (+type)');
    const ent = await entity(a.company), p = a.period ? parsePeriod(a.period) : null;
    const want = p && p.kind !== 'latest' ? reportKey(qkey(p.key.replace(/H1$/, 'Q2'))) : null;
    const ds = c.docs.filter((d) => d.company === ent.id && (!want || d.period === want) && (!a.type || d.type === a.type) && !d.en).sort((x, y) => y.date.localeCompare(x.date));
    if (!ds.length) throw new Error('לא נמצא מסמך מתאים באינדקס');
    rid = ds[0].id;
  }
  const doc = c.byId.get(rid);
  if (!doc) throw new Error(`מסמך ${rid} אינו באינדקס הטקסט של האתר (903 מסמכים)`);
  const page = Math.min(Math.max(a.page ?? 1, 1), doc.pages);
  const text = await pageText(rid, page);
  const reg = await registry();
  const name = (id: string) => reg.find((x) => x.id === id)?.name_he ?? id;
  let found: { needle: string; present: boolean } | undefined;
  if (a.find) {
    const flat = (s: string) => normalize(s).replace(/[,\s]/g, '');
    found = { needle: a.find, present: flat(text).includes(flat(a.find)) };
  }
  const MAX = 12000;
  return { doc_id: rid, title: docLabel(doc, name), company: doc.company, type: DOC_TYPE_HE[doc.type], period: doc.period.endsWith('FY') ? `FY'${doc.period.slice(2, 4)}` : `${doc.period.slice(4)}'${doc.period.slice(2, 4)}`,
    published: pubLabel(doc.date), page, pages: doc.pages, url: siteUrl(readerHref(rid, page)), pdf: `${doc.url}#page=${page}`, found,
    text: text.length > MAX ? text.slice(0, MAX) : text, truncated: text.length > MAX || undefined, empty: !text.trim() ? 'אין שכבת טקסט בעמוד זה (סרוק או גרפי)' : undefined };
}

/* ================= restatements ================= */
type RRow = [string, string, string, string, string, string, string, number, number | null, number | null, number, number | null, number | null, string, 0 | 1, string];
interface RFile { built: string; source: string; names: Record<string, string>; kind: Record<string, string>; files: string; docs: Record<string, [string, string, string, string, string]>; rows: RRow[]; seasons: Record<string, { n: number; big: number; up: number; down: number; net: number | null; profit: [string, string, string, string, number][] }> }
const ST_HE: Record<string, string> = { bs: 'מאזן', pl: 'רווח והפסד', oci: 'רווח כולל', cf: 'תזרים מזומנים', eq: 'שינויים בהון', n17: 'באורי IFRS 17' };
export async function restatements(a: { company?: string; report?: string; period?: string; line?: string; statement?: string; min_pct?: number; limit?: number }) {
  const d = await load<RFile>('restatements.json');
  const ent = a.company ? await entity(a.company) : null;
  const rp = a.report ? parsePeriod(a.report) : null, season = rp && rp.kind !== 'latest' ? reportKey(qkey(rp.key.replace(/H1$/, 'Q2'))) : null;
  const pp = a.period ? parsePeriod(a.period) : null;
  const words = (a.line ?? '').trim().split(/\s+/).filter(Boolean);
  const shown = (v: number, u: string) => (u === 'k' ? v / 1000 : v);
  const fmt = (v: number, u: string) => (u === 'pct' ? `${nf(v, 1)}%` : u === 'nis' ? nf(v, 2) : u === 'shares' ? nf(v, 0) : nf(shown(v, u), Math.abs(shown(v, u)) < 100 ? 1 : 0));
  const UNIT: Record<string, string> = { k: 'מיליוני ש"ח', m: 'מיליוני ש"ח', nis: 'ש"ח', pct: '%', shares: 'מניות' };
  const rows = d.rows.filter(([co, st, line, sub, pt, pe, , v0, , , v1, , , inS, k]) => {
    if (ent && co !== ent.id) return false;
    if (season && inS !== season) return false;
    if (a.statement && st !== a.statement) return false;
    if (pp && pp.kind !== 'latest') { const lab = periodLabel(pt, pe); if (lab !== pp.label && !(pp.kind === 'FY' && pt === 'FY' && pe.startsWith(pp.key.slice(0, 4)))) return false; }
    if (words.length && !words.every((w) => line.includes(w) || sub.includes(w))) return false;
    if (a.min_pct != null && v0 !== 0 && Math.abs((v1 - v0) / Math.abs(v0)) * 100 < a.min_pct) return false;
    return k === 0 || !!a.line;
  });
  const money = (r: RRow) => (r[6] === 'k' || r[6] === 'm' ? Math.abs(shown(r[10] - r[7], r[6])) : -1);
  rows.sort((x, y) => money(y) - money(x));
  const lim = Math.min(a.limit ?? 20, 60);
  const src = async (id: number | null, pg: number | null): Promise<Source | null> => {
    if (id == null) return null;
    const doc = d.docs[String(id)];
    const link = await docLink(id, pg, doc ? d.files + doc[4] : null);
    return { kind: 'filing', ...link, doc: doc ? `${d.names[doc[0]] ?? doc[0]}, ${doc[1] === 'annual' ? 'דוח שנתי' : 'דוח רבעוני'} ${doc[2].endsWith('FY') ? `FY'${doc[2].slice(2, 4)}` : `${doc[2].slice(4)}'${doc[2].slice(2, 4)}`}` : undefined };
  };
  const out = await Promise.all(rows.slice(0, lim).map(async ([co, st, line, sub, pt, pe, u, v0, d0, p0, v1, d1, p1, inS, , std]) => ({
    company: co, company_he: d.names[co] ?? co, statement: ST_HE[st] ?? st, line: sub ? `${line} · ${sub}` : line, period: periodLabel(pt, pe), standard: std, unit: UNIT[u],
    first: { value: round(shown(v0, u)), display: fmt(v0, u), source: await src(d0, p0) },
    restated: { value: round(shown(v1, u)), display: fmt(v1, u), source: await src(d1, p1), in_report: inS.endsWith('FY') ? `FY'${inS.slice(2, 4)}` : `${inS.slice(4)}'${inS.slice(2, 4)}` },
    change: { value: round(shown(v1 - v0, u)), pct: v0 !== 0 ? round(((v1 - v0) / Math.abs(v0)) * 100, 2) : null, formula: 'כפי שהוצג מחדש − כפי שדווח לראשונה' },
  })));
  return { built: d.built, source: d.source, matched: rows.length, shown: out.length, rows: out,
    view: siteUrl(`/restatements?${new URLSearchParams({ ...(ent ? { co: ent.id } : {}), ...(season ? { season } : {}), ...(a.line ? { q: a.line } : {}) })}`) };
}

/* ================= calendar ================= */
interface Cal { built: string; basis: string; companies: { id: string; name: string; inactive?: boolean; last: { period: string; date: string; type: string; rid: number }; next: { period: string; end: string; expected?: string; lo?: string; hi?: string; n?: number; lags?: number[] }; history: { period: string; date: string; lag: number }[] }[] }
export async function calendar(a: { company?: string }) {
  const d = await load<Cal>('calendar.json');
  const ent = a.company ? await entity(a.company) : null;
  const pl = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
  const list = d.companies.filter((c) => (ent ? c.id === ent.id : !c.inactive));
  if (ent && !list.length) throw new Error(`${ent.he}: אינה בלוח הדיווחים`);
  const rows = await Promise.all(list.map(async (c) => {
    const n = c.next, same = c.history.filter((h) => h.period.slice(4) === n.period.slice(4)).slice(-3);
    const last = await docLink(c.last.rid, null, null);
    return { company: c.id, company_he: c.name, inactive: c.inactive || undefined,
      last_report: { period: pl(c.last.period), published: pubLabel(c.last.date), source: { kind: 'filing' as const, ...last, url: last.url ?? `https://maya.tase.co.il/he/reports/${c.last.rid}` } },
      next_report: { period: pl(n.period), period_end: pubLabel(n.end), expected: n.expected ? pubLabel(n.expected) : null, window: n.lo && n.hi ? `${pubLabel(n.lo)} – ${pubLabel(n.hi)}` : null, estimate: true,
        calc: { formula: 'סוף התקופה + חציון הימים עד הפרסום, אותו דוח, שלוש השנים האחרונות (אומדן, לא מועד סטטוטורי)', estimate: true, inputs: [{ label: `סוף התקופה ${pl(n.period)}`, display: pubLabel(n.end), value: null }, ...same.map((h) => ({ label: `${pl(h.period)} פורסם ${pubLabel(h.date)}`, display: `${h.lag} ימים`, value: h.lag }))] } } };
  }));
  return { built: pubLabel(d.built), basis: d.basis, rows, view: siteUrl('/calendar'), ics: siteUrl('/data/calendar.ics') };
}

/* ================= search ================= */
export async function search(a: { q: string; kinds?: string[]; limit?: number }) {
  const kinds = new Set(a.kinds?.length ? a.kinds : ['entity', 'line', 'document', 'metric', 'text']);
  const lim = Math.min(a.limit ?? 8, 25);
  const out: Record<string, unknown> = { q: a.q };
  if (kinds.has('entity') || kinds.has('line') || kinds.has('document')) {
    const [reg, pool0, c] = await Promise.all([registry(), searchPool(), corpus()]);
    const pool = buildPool(reg, pool0.ent.groups, pool0.ent.funds, pool0.rows);
    const items = rank(a.q, pool, sheetName, c).map((it) => ({ kind: it.kind, label: it.label, meta: it.meta, url: siteUrl(it.to) }));
    const pick = (ks: string[]) => items.filter((it) => ks.includes(it.kind)).slice(0, lim);
    if (kinds.has('entity')) out.entities = pick(['חברה', 'קופה', 'פונקציה']);
    if (kinds.has('line')) out.lines = pick(['שורה בדוח']);
    if (kinds.has('document')) out.documents = pick(['מסמך']);
  }
  if (kinds.has('metric')) out.metrics = (await metricCandidates(a.q, lim)).map((m) => ({ id: m.id, label: m.label, unit: m.unit, family: m.family }));
  if (kinds.has('text')) {
    const r = await searchText(a.q);
    const reg = await registry();
    const name = (id: string) => reg.find((x) => x.id === id)?.name_he ?? id;
    out.text = { terms: r.terms, mode: r.mode, missing: r.missing.length ? r.missing : undefined, total: r.hits.length, hits: await Promise.all(r.hits.slice(0, lim).map(async (h) => {
      const t = await pageText(h.doc.id, h.page).catch(() => '');
      const sn = t ? snippet(t, r.terms) : null;
      return { doc_id: h.doc.id, page: h.page, title: docLabel(h.doc, name), url: siteUrl(readerHref(h.doc.id, h.page, a.q)), snippet: sn?.line ?? null };
    })) };
  }
  return out;
}

/* ================= company_overview ================= */
export async function companyOverview(a: { company: string; period?: string }) {
  const ent = await entity(a.company);
  if (ent.kind === 'market_group') throw new Error(`${ent.he}: קבוצה בקובצי הרשות בלבד; השתמשו ב-savings_lens או figure עם mkt:…`);
  const c = ent.c!;
  const store = c.has_financials ? await storeOf(ent.id).catch(() => null) : null;
  const kp = await kpiOf(ent.id);
  const reps = store ? reportsOf(store) : [];
  const p = a.period ? parsePeriod(a.period) : null;
  const latest = reps[0] ?? (kp ? kp.quarters[kp.quarters.length - 1]?.period : null);
  const k = p && p.kind !== 'latest' ? reportKey(qkey(p.key.replace(/H1$/, 'Q2'))) : latest;
  if (!k) throw new Error('אין דוחות לחברה');
  const win = 'q';
  const lines: Fact[] = [];
  const changes: Fact[] = [];
  const keys = store ? ['st:net', 'st:comp', 'st:isr', 'st:inv', 'st:pbt', 'st:eq', 'st:assets'] : ['kpi:profit', 'kpi:oci', 'kpi:equity', 'kpi:assets'];
  for (const id of [...keys, 'kpi:roe', 'kpi:eps', 'kpi:leverage', ...(c.kind === 'insurance_group' ? ['csm'] : [])]) {
    const r = await figure({ entity: ent.id, metric: id, period: periodName(k), window: id.startsWith('st:') || id.startsWith('kpi:') ? (id === 'kpi:roe' ? 'q' : win) : undefined, compare: 'yoy' }).catch(() => null);
    if (!r) continue;
    const f = r.facts[r.facts.length - 1];
    if (f.value == null) continue;
    lines.push(f);
    if (r.change && r.change.value != null) changes.push(r.change);
  }
  const mk = ent.group ? await Promise.all(['mkt:assets@all', 'mkt:share@all', 'mkt:netflow@all'].map((id) => figure({ entity: ent.id, metric: id, window: id.includes('netflow') ? 'ltm' : undefined }).then((r) => r.facts[0]).catch(() => null))) : [];
  const fl = await load<{ docs: { id: number; date: string; type: string; period: string; title: string; pages: number; url: string; company: string; en: boolean }[] }>('filings_latest.json');
  const docs = await Promise.all(fl.docs.filter((d) => d.company === ent.id && !d.en).slice(0, 5).map(async (d) => ({ type: DOC_TYPE_HE[d.type as 'annual'] ?? d.type, period: d.period.endsWith('FY') ? `FY'${d.period.slice(2, 4)}` : `${d.period.slice(4)}'${d.period.slice(2, 4)}`, published: pubLabel(d.date), pages: d.pages, ...(await docLink(d.id, null, d.url)) })));
  const cal = await calendar({ company: ent.id }).catch(() => null);
  return {
    company: ent.id, company_he: ent.he, company_en: ent.en, kind: c.kind === 'insurance_group' ? 'קבוצת ביטוח' : 'בית השקעות', market_group: ent.group,
    report: periodName(k), window: 'רבעון', filer: kp?.filer ? `נתוני XBRL של ${kp.filer.name} (${kp.filer.stake}%): ${kp.filer.note}` : undefined,
    headline: lines, yoy: changes, savings: mk.filter((x): x is Fact => !!x && x.value != null), latest_filings: docs, next_report: cal?.rows[0]?.next_report,
    views: { home: siteUrl(`/company/${ent.id}?p=${k}`), statements: siteUrl(`/company/${ent.id}/financials`), ifrs17: siteUrl(`/company/${ent.id}/ifrs17?p=${k}`), savings: siteUrl(`/company/${ent.id}/savings`), filings: siteUrl(`/company/${ent.id}/filings`) },
  };
}

export { catalogue, headline, kpiOf, bookFor };
