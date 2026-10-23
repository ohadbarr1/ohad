/* The tool list: names, Hebrew + English descriptions, input schemas. Shared by the stdio server, the eval runner and the smoke test. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { installFetch } from './data';
import { withDetail } from './core';
import { calendar, companyOverview, csmLedger, documentPage, figure, peerTable, restatements, savingsLens, search } from './tools';

export const CONTRACT = [
  'כל מספר מגיע מכלי בלבד; אין לכתוב מספר שלא הוחזר. Every number comes from a tool result; never write a figure from memory.',
  'Each numeric result carries value, unit, period, entity and a `source` (doc_id, page, url to the fox reader page) or a `calc` (formula + inputs, each sourced). Quote the `display` string and link the `url` (or the fact `view`).',
  'Period grammar: Q2\'26, FY\'25, H1\'26, LTM Q2\'26; regulator months 08/26. Estimates are flagged אומדן. Fundamentals only: no stock prices.',
  '"פוליסות חיסכון" (pure savings, IFRS 9) are not "ביטוחי מנהלים" (with a risk component, IFRS 17).',
].join('\n');

const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const PERIOD = 'תקופה · period: Q2\'26 | FY\'25 | H1\'26 | 9M\'25 | LTM Q2\'26 | 08/26 (regulator month) | latest (default)';
const ENTITY = 'חברה או קבוצה · company or market group: id (harel, phoenix, migdal, clal, menora, ayalon, hachshara, idi, meitav, altshuler, more, analyst, yelin, infinity, globalnet, more_gemel, ibi) or Hebrew name (הראל, "בהראל")';

type Handler = (a: Record<string, unknown>) => Promise<unknown>;
const DETAIL = z.enum(['brief', 'full']).optional().describe('brief (default): sources of the direct inputs · full: every input opened down to its page');
const wrap = (f: Handler, brief: number) => async (a: Record<string, unknown>) => {
  try {
    const out = await withDetail(a.detail as 'brief' | 'full' | undefined, brief, () => f(a));
    return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: (e as Error).message }) }] };
  }
};

export const TOOLS: { name: string; title: string; description: string; schema: z.ZodRawShape; run: Handler; brief?: number }[] = [
  { name: 'search', title: 'חיפוש · Search',
    description: 'חיפוש חברות, קופות, שורות בדוחות, מסמכים, מדדים וטקסט מלא של כל עמודי הדוחות (אינדקס האתר). Search entities, statement lines, documents, metric ids (kinds=["metric"] to find the id `figure` takes) and the full text of every filed page; every hit links to its page.',
    schema: { q: z.string().describe('מילות חיפוש · query, Hebrew or English ("הראל רכיב הפסד", "CSM עסק חדש")'), kinds: z.array(z.enum(['entity', 'line', 'document', 'metric', 'text'])).optional().describe('default: all'), limit: z.number().int().min(1).max(25).optional() },
    run: (a) => search(a as never) },
  { name: 'company_overview', title: 'תמונת חברה · Company overview',
    description: 'דוח היום של חברה: שורות הכותרת של הדוחות (רווח נקי, רווח כולל, רווח משירותי ביטוח, הון, נכסים) עם YoY, ROE LTM, רווח למניה, CSM, נכסים ונתח שוק ברשות, דיווחים אחרונים והדוח הבא. Report Day of one company, as on its home page; every figure sourced.',
    schema: { company: z.string().describe(ENTITY), period: z.string().optional().describe('הדוח · report: Q2\'26, FY\'25 (default latest)'), detail: DETAIL },
    run: (a) => companyOverview(a as never), brief: 1 },
  { name: 'figure', title: 'נתון · Figure',
    description: [
      'נתון אחד או סדרה: חברה × מדד × תקופה × חלון, בכללי האתר (Q4 = FY פחות 9M, LTM, הקנון המודפס של XBRL, כלל ה-CSM). One figure or a series for an entity, by the site\'s rules.',
      'metric ids: st:net|comp|isr|inv|pbt|rev|eq|assets (statements, Report Day) · kpi:profit|oci|pretax|equity|assets|eps|roe|leverage (XBRL headline; roe = LTM) · csm (CSM closing, net group rule) · any peer-registry id (ifrs:csm_new_business, ifrs:solvency_ratio_with_transitional, ifrs:dividend_paid, fs:…, sop:…, lts:pen.fees, econ:…, reg:assets@all …) or alias (np, eq, csm0, nb, rel, sr, srt, div) · mkt:<assets|share|organic|transfers|netflow|fee|ret|growth|rate>@<all|pension|gemel|insurance|hishtalmut> (regulator, monthly). Unknown? search kinds=["metric"].',
    ].join(' '),
    schema: { entity: z.string().describe(ENTITY), metric: z.string().describe('מדד · metric id, alias or Hebrew label'), period: z.string().optional().describe(PERIOD),
      window: z.enum(['q', 'ytd', 'ltm', 'fy', 'h', 'm']).optional().describe('חלון · q quarter | ytd year-to-date (H1/9M/FY column) | ltm | fy | h | m month. Default follows the period'),
      n: z.number().int().min(1).max(24).optional().describe('מספר תקופות אחורה · number of periods back on the axis (series)'), compare: z.enum(['yoy', 'qoq']).optional().describe('השוואה · adds the comparison period and the change, by the rule of the page that shows the figure'), detail: DETAIL },
    run: (a) => figure(a as never), brief: 2 },
  { name: 'peer_table', title: 'טבלת עמיתים · Peer table',
    description: 'מדד אחד לקבוצת עמיתים בתקופה אחת, מדורג, עם חציון וממוצע (חציון מ-3 חברות, ממוצע מ-2, כמו בטבלת העמיתים). One metric across a peer set, ranked, with median and mean. peers: ins (7 המבטחות) | big5 (חמש הגדולות) | lts (מנהלי חיסכון) | fund (בתי השקעות) | all | market (all regulator groups, for mkt:…) | comma list of ids.',
    schema: { metric: z.string().describe('as in figure'), peers: z.string().optional().describe('ins | big5 | lts | fund | all | market | "harel,clal,menora"'), period: z.string().optional().describe(PERIOD), window: z.enum(['q', 'ytd', 'ltm', 'fy', 'h', 'm']).optional(), compare: z.enum(['yoy']).optional(), order: z.enum(['desc', 'asc']).optional(), detail: DETAIL },
    run: (a) => peerTable(a as never), brief: 1 },
  { name: 'csm_ledger', title: 'ספר ה-CSM · CSM ledger',
    description: 'טבלת התנועה ב-CSM של מבטחת: פתיחה, עסק חדש, צבירת ריבית, שינויי אומדן, שחרור, סגירה, הפרש לא מוסבר ויחסים (עסק חדש/שחרור, CSM/הון, קצב שחרור). CSM roll-forward of an insurer, net group basis by the site\'s rule; a quarter the report does not print is the cumulative table less the previous one (Q4 = FY − 9M), flagged.',
    schema: { company: z.string().describe('phoenix | harel | migdal | clal | menora | ayalon | hachshara'), period: z.string().optional().describe('Q2\'26 | FY\'25 | latest'), span: z.enum(['q', 'ytd']).optional().describe('q quarter (default) | ytd cumulative'), detail: DETAIL },
    run: (a) => csmLedger(a as never), brief: 1 },
  { name: 'savings_lens', title: 'עדשת חיסכון · Savings Lens',
    description: 'תזרימי הרשות (חודשי) מול רווח והפסד של החברות המנהלות (רבעוני): נתח מנכסים, נתח מהצבירה, תשואת דמי ניהול, הוצאות להכנסות, רווח לכל מיליארד, צבירה וניוד; אומדן לרבעון השוטף (nowcast). Regulator flows × managers\' P&L. segment: pen (פנסיה) | gem (גמל והשתלמות) | pg | hish (השתלמות) | ins (ביטוחי מנהלים ופוליסות חיסכון, ביטוח-נט).',
    schema: { group: z.string().optional().describe('קבוצה · market group or company; omit for the whole segment ranked by assets'), segment: z.string().optional().describe('pen | gem | pg | hish | ins (default pen)'), quarter: z.string().optional().describe('Q2\'26 (default: latest reported quarter)'), nowcast: z.boolean().optional().describe('אומדן לרבעון השוטף · add the labelled estimate for the quarter in progress'), detail: DETAIL },
    run: (a) => savingsLens(a as never), brief: 1 },
  { name: 'document_page', title: 'עמוד במסמך · Document page',
    description: 'הטקסט של עמוד בדוח שהוגש (מאינדקס הטקסט של האתר) עם קישור לעמוד בקורא של fox. Text of one filed page and its link; `find` checks that a figure appears on it. Give doc_id (+page) from any source, or company + period (+type: annual | quarterly | presentation | solvency).',
    schema: { doc_id: z.number().int().optional().describe('MAYA report id = source.doc_id'), page: z.number().int().min(1).optional(), company: z.string().optional(), period: z.string().optional(), type: z.enum(['annual', 'quarterly', 'presentation', 'solvency']).optional(), find: z.string().optional().describe('מחרוזת לבדיקה בעמוד · e.g. "17,717"') },
    run: (a) => documentPage(a as never) },
  { name: 'restatements', title: 'הצגות מחדש · Restatements',
    description: 'יומן ההצגות מחדש: כל נתון שדוח מאוחר הדפיס בערך אחר, עם שני העמודים (הדפסה ראשונה והאחרונה). Every figure a later filing reprinted with another value, both pages linked; largest amounts first.',
    schema: { company: z.string().optional().describe(ENTITY), report: z.string().optional().describe('הדוח המציג מחדש · restating report: Q2\'26, FY\'25'), period: z.string().optional().describe('התקופה שהוצגה מחדש · restated period: FY\'23'), line: z.string().optional().describe('מילים בשם השורה · words of the line, e.g. "רווח לתקופה"'), statement: z.enum(['bs', 'pl', 'oci', 'cf', 'eq', 'n17']).optional(), min_pct: z.number().optional(), limit: z.number().int().min(1).max(60).optional() },
    run: (a) => restatements(a as never) },
  { name: 'calendar', title: 'לוח דיווחים · Reporting calendar',
    description: 'הדוח הבא של כל חברה: התקופה, מועד צפוי (אומדן מהרקורד של החברה, לא מועד סטטוטורי) והדוח האחרון. Next expected report per company (estimate) and the last one filed.',
    schema: { company: z.string().optional().describe(ENTITY) },
    run: (a) => calendar(a as never) },
];

export function buildServer(): McpServer {
  installFetch();
  const server = new McpServer({ name: 'fox', version: '0.1.0', title: 'fox · Israeli insurers and savings managers (fundamentals)' }, { instructions: CONTRACT });
  for (const t of TOOLS) server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.schema, annotations: { title: t.title, ...ro } }, wrap(t.run, t.brief ?? 2) as never);
  return server;
}
