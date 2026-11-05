// D2 SEO (fox 3.0 wave 3): after the build, a copy of the SPA shell for every saver entry point, each with its own <title>, description,
// canonical, og:* and a short <noscript> summary of real figures (with their period and source, read from the data files of this build),
// plus sitemap.xml. Firebase serves /funds/p2009 from funds/p2009.html (firebase.json cleanUrls) before the SPA rewrite; the app boots
// from the same bundle and renders as on any other address (createRoot, no hydration), and src/lib/seo.ts keeps this head.
// usage: node scripts/prerender-seo.mjs <dist> [--check]   (data from <dist>/data, else public/data; --check: write nothing, print the plan)
// Nothing here is invented: a figure the file does not have is left out of the sentence, never filled.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DIST = args.find((a) => !a.startsWith('--')) ?? join(WEB, 'dist');
const CHECK = args.includes('--check');
const DATA = existsSync(join(DIST, 'data/funds.json')) ? join(DIST, 'data') : join(WEB, 'public/data');
const t0 = Date.now();

// the registry texts and the runtime constants come from the app's own modules (one source)
const tmp = mkdtempSync(join(tmpdir(), 'prerender-seo-')), mod = join(tmp, 'm.mjs');
let M;
try {
  await build({ stdin: { contents: "export { MOMENTS } from './src/lib/moments'; export { TEXT } from './src/lib/momentsContent'; export { SITE, DEFAULT_DESC } from './src/lib/seo';",
    resolveDir: WEB, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: mod, logLevel: 'error', define: { 'import.meta.env.PROD': 'false', 'import.meta.env.BASE_URL': '"/"' } });
  M = await import(pathToFileURL(mod).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }
const { MOMENTS, TEXT, SITE, DEFAULT_DESC } = M;

const json = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));
const opt = (rel) => (existsSync(join(DATA, rel)) ? json(rel) : null);

// ------------------------------------------------------------------------------------------------ formatting (house period language)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s) => String(s ?? '').replace(/[⁦-⁩‎‏]/g, '').replace(/\s+/g, ' ').trim();
const mmyy = (p) => `${String(p).slice(4, 6)}/${String(p).slice(2, 4)}`;  // 202609 -> 09/26
const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : `${v.toFixed(d)}%`);
const ils = (m) => (m == null || !Number.isFinite(m) ? null : m >= 1e6 ? `₪${(m / 1e6).toFixed(2)} טריליון` : m >= 1000 ? `₪${(m / 1000).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} מיליארד` : `₪${m.toFixed(m < 10 ? 1 : 0)} מיליון`);
const half = (s) => s.replace(/^H(\d) (\d{4})$/, (_, h, y) => `H${h}'${y.slice(2)}`).replace(/^Q(\d) (\d{4})$/, (_, q, y) => `Q${q}'${y.slice(2)}`).replace(/^FY (\d{4})$/, (_, y) => `FY'${y.slice(2)}`);
const join2 = (xs) => xs.filter(Boolean).join(', ');

// lastmod: the date the page's data file last changed in git (a shallow clone knows no history: then no lastmod)
const shallow = (() => { try { return execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: WEB }).toString().trim() === 'true'; } catch { return true; } })();
const gitDates = new Map();
function changed(rel) {
  if (shallow) return undefined;
  if (!gitDates.has(rel)) { let d; try { d = execFileSync('git', ['log', '-1', '--format=%cs', '--', `public/data/${rel}`], { cwd: WEB }).toString().trim() || undefined; } catch { d = undefined; } gitDates.set(rel, d); }
  return gitDates.get(rel);
}

// ------------------------------------------------------------------------------------------------ the pages
const pages = [];
/** title, description, the noscript body (h1, paragraphs, source line, links), lastmod */
const add = (path, title, desc, body, lastmod) => pages.push({ path, title: `${title} · fox`, desc: clean(desc), body, lastmod });

const F = json('funds.json');
const ASOF = mmyy(F.asof), SRC_REG = 'רשות שוק ההון, ביטוח וחיסכון (גמל-נט, פנסיה-נט, ביטוח-נט ב-data.gov.il)';
const fundsDate = changed('funds.json');
const dupName = new Map(); for (const f of F.funds) dupName.set(f.name, (dupName.get(f.name) ?? 0) + 1);

