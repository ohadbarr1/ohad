/** W8 feeds: the news of one fund, and the static feeds and calendars a reader can subscribe to (pull only: there is no server and no email).
 *  newsForFund() picks, from feed.json (pipeline/build_feed.py), the events of the last 90 days that concern one track: a change in its own
 *  average management fee, and company-level events of its manager (a restatement of the manager's reports; merger, default-fund tender,
 *  service-index and regulator-decision events when feed.json carries those types). Each becomes one short factual line with its source.
 *  Works on feed.json or on the slim data/news.json. Pure: tests/news.unit.ts runs it over tests/fixtures/news-feed.json. */
import { useEffect } from 'react';
import { pubLabel } from './format';
import { useLoad } from './useData';
import { docName, docUrl, fmtFig, type FeedEvent, type FeedFile } from './feed';

/** where the site is published: feeds and calendars are subscribed to by absolute URL */
export const SITE = 'https://fox-research-il.web.app';
export const SITE_HOST = 'fox-research-il.web.app';

/** received dates (pipeline/build_rss.py, data/feed_seen.json): id -> [date, r = received at that build | b = the event's own date] */
export interface SeenFile { v: number; since: string; seen: Record<string, [string, 'r' | 'b']> }
/** data/news.json (pipeline/build_rss.py): the slim feed a fund card loads instead of feed.json: fee changes and company-level events of the
 *  last 200 days before the build, first row only, the documents they cite, and the received dates */
export type NewsFile = Pick<FeedFile, 'files' | 'cos' | 'docs' | 'events'> & { v: number; built: string; days: number; seen: SeenFile['seen'] };
/** data/alerts.json (pipeline/build_rss.py) */
export interface AlertsFile {
  v: number; built: string; site: string;
  /** the day the received-date ledger began: items before it carry their own date */ since: string;
  reg: { ym: number; id: string; d: string; kind: 'r' | 'b' } | null;
  feeds: { p: string; a: string; t: string; n: number; c: string | null; k: 'all' | 'months' | 'funds' | 'co' }[];
}

/** the feed of a filter on /feed: a company, the regulator's months, the fee changes, else everything */
export function feedPath(o: { co?: string; t?: string }): { rss: string; atom: string; label: string } {
  const stem = o.co ? `feed/${o.co}` : o.t === 'regmonth' ? 'feed/months' : o.t === 'fee' ? 'feed/funds' : 'feed';
  const label = o.co ? 'החברה' : o.t === 'regmonth' ? 'חודשי הרשות' : o.t === 'fee' ? 'דמי ניהול' : 'כל השינויים';
  return { rss: `/${stem}.xml`, atom: `/${stem}.atom`, label };
}
/** a calendar subscription: webcal:// opens the calendar app's "subscribe" (it refreshes on its own), https downloads a copy */
export function calLinks(path: string, host = SITE_HOST) {
  return { webcal: `webcal://${host}${path}`, https: `https://${host}${path}` };
}

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
/** 202609 -> ספטמבר 2026 */
export const monthHe = (ym: number | string) => { const n = Number(ym); return `${MONTHS_HE[(n % 100) - 1] ?? ''} ${Math.floor(n / 100)}`; };
const TK: Record<string, string> = { pensia: 'p', gemel: 'g', insurance: 'i' };
const DS_HE: Record<string, string> = { gemel: 'גמל-נט', pensia: 'פנסיה-נט', insurance: 'ביטוח-נט' };
/** company-level types that concern every track of the manager (the last four once feed.json carries them). A restatement of the
 *  manager's financial reports is agent / Pro material: the saver door shows the track's own fee and the manager-level decisions only. */
const CO_TYPES = new Set(['restate', 'merger', 'tender', 'service', 'regdec']);
const SAVER_SKIP = new Set(['restate']);

export interface NewsLine {
  id: string;
  /** the event's date (ISO) and the day fox received it, when the ledger knows it */
  d: string; got: string | null;
  /** one short factual line, e.g. "הראל: שינוי בדמי הניהול הממוצעים במסלול, ספטמבר 2026: 0.52% → 0.48%" */
  text: string;
  src: { text: string; href: string | null };
  /** the page on fox that shows it */
  to: string;
  kind: 'fund' | 'company';
}

export interface FundRef { k: string; grp?: string | null; c?: string | null }

