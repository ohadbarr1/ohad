/* W1 · agent door: the pure libs behind it. Fee distribution (lib/feeDist), the tax/liquidity table (lib/productRules), the pension
   decision data (lib/pensionPack) and the compare bottom line (lib/compareSummary): hand-computed cases, then a smoke run over the
   published web/public/data (funds.json, funds/default.json, a pension history). Run: npm run test:agent */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BAND_HE, MIN_N, bandOf, categoriesOf, counted, feeDist, pcts, wmean, type FeeObs } from '../src/lib/feeDist';
import { RULES, RULES_NOTE, rulesFor, rulesOf } from '../src/lib/productRules';
import { actCompound, actHistory, defaultHits, defaultKeys, defaultNow, isPension, periodText } from '../src/lib/pensionPack';
import { compareSummary, type CmpIn } from '../src/lib/compareSummary';
import type { DefaultFile } from '../src/lib/fundsTools';
import { bmKind, bmProv, claimProv, claimsWhy, claimsWhyTech, clmCell, coverProv, isOldGen, segOf, svcCell, svcProv, type DecisionFile } from '../src/lib/decision';
import { bottomLines, cmpOf, docRow, metricsOf, pagesOf, shortUrl, snapDiff, snapOf, DOC_METRICS } from '../src/lib/compareDoc';
import { CLIENTS_V, normClients, normHeld, normSnap, upsert, type SnapRow } from '../src/lib/clients';
import { winnerTrack } from '../src/lib/pensionPack';
import { heldOf, parseMaslaka, readCovers, rowsOf, xmlTree, type MFund } from '../src/lib/maslaka';
import { folderFromImport } from '../src/components/agent/ClientImport';
import { bmCompare, bmLine, coefOk, newCoefDefault } from '../src/lib/bmCalc';

let fail = 0, pass = 0;
const bad: string[] = [];
function ok(cond: unknown, what: string) { if (cond) pass++; else { fail++; bad.push(what); } }
const near = (a: number | null | undefined, b: number, e = 1e-9) => a != null && Math.abs(a - b) < e;

/* ---- percentiles: PERCENTILE.INC ---- */
const p = pcts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!;
ok(p && near(p.p10, 1.9) && near(p.p25, 3.25) && near(p.p50, 5.5) && near(p.p75, 7.75) && near(p.p90, 9.1), 'p10…p90 match Excel PERCENTILE.INC on 1..10');
ok(pcts([1, 2, 3, 4]) === null && MIN_N === 5, 'fewer than 5 observations: no distribution');
ok(near(pcts([0.5, 0.1, 0.3, 0.2, 0.4])!.p50, 0.3), 'order does not matter');
ok(near(wmean([{ v: 1, w: 1 }, { v: 3, w: 3 }]), 2.5) && near(wmean([{ v: 1, w: 0 }, { v: 3, w: 0 }]), 2), 'assets-weighted mean; equal weights without assets');
ok(bandOf(0.1, p) === '≤p10' && bandOf(5.5, p) === 'p25–p50' && bandOf(9.5, p) === '>p90' && !!BAND_HE['p50–p75'], 'bands');

/* ---- the benchmark ---- */
const F = (k: string, grp: string, fee: number | null, depfee: number | null, assets: number, extra: Partial<FeeObs> = {}): FeeObs => ({ k, name: `${grp} ${k}`, grp, prod: 'השתלמות', track: 'כללי', fee, depfee, assets, ...extra });
const fs: FeeObs[] = [F('a1', 'A', 0.5, null, 100), F('a2', 'A', 0.7, null, 300), F('b', 'B', 0.6, 1, 50), F('c', 'C', 0.8, null, 10), F('d', 'D', 0.4, 2, 10), F('e', 'E', 0.9, null, 10),
  F('x', 'X', 0.01, null, 0), F('y', 'Y', 0.02, null, 5, { closed: true }), F('z', 'Z', 0.03, null, 5, { name: 'Z בניהול אישי' }), F('o', 'O', 0.1, null, 5, { track: 'מניות' })];