// one fund track: "[שם קרן] תשואה נטו דמי ניהול"
for (const f of F.funds) {
  if (!/^[gip]\d+$/.test(f.k)) continue;
  const name = clean(f.name) + (dupName.get(f.name) > 1 ? ` (${clean(f.prod)})` : '');
  const n = f.net ?? {};
  const y12 = n.y12 != null ? `תשואה נטו ב-12 חודשים ${pct(n.y12)}` : f.y12 != null ? `תשואה ברוטו ב-12 חודשים ${pct(f.y12)}` : null;
  const avg = n.a5 != null ? `ממוצע שנתי נטו ב-5 שנים ${pct(n.a5)}` : n.a3 != null ? `ממוצע שנתי נטו ב-3 שנים ${pct(n.a3)}` : f.a5 != null ? `ממוצע שנתי ברוטו ב-5 שנים ${pct(f.a5)}` : null;
  const fees = f.fee != null || f.depfee != null ? `דמי ניהול ממוצעים בפועל ${join2([f.fee != null && `${pct(f.fee)} מהצבירה`, f.depfee != null && `${pct(f.depfee)} מההפקדה`])}` : null;
  const assets = f.assets ? `נכסים ${ils(f.assets)}` : null;
  const ret = join2([y12, avg]);
  const desc = `${name}: ${[ret && `${ret}${(n.y12 ?? n.a5 ?? n.a3) != null ? ' (נטו: אומדן)' : ''}`, fees, assets].filter(Boolean).join('. ')}. נתונים ל-${ASOF}, רשות שוק ההון.`;
  add(`/funds/${f.k}`, `${name} · תשואה נטו ודמי ניהול ${ASOF}`, desc, {
    h1: clean(f.name),
    ps: [`${clean(f.prod)}${f.track ? ` · מסלול ${clean(f.track)}` : ''} · ${clean(f.mgr)}${f.closed ? ' · סגורה' : ''}`, [ret, fees, assets].filter(Boolean).join('. ') + '.'],
    src: `נתונים ל-${ASOF}. מקור: ${SRC_REG}. תשואה נטו: אומדן של fox, התשואה ברוטו שפורסמה פחות דמי הניהול מהצבירה; דמי הניהול הם השיעור הממוצע בפועל במסלול, לא של חוסך מסוים.`,
    links: [['/funds/screen', 'כל המסלולים'], ['/funds/compare', 'השוואת מסלולים'], ['/methodology', 'מתודולוגיה']],
  }, fundsDate);
}

// a company (insurer or fund house)
const companies = json('companies/index.json');
const byGrp = new Map();
for (const f of F.funds) { const g = byGrp.get(f.grp) ?? { a: 0, n: 0, fam: new Set() }; g.a += f.assets ?? 0; if (!f.closed && f.assets) g.n++; g.fam.add(f.fam); byGrp.set(f.grp, g); }
const FAM = { pensia: 'פנסיה', gemel: 'גמל והשתלמות', insurance: 'פוליסות וביטוחי מנהלים' };
for (const c of companies) {
  if (!/^[a-z_]+$/.test(c.id)) continue;
  const ins = c.kind === 'insurance_group';
  const g = c.market_group ? byGrp.get(c.market_group) : null;
  const last = c.filings?.[0]?.period ? half(c.filings[0].period) : null;
  const fam = g ? [...g.fam].map((x) => FAM[x]).filter(Boolean).join(', ') : null;
  const aum = g && g.a ? `נכסים במסלולי ${fam} של קבוצת ${clean(c.market_group)}: ${ils(g.a)} ב-${g.n} מסלולים פתוחים (${ASOF}, רשות שוק ההון)` : null;
  const rep = c.has_financials && last ? `דוחות כספיים עד ${last} מתוך מאי"ה, כל מספר עם עמוד המקור` : null;
  const title = ins ? `${clean(c.name_he)} · דוחות כספיים, IFRS 17, פנסיה וגמל` : `${clean(c.name_he)} · קופות גמל, השתלמות ופנסיה: נכסים ותשואות`;
  add(`/company/${c.id}`, title, `${clean(c.name_he)}: ${[aum, rep].filter(Boolean).join('. ') || (ins ? 'קבוצת ביטוח' : 'בית השקעות')}.`, {
    h1: clean(c.name_he), ps: [ins ? 'קבוצת ביטוח' : 'בית השקעות ומנהל חיסכון ארוך טווח', ...[aum, rep].filter(Boolean).map((s) => s + '.')],
    src: `מקורות: ${SRC_REG}; הדוחות שפורסמו במערכת מאי"ה.`, links: [['/funds/screen', 'כל המסלולים'], ['/managers', 'דירוג מנהלים']],
  }, fundsDate);
}