/** does the event concern this track? (its own fee) or its manager? (a company-level event) */
function concerns(F: Pick<FeedFile, 'cos'>, e: FeedEvent, f: FundRef): 'fund' | 'company' | null {
  if (e.t === 'fee') return e.src.k === 'fund' && `${TK[e.src.ds] ?? '?'}${e.src.id}` === f.k ? 'fund' : null;
  if (!CO_TYPES.has(e.t)) return null;
  const s = e.src as { k: string; ds?: string; id?: number };
  if (s.k === 'fund' && s.ds && s.id != null) return `${TK[s.ds] ?? '?'}${s.id}` === f.k ? 'fund' : null;
  if (f.c && e.c === f.c) return 'company';
  if (f.grp && (F.cos[e.c] === f.grp)) return 'company';
  return null;
}

function line(F: Pick<FeedFile, 'cos' | 'docs' | 'files'>, e: FeedEvent, kind: 'fund' | 'company', got: string | null): NewsLine {
  const co = F.cos[e.c] ?? e.c, r = e.rows?.[0];
  let text: string, src: NewsLine['src'];
  if (e.t === 'fee' && r && r.b && e.src.k === 'fund') {
    text = `${co}: שינוי בדמי הניהול הממוצעים במסלול, ${monthHe(e.per)}: ${fmtFig(r.b)} → ${fmtFig(r.a)}`;
    src = { text: `רשות שוק ההון, ${DS_HE[e.src.ds] ?? e.src.ds}, ${monthHe(e.src.ym)}`, href: null };
  } else {
    const n = e.t === 'restate' && r?.a.u === 'n' ? ` (${fmtFig(r.a)} נתונים)` : '';
    text = `${co}: ${e.h}${n}`;
    if (e.src.k === 'doc') { const u = docUrl(F as FeedFile, e.src.rid); src = { text: `${docName(F as FeedFile, e.src.rid)}, ${pubLabel(F.docs[String(e.src.rid)]?.[3])}`, href: u }; }
    else src = { text: 'fox', href: null };
  }
  return { id: e.id, d: e.d, got, text, src, to: e.to, kind };
}

/** The events of the last `days` days (by the day fox received them, else the event's own date) that concern one track, newest first.
 *  [] when there are none: the caller renders nothing. */
export function newsForFund(F: Pick<FeedFile, 'cos' | 'docs' | 'files' | 'events'> & { seen?: SeenFile['seen'] }, f: FundRef,
  opts: { now?: Date; days?: number; seen?: SeenFile | null; max?: number; door?: 'saver' | 'agent' } = {}): NewsLine[] {
  const now = opts.now ?? new Date(), days = opts.days ?? 90, max = opts.max ?? 3;
  const from = new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10), to = now.toISOString().slice(0, 10);
  const out: NewsLine[] = [];
  for (const e of F.events) {
    const kind = concerns(F, e, f);
    if (!kind || (opts.door === 'saver' && SAVER_SKIP.has(e.t))) continue;
    const s = (opts.seen?.seen ?? F.seen)?.[e.id], got = s && s[1] === 'r' ? s[0] : null, when = got ?? e.d;
    if (when < from || when > to) continue;
    out.push(line(F, e, kind, got));
  }
  // the track's own news first, then the manager's; newest first within each
  out.sort((a, b) => (a.kind === b.kind ? (b.got ?? b.d).localeCompare(a.got ?? a.d) : a.kind === 'fund' ? -1 : 1));
  return out.slice(0, max);
}

/** the months of the regulator's data since the reader's last visit: a positive number when a new month landed */
export function newMonths(lastYm: number | null, reg: AlertsFile['reg']): number {
  if (!reg || lastYm == null) return 0;
  const a = Math.floor(reg.ym / 100) * 12 + (reg.ym % 100), b = Math.floor(lastYm / 100) * 12 + (lastYm % 100);
  return Math.max(0, a - b);
}

/** <link rel="alternate" type="application/rss+xml"> in the document head while a page shows one company or one filter, so a browser or a
 *  feed reader finds the page's own feed (index.html carries the site-wide one). Removed when the page leaves. */
export function useFeedAlternate(href: string | null, title: string) {
  useEffect(() => {
    if (!href || typeof document === 'undefined') return;
    const l = document.createElement('link');
    l.rel = 'alternate'; l.type = 'application/rss+xml'; l.href = href; l.title = title; l.dataset.fox = 'feed';
    document.head.appendChild(l);
    return () => l.remove();
  }, [href, title]);
}

/** the company's own feed in the head, when fox publishes one for it (data/alerts.json lists them; ≈2 KB) */
export function useCompanyFeedAlternate(co: string | null | undefined) {
  const { data } = useLoad<AlertsFile>(co ? 'alerts.json' : null);
  const f = co ? data?.feeds.find((x) => x.c === co) : undefined;
  useFeedAlternate(f?.p ?? null, f ? `fox · ${f.t}` : '');
}