ok(!counted(fs[6]) && !counted(fs[7]) && !counted(fs[8]) && counted(fs[0]), 'out: no assets, ענפית, IRA');
const dm = feeDist(fs, 'השתלמות', 'כללי', 'mgr');
ok(dm.fee.obs.length === 5 && dm.nTracks === 6 && dm.nGroups === 5, 'one observation per group');
ok(near(dm.fee.obs.find((o) => o.grp === 'A')!.v, 0.65), 'a group: its tracks weighted by assets (0.5×100 + 0.7×300) ÷ 400');
ok(dm.fee.pcts != null && near(dm.fee.pcts.p50, 0.65), 'median of the five groups');
ok(dm.depfee.pcts === null && dm.depfee.obs.length === 2, 'deposit fee: its own population, too few for a distribution');
const dt = feeDist(fs, 'השתלמות', 'כללי', 'track');
ok(dt.fee.obs.length === 6 && near(dt.fee.pcts!.p50, 0.65), 'per track: six observations, median of 0.4 0.5 0.6 0.7 0.8 0.9');
ok(feeDist(fs, 'השתלמות', null, 'track').fee.obs.length === 7, 'the whole product: every category');
ok(categoriesOf(fs, 'השתלמות').map((c) => c.track).join() === 'כללי', 'categories with 5+ groups');