// pension (makifa) fees: "דמי ניהול ממוצעים פנסיה מקיפה 2026", asset-weighted over the open tracks that publish a rate
const pm = F.funds.filter((f) => f.prod === 'פנסיה מקיפה' && !f.closed && f.assets > 0);
const wavg = (key) => { const xs = pm.filter((f) => f[key] != null); const a = xs.reduce((t, f) => t + f.assets, 0); return a ? xs.reduce((t, f) => t + f.assets * f[key], 0) / a : null; };
const pmFee = wavg('fee'), pmDep = wavg('depfee');
const pmLine = pmFee != null && pmDep != null ? `דמי ניהול ממוצעים בפנסיה מקיפה ${ASOF}: ${pct(pmFee)} מהצבירה ו-${pct(pmDep)} מההפקדה (ממוצע משוקלל בנכסים של ${pm.length} מסלולים פתוחים, השיעור בפועל שהרשות מפרסמת)` : null;
add('/funds/tools/fees', 'דמי ניהול בפנסיה ובגמל: הממוצע, הזול בקטגוריה והעלות עד הפרישה',
  `${pmLine ? pmLine + '. ' : ''}מחשבון: כמה עולים דמי הניהול עד הפרישה, ודמי הניהול שלך מול המסלולים הזולים בקטגוריה. נתונים עד ${ASOF}, רשות שוק ההון.`,
  { h1: 'דמי ניהול לאורך קריירה', ps: [pmLine && pmLine + '.', 'כמה עולים דמי ניהול עד הפרישה: מחשבון על הנחות שלך, עם דמי הניהול של מסלולים אמיתיים, ודמי הניהול שלך מול הזול בקטגוריה.'].filter(Boolean),
    src: `נתונים עד ${ASOF}. מקור: ${SRC_REG}. החישוב על הנחות: לא ייעוץ.`, links: [['/funds/default', 'קרנות ברירת מחדל'], ['/my/checkup', 'הבדיקה השנתית']] }, fundsDate);

// default funds (the regulator's tender): "קרן ברירת מחדל לפי ספרת תעודת זהות"
const D = opt('funds/default.json');
const tender = D?.tenders?.filter((t) => t.verified && t.winners?.length).at(-1) ?? null;
const yy = (iso) => iso?.slice(0, 4);
const tLine = tender ? `הקרנות הנבחרות בהליך ${yy(tender.from)}–${yy(tender.to)}: ${tender.winners.map((w) => clean(w.grp ?? w.co)).join(', ')}${tender.fee != null && tender.depfee != null ? `, בדמי ניהול של ${pct(tender.fee)} מהצבירה ו-${pct(tender.depfee, 1)} מההפקדה` : ''}` : null;
const defDate = changed('funds/default.json');
add('/funds/default', `קרנות פנסיה ברירת מחדל${tender ? ` ${yy(tender.from)}–${yy(tender.to)}` : ''}: הזוכות, דמי הניהול ומה הנתונים מראים`,
  `${tLine ? tLine + '. ' : ''}מכרזי רשות שוק ההון לקרנות הפנסיה הנבחרות, וההפקדות, הנכסים והתשואה נטו של הזוכות לפני ואחרי. נתונים עד ${ASOF}.`,
  { h1: 'קרנות ברירת מחדל', ps: [tLine && tLine + '.', 'מכרזי רשות שוק ההון לקרנות הפנסיה הנבחרות, ומה הנתונים מראים לפני ואחרי כל הליך.'].filter(Boolean),
    src: `מקור: רשות שוק ההון (הודעות ההליך וחוזר 2016-9-8); ${SRC_REG}. נתונים עד ${ASOF}.`, links: [['/my/moment/default', 'הקרן שלך לפי ספרת ת"ז']] }, defDate);

// the saver's life moments: each answers one query ("עזבתי עבודה מה קורה לפנסיה", "מתי קרן השתלמות נזילה מס", ...)
const MOMENT_TITLE = {
  job: 'עזבתי עבודה: מה קורה לפנסיה, להשתלמות ולפיצויים',
  hishtalmut: 'מתי קרן השתלמות נזילה, ומה המס במשיכה',
  raise: 'קיבלתי העלאה בשכר: כמה צריך להיות מופקד לפנסיה',
  sixty: 'מתקרבים ל-60: קצבה או סכום חד-פעמי, מקדם וקיבוע זכויות',
  switch: 'להעביר קרן פנסיה? מה קורה בניוד ומה בודקים לפני',
  default: 'קרן פנסיה ברירת מחדל לפי ספרת תעודת הזהות',
};
for (const [id, m] of Object.entries(MOMENTS)) {
  const lead = clean(TEXT[id]?.lead ?? m.meta);
  const extra = id === 'default' && tLine ? ` ${tLine}.` : '';
  add(`/my/moment/${id}`, MOMENT_TITLE[id] ?? clean(m.title), `${lead}${extra} כל כלל עם המקור שלו.`, {
    h1: clean(m.title), ps: [lead, extra.trim(), clean(m.meta) + '.'].filter(Boolean), src: 'כל כלל עם המקור שלו (חוק, חוזר או הוראת הרשות). תיאור, לא ייעוץ.',
    links: [['/my/moment', 'כל הרגעים'], ['/my/checkup', 'הבדיקה השנתית']],
  }, id === 'default' ? defDate : undefined);
}
add('/my/moment', 'רגעים בחיסכון: עזבתי עבודה, העלאה, משיכת השתלמות, גיל 60, ניוד',
  `מה קורה לחיסכון ברגעים של השנה: ${Object.values(MOMENTS).map((m) => clean(m.chip)).join(', ')}. כל רגע עם הכללים, המקורות ומה לבדוק אצלך.`,
  { h1: 'רגעים בחיסכון', ps: Object.values(MOMENTS).map((m) => `${clean(m.title)}: ${clean(m.meta)}.`), src: 'תיאור, לא ייעוץ.', links: Object.keys(MOMENTS).map((id) => [`/my/moment/${id}`, clean(MOMENTS[id].chip)]) });

add('/my/statement', 'איך קוראים דוח שנתי של קרן פנסיה, סעיף אחר סעיף',
  'הדוח השנתי של קרן הפנסיה, הגמל וההשתלמות: מה כל סעיף אומר, דמי הניהול מהצבירה ומההפקדה, הכיסוי הביטוחי וההפקדות, ומה לבדוק בכל אחד.',
  { h1: 'איך קוראים את הדוח השנתי', ps: ['מה כל סעיף בדוח השנתי אומר, ומה לבדוק בו: דמי הניהול, ההפקדות, הכיסוי הביטוחי והתשואה.'], src: 'תיאור, לא ייעוץ.', links: [['/my/checkup', 'הבדיקה השנתית']] });
add('/my/checkup', 'הבדיקה השנתית לחיסכון הפנסיוני: דמי ניהול, הפקדות ומסלול גיל',
  `שלוש שורות: דמי הניהול שלך מול מחיר קרנות ברירת המחדל או חציון הקטגוריה, ההפקדות מול השכר, ומסלול הגיל. לכל שורה העוגן והמקור שלה. נתוני רשות שוק ההון עד ${ASOF}.`,
  { h1: 'הבדיקה השנתית', ps: ['שלוש שורות: דמי הניהול, ההפקדות ומסלול הגיל. לכל שורה העוגן והמקור שלה, וכל שורה נגמרת בפעולה.', tLine && tLine + '.'].filter(Boolean),
    src: `נתוני רשות שוק ההון עד ${ASOF}. הנתונים שלך נשארים בדפדפן.`, links: [['/my/statement', 'איך קוראים את הדוח השנתי'], ['/funds/tools/fees', 'דמי ניהול לאורך קריירה']] }, fundsDate);

const openN = F.funds.filter((f) => !f.closed && f.assets).length;
add('/funds/compare', 'השוואת מסלולי פנסיה, גמל והשתלמות: תשואה נטו ודמי ניהול',
  `השוואה ראש בראש של מסלולי פנסיה, גמל, השתלמות ופוליסות: תשואה נטו, דמי ניהול, סיכון ונכסים, מתוך ${openN.toLocaleString('en-US')} מסלולים פתוחים. נתונים ל-${ASOF}, רשות שוק ההון.`,
  { h1: 'השוואת מסלולים', ps: [`השוואה ראש בראש של מסלולים מתוך ${openN.toLocaleString('en-US')} מסלולים פתוחים: תשואה נטו, דמי ניהול, סיכון ונכסים.`], src: `נתונים ל-${ASOF}. מקור: ${SRC_REG}.`, links: [['/funds/screen', 'כל המסלולים']] }, fundsDate);