/* ---- product rules ---- */
ok(RULES.length === 6 && RULES.every((r) => r.liq.length > 20 && r.tax.length > 20 && r.src.length > 0 && r.src.every((s) => /^https:\/\//.test(s.url))), 'six products, two lines each, every one sourced');
ok(RULES.every((r) => r.src.some((s) => /gov\.il|kolzchut|capitax/.test(s.url))), 'each rule has a gov.il, Tax Authority or Kol Zchut source');
ok(RULES.every((r) => !/אשתקד/.test(r.liq + r.tax)), 'no "אשתקד"');
ok(/לא ייעוץ מס/.test(RULES_NOTE), 'the note: general, not tax advice');
ok(rulesFor('השתלמות')[0].key === 'hishtalmut' && rulesFor('גמל להשקעה')[0].key === 'gemelInvest' && rulesFor('גמל')[0].key === 'gemel', 'gemel products map apart');
ok(rulesFor('פוליסות חיסכון וביטוחי מנהלים (מ-2004)').map((r) => r.key).join() === 'managers,policy', 'the shared bituach-net pool: both products');
ok(rulesFor('ביטוחי מנהלים 1992-2003')[0].key === 'managers' && rulesFor('פנסיה מקיפה')[0].key === 'pension', 'managers and pension');
ok(rulesFor('חיסכון לילד').length === 0 && rulesFor('מרכזית לפיצויים').length === 0, 'no unverified rule for the others');
ok(rulesOf(['גמל להשקעה', 'השתלמות', 'השתלמות']).map((r) => r.key).join() === 'hishtalmut,gemelInvest', 'distinct, in table order');

/* ---- default fund ---- */
const D: DefaultFile = { tenders: [
  { id: '2021', from: '2021-11-01', to: '2024-10-31', fee: 0.22, depfee: 1, src: 's', verified: false, winners: [{ grp: 'M', ks: ['p1', 'p2'] } as never] },
  { id: '2024', from: '2024-11-01', to: '2028-10-31', fee: 0.22, depfee: 1, fee_years: 10, src: 's', verified: true, winners: [{ grp: 'M', ks: ['p1'] } as never, { grp: 'N', k: ['p9'], fee: 0.2, depfee: 1.2 }] },
] };
ok(defaultNow('p1', D, 202609)?.t.id === '2024' && defaultNow('p2', D, 202609) === null, 'in force at 09/26: the 2024 tender');
ok(defaultHits('p1', D, 202609).length === 2 && defaultHits('p2', D, 202609)[0].current === false, 'history: every tender won');
ok(defaultNow('p9', D, 202609)?.fee === 0.2 && defaultNow('p1', D, 202609)?.depfee === 1, 'a winner priced apart; else the tender price');
ok([...defaultKeys(D, 202609)].sort().join() === 'p1,p9' && defaultKeys(D, 202301).has('p2'), 'the keys in force');
ok(periodText(D.tenders[1]) === '11/24–10/28', 'period text');
ok(isPension({ fam: 'pensia' }) && isPension({ k: 'p2009' }) && !isPension({ fam: 'gemel', prod: 'השתלמות', k: 'g1' }), 'pension');

/* ---- actuarial ---- */
const h = { p: [202503, 202504, 202506, 202509], act: [-0.05, null, -0.13, 0.1] };
ok(actHistory(h).map((x) => x.p).join() === '202503,202506,202509' && actHistory(h, 2).length === 2 && actHistory({ p: [1] }).length === 0, 'the published quarters');
ok(near(actCompound(actHistory(h)), ((1 - 0.0005) * (1 - 0.0013) * 1.001 - 1) * 100), 'compounded');

/* ---- the bottom line ---- */
const C = (k: string, fee: number | null, depfee: number | null, r5: number | null, sharpe: number | null, prod = 'השתלמות'): CmpIn => ({ k, name: k, prod, fee, depfee, r5, sharpe });
const s = compareSummary([C('a', 0.5, null, 9.0, 1.1), C('b', 0.5, null, 8.95, 1.2), C('c', 0.6, null, 8.5, 1.2), C('d', null, null, null, null)]);
ok(s.fee?.ks.join() === 'a,b' && s.fee.of === 3 && s.fee.missing.join() === 'd', 'cheapest: a tie at 2 dp, the one with no fee counted out');
ok(s.depfee === null, 'no deposit fees: no line');
ok(s.r5?.ks.join() === 'a,b' && !s.r5.all && near(s.r5.gap!, 0.45), '5Y: a 5bp lead is a shared head; gap to the rest');
ok(s.sharpe?.ks.join() === 'b,c' && !s.mixed, 'Sharpe: a tie');
const s2 = compareSummary([C('a', 0.5, 1, 9.0, 1, 'גמל'), C('b', 0.4, 2, 9.05, 1)]);
ok(s2.mixed && s2.cross && s2.r5 === null && s2.fee === null && s2.depfee === null && s2.cats.length === 0 && s2.alone.join() === 'a,b', 'W4: two products: no line compares them');
const s2b = compareSummary([C('a', 0.5, 1, 9.0, 1), C('b', 0.4, 2, 9.05, 1)]);
ok(s2b.r5?.all && s2b.r5.gap === null && !s2b.mixed && s2b.depfee?.ks.join() === 'a', 'all tied on 5Y within one category');
ok(compareSummary([C('a', 0.5, 1, 9, 1)]).fee === null, 'one track: no bottom line');


/* ---- W4: no crowning across categories; old-generation policies out of every line ---- */
{
  const X = (k: string, track: string, r5: number, fee: number, st: number, prod = 'פנסיה מקיפה', old = false): CmpIn => ({ k, name: k, prod, track, cat: `${prod} | ${track}`, fee, depfee: null, r5, sharpe: 1, st, old });
  const m = compareSummary([X('a', 'עד 50', 9, 0.2, 60), X('b', 'עד 50', 8, 0.1, 58), X('c', 'מניות', 14, 0.3, 95), X('d', 'כללי', 7, 0.05, 40)]);
  ok(m.cross && m.fee === null && m.r5 === null && m.cats.length === 1 && m.cats[0].ks.join() === 'a,b' && m.cats[0].r5?.ks.join() === 'a' && m.cats[0].fee?.ks.join() === 'b', 'W4: across categories only the same-category pair is compared');
  ok(m.alone.join() === 'c,d' && m.stRange?.[0] === 40 && m.stRange?.[1] === 95, 'W4: tracks alone in their category are listed apart; the equity range is reported');
  ok(!m.cats.some((c) => c.ks.includes('c')), 'W4: the equity track (14%) is never "the highest" next to the age track');
  const o = compareSummary([X('y', 'כללי', 7, 2.2, 50, 'ביטוחי מנהלים 1992-2003', true), X('z', 'כללי', 6, 0.6, 50, 'ביטוחי מנהלים 1992-2003', true), X('p', 'עד 50', 10, 0.1, 58)]);
  ok(o.old && o.oldKs.join() === 'y,z' && o.cats.length === 0 && o.fee === null, 'W4: old-generation tracks are in no comparison line, not even against each other');
  ok(isOldGen({ prod: 'ביטוחי מנהלים 1992-2003' }) && isOldGen({ prod: 'ביטוחי מנהלים 1990-1991' }) && !isOldGen({ prod: 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים' }), 'W4: old generation = policies of 1990-2003');
}

/* ---- W4: the client document's rows, pages, bottom line and snapshot ---- */
const R = (k: string, o: Partial<SnapRow> = {}): SnapRow => ({ k, name: `מסלול ${k}`, prod: 'פנסיה מקיפה', track: 'עד 50', id: 1, mgr: 'm', grp: 'g', pen: true, old: false, y12: 12, a3: 11, a5: 9, a3g: 11.2, fee: 0.2, depfee: 1.5, sharpe: 1.2, sd: 5, mdd: -8, st: 58, act: -0.05, act_p: 202606, dflt: null, svc: { total: 80, rank: 2, of: 9 }, clm: 71, feeRange: null, ...o });
ok(pagesOf([1, 2, 3]).map((p) => p.length).join() === '3' && pagesOf([1, 2, 3, 4, 5]).map((p) => p.length).join() === '3,2' && pagesOf([1, 2, 3, 4, 5, 6, 7, 8]).map((p) => p.length).join() === '4,4', 'W4: pages of ≤ 4 tracks, even (3 | 3+2 | 4+4)');
ok([1, 2, 3, 4, 5, 6, 7, 8].every((n) => pagesOf(Array.from({ length: n }, (_, i) => i)).every((p) => p.length <= 4 && p.length > 0) && pagesOf(Array.from({ length: n }, (_, i) => i)).flat().length === n), 'W4: every count 1–8 pages into ≤ 4 columns, none lost');
ok(metricsOf([R('a', { pen: false })]).length === DOC_METRICS.filter((m) => !m.pen).length && metricsOf([R('a')]).length === DOC_METRICS.length, 'W4: pension rows only with a pension track');
const BAD = /מקום ראשון|המקום הראשון|מוביל|ניצח|מנצח|זוכה|הטוב ביותר/;
const bl1 = bottomLines([R('a'), R('b', { a5: 8.5, fee: 0.1 }), R('c', { track: 'מניות', a5: 14, st: 95 })], true);
ok(bl1.some((t) => /קטגוריות שונות/.test(t)) && bl1.some((t) => /באותה קטגוריה \(פנסיה מקיפה · עד 50\)/.test(t)) && !bl1.some((t) => /מסלול c/.test(t) && /הגבוהה/.test(t)), 'W4: bottom line: cross-category sentence, the same-category lines, the equity track uncrowned');
ok(bl1.every((t) => !BAD.test(t)), 'W4: no winner / first-place words in the bottom line');
const bl2 = bottomLines([R('a', { prod: 'ביטוחי מנהלים 1992-2003', track: 'כללי', old: true, pen: false }), R('b')], true);
ok(/דור ישן|1990-2003/.test(bl2[0]) && bl2.every((t) => !/מסלול a,/.test(t)), 'W4: an old-generation policy opens the bottom line and is in no comparison');
const sn0 = snapOf([R('a'), R('b')], ['שורה'], '2026-11-02', 202609, 'net');
const ns = normSnap(JSON.parse(JSON.stringify(sn0)), ['a', 'b']);
ok(!!ns && ns.rows.length === 2 && ns.rows[0].a5 === 9 && ns.rows[0].svc?.rank === 2 && ns.bottom[0] === 'שורה' && ns.at === '2026-11-02' && ns.asof === 202609, 'W4: a snapshot survives storage as saved');
ok(normSnap({ ...sn0, asof: 'x' }, ['a']) === null && normSnap(sn0, ['zz']) === null, 'W4: a malformed snapshot, or one of other tracks, is dropped');
ok(snapDiff(R('a'), R('a', { fee: 0.25, a5: 9.4 }), 202609).map((d) => d.label).join() === '5Y, שנתי,ד"נ מצבירה' && snapDiff(R('a'), R('a'), 202609).length === 0, 'W4: what changed since the snapshot, figure by figure');
const v1 = { kind: 'fox-clients', v: 1, folders: [{ id: 'abcd1234', label: 'ד.כ.', keys: ['p2155', 'p9654'], b: 'net', tags: { p2155: 'קיים' }, fields: { 'r:fit': 'טקסט' }, note: '', created: '2026-10-01', updated: '2026-10-02' }] };
const mig = normClients(v1);
ok(mig.v === CLIENTS_V && mig.v === 2 && mig.folders[0].snap === null && mig.folders[0].held.length === 0 && mig.folders[0].fields['r:fit'] === 'טקסט' && mig.folders[0].tags.p2155 === 'קיים', 'W4: a v1 folder migrates to v2, keeping all it had, with no snapshot');
const up1 = upsert(mig, { label: 'ד.כ.', keys: ['p2155', 'p9654'], snap: snapOf([R('p2155'), R('p9654')], [], '2026-11-02', 202609, 'net') }, '2026-11-02');
ok(up1.folder.snap?.rows.length === 2 && !up1.created, 'W4: saving the same tracks stores the snapshot');
const up2 = upsert(up1.file, { label: 'ד.כ.', keys: ['p2155', 'p13909'] }, '2026-11-03');
ok(up2.folder.snap === null && up2.folder.keys.join() === 'p2155,p13909', 'W4: new tracks without a new snapshot drop the old one');
ok(normHeld({ typeHe: 'קרן פנסיה', provider: 'מור', plan: '039123456 חשבון', balance: 100, covers: [{ name: 'נכות', sum: 5000 }] })?.plan === null && normHeld({ typeHe: 'x', covers: [{ name: 'נכות', sum: 5000 }] })?.covers[0].sum === 5000, 'W4: a held product: an ID-shaped string is dropped, the cover kept');

/* ---- W4: the default funds' links go to a published open track or nowhere ---- */
{
  const FF = [{ k: 'p1', prod: 'פנסיה מקיפה', assets: 10, closed: false }, { k: 'p2', prod: 'פנסיה מקיפה', assets: 500, closed: true }, { k: 'p3', prod: 'פנסיה כללית', assets: 900, closed: false }, { k: 'p4', prod: 'פנסיה מקיפה', assets: 50, closed: false }];
  ok(winnerTrack({ ks: ['p9', 'p2', 'p1', 'p4', 'p3'] }, FF)?.k === 'p4', 'W4: the largest open comprehensive track; a closed or absent key is skipped');
  ok(winnerTrack({ ks: ['p9', 'p2'] }, FF) === null && winnerTrack({ k: ['p3'] }, FF)?.k === 'p3', 'W4: no open published track: no link');
}

/* ---- W4: insurance cover from a clearing-house account, never the insured person ---- */
{
  const xml = `<Mimshak><KoteretKovetz><MISPAR-GIRSAT-XML>009</MISPAR-GIRSAT-XML></KoteretKovetz><YeshutYatzran><KOD-MEZAHE-YATZRAN>512245812</KOD-MEZAHE-YATZRAN><SHEM-YATZRAN>מבטחים</SHEM-YATZRAN><Mutzarim><Mutzar><NetuneiMutzar><SUG-MUTZAR>2</SUG-MUTZAR><YeshutLakoach><MISPAR-ZIHUY-LAKOACH>039999999</MISPAR-ZIHUY-LAKOACH></YeshutLakoach></NetuneiMutzar><HeshbonotOPolisot><HeshbonOPolisa><SUG-KEREN-PENSIA>2</SUG-KEREN-PENSIA>
    <Kisuim><ZihuiKisui><SHEM-KISUI-YATZRAN>כיסוי בקרן</SHEM-KISUI-YATZRAN><PirteiMevutach><SUG-TEUDA>1</SUG-TEUDA><MISPAR-ZIHUY-LAKOACH>039999999</MISPAR-ZIHUY-LAKOACH></PirteiMevutach>
      <KisuiBKerenPensia><ALUT-KISUI-NECHUT>45.5</ALUT-KISUI-NECHUT><SHEUR-KISUY-NECHUT>75</SHEUR-KISUY-NECHUT><SACH-PENSIAT-NECHUT>9000</SACH-PENSIAT-NECHUT><KITZBAT-SHEERIM-LEALMAN-O-ALMANA>6000</KITZBAT-SHEERIM-LEALMAN-O-ALMANA></KisuiBKerenPensia></ZihuiKisui>
      <ZihuiKisui><SHEM-KISUI-YATZRAN>ריסק</SHEM-KISUI-YATZRAN><PirteiKisuiBeMutzar><SUG-KISUY-BITOCHI>1</SUG-KISUY-BITOCHI><SCHUM-BITUACH>500000</SCHUM-BITUACH></PirteiKisuiBeMutzar></ZihuiKisui></Kisuim>
    </HeshbonOPolisa></HeshbonotOPolisot></Mutzar></Mutzarim></YeshutYatzran></Mimshak>`;
  const t = xmlTree(xml), acc = t.c[1].c[2].c[0].c[1].c[0];
  const cv = readCovers(acc);
  ok(cv.length === 3 && cv[0].rate === 75 && cv[0].sum === 9000 && cv[0].cost === 45.5 && cv[1].sum === 6000 && cv[2].kind === 'מוות' && cv[2].sum === 500000, 'W4: covers: a pension fund\'s disability and survivors, a death cover with its sum');
  const file = parseMaslaka(t);
  const rows = rowsOf(file, [] as MFund[]);
  const held = heldOf(rows);
  ok(held.length === 1 && held[0].covers.length === 3 && !JSON.stringify(held).includes('039999999') && !JSON.stringify(file).includes('039999999'), 'W4: the held product carries the cover; no ID number anywhere in what is read');
  const fo = folderFromImport('לקוח', [...held, { ...held[0], k: 'p2155', balance: 200 }, { ...held[0], k: 'p9654', balance: 900 }] as never);
  ok(fo.keys.join() === 'p9654,p2155' && fo.tags.p9654 === 'קיים' && fo.held.length === 3, 'W4: an import makes a folder: matched tracks by balance, tagged "קיים", every product held');
  const nf2 = normClients({ folders: [{ label: 'ייבוא', keys: [], held: fo.held.slice(0, 1) }] });
  ok(nf2.folders.length === 1 && nf2.folders[0].keys.length === 0 && nf2.folders[0].held[0].covers.length === 3, 'W4: a folder of imported products alone is a folder');
}
/* ---- W5: an old managers' policy, the guaranteed coefficient against a new fund on the same balance ---- */
{
  const o = bmCompare({ balance: 640000, coefG: 160, coefNew: 200, fee: 1.05, feeNew: 0.22 })!;
  ok(near(o.annG, 4000) && near(o.annNew, 3200) && near(o.diff, 800) && near(o.pct, 25), `W5: 640,000 ÷ 160 = 4,000 vs ÷ 200 = 3,200 a month: +25% (${o.annG}, ${o.annNew}, ${o.pct})`);
  ok(near(o.feeG!, 6720) && near(o.feeN!, 1408), 'W5: the fees on today\'s balance, a year');
  ok(/גבוהה ב-25%/.test(bmLine(o, 160, 200)) && /800 ש"ח/.test(bmLine(o, 160, 200)), `W5: the line states the gap: ${bmLine(o, 160, 200)}`);
  const lo = bmCompare({ balance: 100000, coefG: 220, coefNew: 200 })!;
  ok(lo.diff < 0 && /נמוכה ב-9%/.test(bmLine(lo, 220, 200)) && lo.feeG === null, `W5: a coefficient above the new fund's gives less: ${bmLine(lo, 220, 200)}`);
  ok(bmCompare({ balance: 100000, coefG: 16, coefNew: 200 }) === null && !coefOk(16) && coefOk(160) && bmCompare({ balance: 0, coefG: 160, coefNew: 200 }) === null, 'W5: a typo coefficient or no balance: no result');
  ok(newCoefDefault('m').v === 188 && newCoefDefault('f').v === 204 && newCoefDefault(null).v === 200, 'W5: the new-fund default is the site\'s assumption (lib/retire)');
}
ok(shortUrl('https://www.gov.il/BlobFolder/x/%D7%9E%D7%A6%D7%92%D7%AA.pdf') === 'gov.il › מצגת.pdf', 'W4: a source address prints as a short decoded title');

/* ---- smoke on the published data ---- */
const data = join(process.cwd(), 'public/data');
const fj = join(data, 'funds.json');
if (existsSync(fj)) {
  const d = JSON.parse(readFileSync(fj, 'utf8')) as { asof: number; funds: (FeeObs & { fam: string; act?: number | null; act_p?: number })[] };
  const pen = feeDist(d.funds, 'פנסיה מקיפה', null, 'mgr');
  ok(pen.fee.pcts && pen.fee.pcts.p10 <= pen.fee.pcts.p50 && pen.fee.pcts.p50 <= pen.fee.pcts.p90 && pen.depfee.pcts, 'smoke: comprehensive pension has both distributions');
  const hs = feeDist(d.funds, 'השתלמות', 'כללי', 'mgr');
  ok(hs.fee.pcts && hs.fee.pcts.n >= MIN_N, 'smoke: השתלמות כללי has a distribution');
  console.log(`  smoke: פנסיה מקיפה, ${pen.fee.pcts?.n} groups: fee p50 ${pen.fee.pcts?.p50.toFixed(3)}%, depfee p50 ${pen.depfee.pcts?.p50.toFixed(3)}%; השתלמות כללי, ${hs.fee.pcts?.n} groups: fee p50 ${hs.fee.pcts?.p50.toFixed(3)}%`);
  const prods = [...new Set(d.funds.map((f) => f.prod))];
  ok(prods.filter((x) => rulesFor(x).length).length >= 8, `smoke: ${prods.filter((x) => rulesFor(x).length).length} of ${prods.length} products have a rule`);
  const withAct = d.funds.filter((f) => f.act != null);
  ok(withAct.length > 0 && withAct.every((f) => isPension(f)), `smoke: ${withAct.length} tracks with an actuarial balance, all pension`);
  const dj = join(data, 'funds/default.json');
  if (existsSync(dj)) {
    const df = JSON.parse(readFileSync(dj, 'utf8')) as DefaultFile;
    const ks = defaultKeys(df, d.asof), live = d.funds.filter((f) => ks.has(f.k));
    ok(live.length > 0 && live.every((f) => isPension(f)), `smoke: ${live.length} live tracks in a default fund at ${d.asof}, all pension`);
  }
  /* W2: every decision figure opens a page-cited source; self-reports say so; missing reports give their reason */
  const dj2 = join(data, 'funds/decision.json');
  if (existsSync(dj2)) {
    const dec = JSON.parse(readFileSync(dj2, 'utf8')) as DecisionFile;
    const pens = d.funds.filter((f) => isPension(f) && !f.closed);
    const grps = [...new Set(pens.map((f) => f.grp))];
    const inIdx = grps.filter((g) => dec.companies[g]?.service?.pension);
    ok(inIdx.length >= 8, `smoke: ${inIdx.length} pension groups of funds.json found in the service index`);
    for (const g of inIdx) {
      const pv = svcProv(dec, g, 'pension', 'total');
      ok(pv.k === 'report' && pv.pg === dec.companies[g].service!.pension!.pg && !!pv.url, `svc ${g}: report with page`);
      ok(svcProv(dec, g, 'pension', 'prev').k === 'report', `svc prev ${g}`);
    }
    for (const g of grps) {
      const c = dec.companies[g];
      if (c?.claims) { const cp = claimProv(dec, g, 'disability', 'approved'); ok(cp.k === 'report' && cp.srcType === 'דיווח החברה' && /לא נבדק/.test(cp.note ?? ''), `claims ${g}: a labelled self-report`); ok(clmCell(dec, g).v === c.claims.disability.approved, `claims cell ${g}`); }
      else if (c?.service?.pension) ok(claimsWhy(dec, g).length > 10 && clmCell(dec, g).t === 'לא פורסם', `claims ${g}: missing with a reason`);
    }
    ok(/נמצא/.test(claimsWhyTech(dec, 'כלל')) && /captcha|חסום/.test(claimsWhyTech(dec, 'מנורה מבטחים')), 'Clal and Menora: the recorded reasons (methodology)');
    ok([...grps, 'כלל', 'מנורה מבטחים'].every((g) => !/Radware|captcha|ניסיונות|\.json|[A-Z]{3,}_[A-Z]/.test(claimsWhy(dec, g))), 'W4: the public reason has no tool names, search log or field names');
    ok(svcCell(dec, pens[0]).txt === true && svcCell(undefined, pens[0]).t === '…' && svcCell(null, pens[0]).t === '–', 'svc cell: loading, absent, present');
    ok(dec.coverage_default.rules.every((r) => { const cp = coverProv(dec, r); return cp.k === 'report' && cp.pg === r.pg; }), 'every coverage rule cites its page');
    ok(dec.bm_checklist.length === 10 && dec.bm_checklist.every((it) => bmProv(dec, it).k === 'report'), 'the checklist: 10 sourced items');
    ok(dec.bm_checklist.some((it) => /2012/.test(it.note ?? '') && /2013/.test(it.note ?? '')), 'the 2012/2013 discrepancy is in the file');
    ok(segOf({ fam: 'pensia' }) === 'pension' && segOf({ fam: 'gemel' }) === 'gemel' && segOf({ fam: 'insurance' }) === 'life_savings', 'segments by family');
    ok(bmKind('ביטוחי מנהלים 1992-2003') === 'old' && bmKind('ביטוחי מנהלים 1990-1991') === 'old' && bmKind('פוליסות חיסכון וביטוחי מנהלים (מ-2004)') === 'new' && bmKind('גמל') === null, 'managers\' insurance generations');
    const withH = d.funds.filter((f) => (f as { act_h?: unknown[] }).act_h?.length);
    ok(withH.length > 100 && withH.every((f) => isPension(f) && ((f as { act_h: unknown[] }).act_h.length <= 8)), `smoke: ${withH.length} pension tracks carry act_h (≤ 8 quarters)`);
  }
  // W4: every tender winner links to a published open track, or to nothing
  if (existsSync(join(data, 'funds/default.json'))) {
    const df = JSON.parse(readFileSync(join(data, 'funds/default.json'), 'utf8')) as DefaultFile;
    const ws = df.tenders.flatMap((t) => t.winners);
    const tos = ws.map((w) => winnerTrack(w as never, d.funds as never) as { k: string; closed?: boolean } | null);
    const anyOpen = (w: { k?: string[]; ks?: string[] }) => (w.ks ?? w.k ?? []).some((k) => d.funds.some((f) => f.k === k && !(f as { closed?: boolean }).closed && (f.assets ?? 0) > 0));
    ok(tos.every((x, i) => (x == null ? !anyOpen(ws[i] as never) : d.funds.some((f) => f.k === x.k) && !x.closed)), `smoke: ${tos.filter(Boolean).length} of ${ws.length} winners link to an open published track; the rest (a fund no longer published) to nothing`);
  }
  // W4: a document row of a real old-generation track: no comparison, a variable fee
  const yod = d.funds.find((f) => f.k === 'i17012') as never;
  if (yod) { const r = docRow(yod, { net: true, asof: d.asof }); ok(r.old && !r.pen && cmpOf(r).old === true, 'smoke: i17012 (קרן י\') is old generation'); }
  const pj = join(data, 'funds/p2009.json');
  if (existsSync(pj)) ok(actHistory(JSON.parse(readFileSync(pj, 'utf8'))).length === 8, 'smoke: a pension history has 8 quarters to show');
}

console.log(`agent: ${pass} passed, ${fail} failed`);
if (fail) { bad.forEach((b) => console.log('  ✗ ' + b)); process.exit(1); }