const totA = F.funds.reduce((t, f) => t + (f.assets ?? 0), 0), grpN = new Set(F.funds.map((f) => f.grp)).size;
add('/savings', 'עדשת חיסכון: נכסים, צבירה וניוד בפנסיה ובגמל לפי מנהל',
  `נתח נכסים, צבירה נטו וניודים של מנהלי הפנסיה, הגמל וההשתלמות לפי קבוצה. סך הנכסים במסלולים: ${ils(totA)} ב-${grpN} קבוצות (${ASOF}, רשות שוק ההון).`,
  { h1: 'עדשת חיסכון', ps: [`נתח נכסים, צבירה נטו וניודים לפי קבוצה. סך הנכסים במסלולים שבקובץ: ${ils(totA)} ב-${grpN} קבוצות.`], src: `נתונים ל-${ASOF}. מקור: ${SRC_REG}.`, links: [['/flows', 'מי ניצח החודש']] }, fundsDate);

add('/about', 'על fox: נתוני חיסכון ארוך טווח בישראל, כל מספר עם המקור',
  'אתר חינמי לנתוני חיסכון ארוך טווח בישראל: קופות גמל, השתלמות, פנסיה ופוליסות, והחברות שמנהלות אותן. המספרים מרשות שוק ההון ומהדוחות במאי"ה, וכל מספר נפתח למקור שלו.',
  { h1: 'על fox', ps: ['אתר חינמי לנתוני חיסכון ארוך טווח בישראל: קופות גמל, השתלמות, פנסיה ופוליסות, והחברות שמנהלות אותן.', 'כל מספר באתר נפתח למקור שלו: הרשומה ברשות, או העמוד בדוח.'], src: `מקורות: ${SRC_REG}; מאי"ה.`, links: [['/methodology', 'מתודולוגיה']] });
add('/methodology', 'מתודולוגיה: איך fox מחשב תשואה נטו, דמי ניהול וניוד',
  'איך כל מספר באתר מחושב: תשואה נטו, תשואה ריאלית, אחוזון בקטגוריה, דמי ניהול, ניוד וצבירה. מה כל מונח אומר, מאיזה מקור, ומתי הנתונים מתעדכנים.',
  { h1: 'מתודולוגיה', ps: ['איך כל מספר באתר מחושב, מה כל מונח אומר ומתי הנתונים מתעדכנים.', clean(F.net_method)], src: `מקור: ${SRC_REG}.`, links: [['/about', 'על fox']] });

// the answer ladder: the index and each question
const Q = opt('answers/index.json');
if (Q) {
  const qDate = changed('answers/index.json');
  const ok = Q.rows.filter((r) => r.st === 'ok' && /^Q-\d+$/.test(r.id));
  for (const r of ok) add(`/questions/${r.id}`, clean(r.q), `${clean(r.corr)}${r.asof ? ` נכון ל-${clean(r.asof)}.` : ''} התשובה עם החישוב והמקור לכל מספר.`, {
    h1: clean(r.q), ps: [clean(r.corr)], src: `${r.asof ? `נכון ל-${clean(r.asof)}. ` : ''}${clean(Q.topics?.[r.topic] ?? '')}. כל מספר עם המקור והחישוב שלו.`,
    links: [['/questions', 'כל השאלות']] }, qDate);
  add('/questions', 'שאלות ותשובות על מבטחות ומנהלי חיסכון, עם מקור לכל מספר',
    `${ok.length} שאלות על ${Object.values(Q.topics ?? {}).slice(0, 5).join(', ')} ועוד, וכל תשובה מחושבת מהנתונים עם מקור לכל מספר.`,
    { h1: 'שאלות', ps: [`${ok.length} שאלות, כל אחת עם תשובה מחושבת.`], src: 'כל מספר עם המקור והחישוב שלו.', links: ok.slice(0, 20).map((r) => [`/questions/${r.id}`, clean(r.q)]) }, qDate);
}

// the monthly flows letter
const LI = opt('flows/letters/index.json');
for (const l of LI?.letters ?? []) {
  if (!/^\d{6}$/.test(String(l.p))) continue;
  add(`/flows/letter/${l.p}`, `מכתב התזרימים ${mmyy(l.p)}: מי ניצח בניוד בפנסיה ובגמל`, `${clean(l.h)} מקור: רשות שוק ההון, ${mmyy(l.p)}.`, {
    h1: `מכתב התזרימים ${mmyy(l.p)}`, ps: [clean(l.h)], src: `מקור: ${SRC_REG}. גרסה ${l.ver}.`, links: [['/flows', 'מי ניצח החודש']] }, l.built);
}

// ------------------------------------------------------------------------------------------------ write
const shell = readFileSync(join(DIST, 'index.html'), 'utf8');
const need = [/<title>[^<]*<\/title>/, /<meta name="description" content="[^"]*"\s*\/?>/, /<meta property="og:title" content="[^"]*"\s*\/?>/, /<meta property="og:description" content="[^"]*"\s*\/?>/, /<div id="root"><\/div>/];
for (const rx of need) if (!rx.test(shell)) { console.error(`prerender-seo: the shell ${DIST}/index.html has no ${rx}: index.html changed?`); process.exit(1); }
const shellDesc = shell.match(/<meta name="description" content="([^"]*)"/)[1];
if (shellDesc !== DEFAULT_DESC) { console.error('prerender-seo: index.html description and lib/seo.ts DEFAULT_DESC differ'); process.exit(1); }
if (/name="fox:route"/.test(shell)) { console.error('prerender-seo: the shell is already prerendered'); process.exit(1); }

const seen = new Set();
function render(p) {
  const url = SITE + p.path;
  const b = p.body;
  const noscript = `<noscript><main style="max-width:760px;margin:24px auto;padding:0 16px;line-height:1.6"><h1>${esc(b.h1)}</h1>${b.ps.map((x) => `<p>${esc(x)}</p>`).join('')}`
    + `<p><small>${esc(b.src)}</small></p>${b.links?.length ? `<p>${b.links.map(([h, t]) => `<a href="${esc(h)}">${esc(t)}</a>`).join(' · ')}</p>` : ''}</main></noscript>`;
  return shell
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, () => `<meta name="description" content="${esc(p.desc)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, () => `<meta property="og:title" content="${esc(p.title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, () => `<meta property="og:description" content="${esc(p.desc)}" />\n    <meta property="og:url" content="${esc(url)}" />`)
    .replace('</head>', () => `  <link rel="canonical" href="${esc(url)}" />\n    <meta name="fox:route" content="${esc(p.path)}" />\n  </head>`)
    .replace('<div id="root"></div>', () => `${noscript}\n    <div id="root"></div>`);
}
let bytes = 0;
for (const p of pages) {
  if (seen.has(p.path)) { console.error(`prerender-seo: ${p.path} twice`); process.exit(1); }
  seen.add(p.path);
  const html = render(p);
  bytes += Buffer.byteLength(html);
  if (CHECK) continue;
  const file = join(DIST, `${p.path.slice(1)}.html`);  // cleanUrls: /funds/p2009 -> funds/p2009.html
  if (existsSync(file) && !statSync(file).isFile()) { console.error(`prerender-seo: ${file} is not a file`); process.exit(1); }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

// sitemap: the prerendered pages and the section fronts; robots.txt (public/) points here
const FRONTS = [['/', fundsDate], ['/funds', fundsDate], ['/funds/screen', fundsDate], ['/managers', fundsDate], ['/flows', changed('flows/letters/index.json')]];
const urls = [...FRONTS.map(([path, lastmod]) => ({ path, lastmod })), ...pages];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(SITE + u.path)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
if (!CHECK) writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

const by = {}; for (const p of pages) { const k = p.path.split('/').slice(0, 2).join('/'); by[k] = (by[k] ?? 0) + 1; }
console.log(`prerender-seo: ${pages.length} pages (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ')}), ${(bytes / 1024 / 1024).toFixed(1)} MB; sitemap ${urls.length} URLs${shallow ? ' (shallow clone: no lastmod)' : ''}; data ${DATA}; ${Date.now() - t0} ms${CHECK ? ' (--check: nothing written)' : ''}`);
